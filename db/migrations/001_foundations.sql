CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK(email=lower(email)),
  display_name text NOT NULL,
  global_role text NOT NULL DEFAULT 'customer' CHECK(global_role IN ('platform_admin','platform_support','customer')),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  auth_subject text UNIQUE,
  totp_secret text,
  last_totp_counter bigint NOT NULL DEFAULT -1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),email text NOT NULL,code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,attempts integer NOT NULL DEFAULT 0,used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_challenges_email_time ON auth_challenges(email,created_at DESC);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,csrf_hash text NOT NULL,expires_at timestamptz NOT NULL,
  mfa_at timestamptz,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_active ON sessions(user_id,expires_at) WHERE revoked_at IS NULL;
CREATE TABLE merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),slug text NOT NULL UNIQUE CHECK(slug~'^[a-z0-9][a-z0-9-]{1,62}$'),
  name text NOT NULL,status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','trial','suspended')),
  timezone text NOT NULL DEFAULT 'Africa/Cairo',primary_color text NOT NULL DEFAULT '#6F3F22',
  accent_color text NOT NULL DEFAULT '#E2A85B',surface_color text NOT NULL DEFAULT '#FBF5EE',
  template text NOT NULL DEFAULT 'classic' CHECK(template IN ('classic','minimal','bold')),
  terms text NOT NULL DEFAULT '',contact_email text NOT NULL DEFAULT '',revision integer NOT NULL DEFAULT 1,
  suspend_reason text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants(id),
  name text NOT NULL,address text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  UNIQUE(merchant_id,id)
);
CREATE TABLE staff_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants(id),user_id uuid NOT NULL REFERENCES users(id),
  email text NOT NULL,name text NOT NULL,role text NOT NULL CHECK(role IN ('owner','manager','cashier')),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  max_qty integer NOT NULL DEFAULT 3 CHECK(max_qty BETWEEN 1 AND 100),revision integer NOT NULL DEFAULT 1,
  UNIQUE(merchant_id,user_id),UNIQUE(merchant_id,id)
);
CREATE TABLE staff_branch_grants (
  merchant_id uuid NOT NULL,staff_id uuid NOT NULL,branch_id uuid NOT NULL,
  PRIMARY KEY(staff_id,branch_id),
  FOREIGN KEY(merchant_id,staff_id) REFERENCES staff_memberships(merchant_id,id),
  FOREIGN KEY(merchant_id,branch_id) REFERENCES branches(merchant_id,id)
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES users(id),merchant_id uuid REFERENCES merchants(id),
  action text NOT NULL,target_id uuid,detail jsonb NOT NULL DEFAULT '{}',at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX audit_merchant_at ON audit_events(merchant_id,at DESC,id);
CREATE FUNCTION app_user() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id',true),'')::uuid $$;
CREATE FUNCTION is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM users WHERE id=app_user() AND global_role='platform_admin' AND status='active')
$$;
CREATE FUNCTION tenant_access(mid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT is_platform_admin() OR EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.status='active' AND u.status='active')
$$;
CREATE FUNCTION branch_access(mid uuid,bid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT is_platform_admin() OR EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id JOIN staff_branch_grants g ON g.staff_id=s.id AND g.merchant_id=s.merchant_id WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.status='active' AND u.status='active' AND g.branch_id=bid)
$$;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_access ON users USING(id=app_user() OR is_platform_admin() OR current_user='nuqta_auth');
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sessions_auth ON sessions USING(current_user='nuqta_auth') WITH CHECK(current_user='nuqta_auth');
ALTER TABLE auth_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY challenges_auth ON auth_challenges USING(current_user='nuqta_auth') WITH CHECK(current_user='nuqta_auth');
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_access ON merchants USING(tenant_access(id)) WITH CHECK(is_platform_admin());
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_access_policy ON branches USING(branch_access(merchant_id,id)) WITH CHECK(tenant_access(merchant_id));
ALTER TABLE staff_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_access ON staff_memberships USING(tenant_access(merchant_id)) WITH CHECK(tenant_access(merchant_id));
ALTER TABLE staff_branch_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY grants_access ON staff_branch_grants USING(tenant_access(merchant_id)) WITH CHECK(tenant_access(merchant_id));
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_access ON audit_events USING(tenant_access(merchant_id) OR is_platform_admin()) WITH CHECK(actor_id=app_user() AND (merchant_id IS NULL OR tenant_access(merchant_id)));
CREATE FUNCTION immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable row' USING ERRCODE='42501'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION immutable_row();
