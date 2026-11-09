-- Customer credentials contain no email/password. Existing identities are not merged.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT user_email_for_team CHECK(global_role='customer' OR email IS NOT NULL);
CREATE TABLE customer_identities (
 customer_id uuid PRIMARY KEY REFERENCES users(id),
 phone_e164 text UNIQUE CHECK(phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
 phone_normalized text UNIQUE,
 legacy boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(phone_e164 IS NOT DISTINCT FROM phone_normalized),
 CHECK(legacy OR phone_e164 IS NOT NULL)
);
-- Only a unique, consistent number across a customer's existing shops can be
-- migrated automatically. Conflicts remain legacy; no users/cards are merged.
WITH candidates AS (
 SELECT u.id,min(nullif(cp.contact_phone,'')) AS phone,
 count(DISTINCT nullif(cp.contact_phone,'')) AS number_count
 FROM users u JOIN tenant_customer_profiles cp ON cp.user_id=u.id
 WHERE u.global_role='customer' AND NOT EXISTS(SELECT 1 FROM staff_memberships s WHERE s.user_id=u.id)
 GROUP BY u.id
), labelled AS (
 SELECT *,count(*) OVER(PARTITION BY phone) AS owners FROM candidates
)
INSERT INTO customer_identities(customer_id,phone_e164,phone_normalized,legacy)
 SELECT id,CASE WHEN number_count=1 AND owners=1 THEN phone END,
 CASE WHEN number_count=1 AND owners=1 THEN phone END,
 NOT(number_count=1 AND owners=1) FROM labelled;

CREATE TABLE customer_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES customer_identities(customer_id),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '365 days',revoked_at timestamptz,
 user_agent_family text NOT NULL CHECK(user_agent_family IN ('Safari','Chrome','Firefox','Edge','Samsung Internet','Other')),
 UNIQUE(customer_id,id)
);
CREATE INDEX customer_devices_active ON customer_devices(customer_id,expires_at) WHERE revoked_at IS NULL;
ALTER TABLE sessions DROP CONSTRAINT sessions_auth_method_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_auth_method_check CHECK(auth_method IN ('otp','password','managed','device'));
ALTER TABLE sessions ADD COLUMN customer_device_id uuid;
ALTER TABLE sessions ADD CONSTRAINT session_customer_device FOREIGN KEY(user_id,customer_device_id) REFERENCES customer_devices(customer_id,id);
ALTER TABLE sessions ADD CONSTRAINT session_device_binding CHECK((auth_method='device')=(customer_device_id IS NOT NULL));

CREATE TABLE customer_recoveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES customer_identities(customer_id),
 merchant_id uuid NOT NULL,branch_id uuid NOT NULL,profile_id uuid NOT NULL,
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',used_at timestamptz,
 FOREIGN KEY(merchant_id,branch_id) REFERENCES branches(merchant_id,id),
 FOREIGN KEY(merchant_id,profile_id) REFERENCES tenant_customer_profiles(merchant_id,id)
);
CREATE INDEX customer_recovery_daily ON customer_recoveries(customer_id,created_at);
CREATE TABLE customer_auth_limits (
 key_hash text PRIMARY KEY CHECK(key_hash ~ '^[a-f0-9]{64}$'),
 window_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),attempts integer NOT NULL DEFAULT 1 CHECK(attempts>0)
);
CREATE TABLE customer_privacy_acceptances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES customer_identities(customer_id),
 device_id uuid NOT NULL,version text NOT NULL,text_hash text NOT NULL CHECK(text_hash ~ '^[a-f0-9]{64}$'),
 terms_text text NOT NULL,accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(customer_id,device_id) REFERENCES customer_devices(customer_id,id)
);
ALTER TABLE merchants ADD COLUMN cashier_recovery_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE customer_identities ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_identity_own ON customer_identities TO nuqta_runtime USING(customer_id=app_user());
CREATE POLICY customer_identity_auth ON customer_identities TO nuqta_auth USING(true) WITH CHECK(true);
ALTER TABLE customer_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_device_own ON customer_devices TO nuqta_runtime USING(customer_id=app_user());
CREATE POLICY customer_device_auth ON customer_devices TO nuqta_auth USING(true) WITH CHECK(true);
ALTER TABLE customer_recoveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_recovery_auth ON customer_recoveries TO nuqta_auth USING(true) WITH CHECK(true);
ALTER TABLE customer_auth_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_limit_auth ON customer_auth_limits TO nuqta_auth USING(true) WITH CHECK(true);
ALTER TABLE customer_privacy_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_privacy_own ON customer_privacy_acceptances TO nuqta_runtime USING(customer_id=app_user());
CREATE POLICY customer_privacy_auth ON customer_privacy_acceptances TO nuqta_auth USING(true) WITH CHECK(true);
GRANT SELECT ON customer_identities TO nuqta_runtime;
GRANT SELECT(id,customer_id,created_at,last_seen_at,expires_at,revoked_at,user_agent_family) ON customer_devices TO nuqta_runtime;
GRANT SELECT ON customer_privacy_acceptances TO nuqta_runtime;
GRANT SELECT,INSERT,UPDATE ON customer_identities,customer_devices,customer_recoveries,customer_auth_limits TO nuqta_auth;
GRANT SELECT,INSERT ON customer_privacy_acceptances TO nuqta_auth;

CREATE FUNCTION customer_device_active(device_arg uuid,user_arg uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM customer_devices d JOIN users u ON u.id=d.customer_id
 WHERE d.id=device_arg AND d.customer_id=user_arg AND u.status='active'
 AND d.revoked_at IS NULL AND d.expires_at>clock_timestamp())
$$;
REVOKE ALL ON FUNCTION customer_device_active(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION customer_device_active(uuid,uuid) TO nuqta_auth;

CREATE FUNCTION mask_customer_phone(phone_arg text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN coalesce(phone_arg,'')='' THEN '' ELSE left(phone_arg,4)||repeat('•',greatest(1,length(phone_arg)-7))||right(phone_arg,3) END
$$;
REVOKE ALL ON FUNCTION mask_customer_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mask_customer_phone(text) TO nuqta_runtime;
