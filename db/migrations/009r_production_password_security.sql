-- Separate per-IP abuse from the account aggregate. Never touch credentials or loyalty data.
ALTER TABLE password_login_guards ADD COLUMN window_started_at timestamptz NOT NULL DEFAULT now();
UPDATE password_login_guards SET failures=0,locked_until=NULL;
CREATE TABLE password_login_ip_guards (
 email text NOT NULL,ip_hash text NOT NULL CHECK(ip_hash ~ '^[a-f0-9]{64}$'),
 failures integer NOT NULL DEFAULT 0,locked_until timestamptz,
 window_started_at timestamptz NOT NULL DEFAULT now(),last_attempt_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(email,ip_hash)
);
REVOKE ALL ON password_login_ip_guards FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON password_login_ip_guards TO nuqta_auth;
-- Existing audited admin/password unlock functions also clear the new per-IP guards.
CREATE FUNCTION reset_password_ip_guards() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.failures=0 AND NEW.locked_until IS NULL THEN DELETE FROM password_login_ip_guards WHERE email=NEW.email; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION reset_password_ip_guards() FROM PUBLIC;
CREATE TRIGGER password_guard_reset AFTER UPDATE OF failures,locked_until ON password_login_guards FOR EACH ROW EXECUTE FUNCTION reset_password_ip_guards();

ALTER TABLE sessions ADD COLUMN portal text CHECK(portal IN ('platform','merchant','cashier','customer'));
CREATE FUNCTION password_session_portal(uid uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN u.global_role IN ('platform_admin','platform_support') THEN 'platform'
 WHEN EXISTS(SELECT 1 FROM staff_memberships s WHERE s.user_id=u.id AND s.status='active' AND s.role IN ('owner','manager')) THEN 'merchant'
 WHEN EXISTS(SELECT 1 FROM staff_memberships s WHERE s.user_id=u.id AND s.status='active' AND s.role='cashier') THEN 'cashier'
 ELSE 'customer' END FROM users u WHERE u.id=uid AND u.status='active'
$$;
REVOKE ALL ON FUNCTION password_session_portal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION password_session_portal(uuid) TO nuqta_auth;
CREATE TABLE mfa_enrollments (
 user_id uuid PRIMARY KEY REFERENCES users(id),session_id uuid NOT NULL REFERENCES sessions(id),
 secret_encrypted text NOT NULL,expires_at timestamptz NOT NULL
);
CREATE TABLE mfa_recovery_codes (
 user_id uuid NOT NULL REFERENCES users(id),code_hash text NOT NULL CHECK(code_hash ~ '^[a-f0-9]{64}$'),
 used_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,code_hash)
);
REVOKE ALL ON mfa_enrollments,mfa_recovery_codes FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON mfa_enrollments,mfa_recovery_codes TO nuqta_auth;
GRANT UPDATE(totp_secret,last_totp_counter) ON users TO nuqta_auth;
ALTER TABLE mfa_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY mfa_enrollment_auth ON mfa_enrollments USING(current_user='nuqta_auth') WITH CHECK(current_user='nuqta_auth');
CREATE POLICY mfa_recovery_auth ON mfa_recovery_codes USING(current_user='nuqta_auth') WITH CHECK(current_user='nuqta_auth');
