ALTER TABLE merchants DROP CONSTRAINT merchants_template_check;
ALTER TABLE merchants ADD CONSTRAINT merchants_template_check CHECK(template IN ('classic','minimal','bold','noir','editorial','botanical','ticket','mosaic','aurora'));
CREATE TABLE provisioning_logos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),draft_id uuid NOT NULL REFERENCES provisioning_drafts(id),created_by uuid NOT NULL REFERENCES users(id),
 bytes integer NOT NULL,width integer NOT NULL,height integer NOT NULL,sha256 text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE provisioning_credentials (
 draft_id uuid NOT NULL REFERENCES provisioning_drafts(id),email text NOT NULL,password_hash text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(draft_id,email)
);
ALTER TABLE provisioning_logos ENABLE ROW LEVEL SECURITY;
ALTER TABLE provisioning_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY draft_logo_access ON provisioning_logos USING(is_platform_admin() AND created_by=app_user()) WITH CHECK(is_platform_admin() AND created_by=app_user());
CREATE POLICY draft_credential_access ON provisioning_credentials USING(is_platform_admin() AND created_by=app_user()) WITH CHECK(is_platform_admin() AND created_by=app_user());
GRANT SELECT,INSERT,UPDATE,DELETE ON provisioning_logos,provisioning_credentials TO nuqta_runtime;
CREATE FUNCTION create_staff_password_account(mid uuid,email_arg text,hash_arg text,role_arg text,qty_arg integer,branches_arg uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE uid uuid;sid uuid;limits feature_entitlements;bid uuid;
BEGIN
 IF NOT is_platform_admin() AND NOT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.role='owner' AND s.status='active' AND u.status='active') THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 PERFORM 1 FROM merchants WHERE id=mid AND status IN ('active','trial') FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'NQ:MERCHANT_PAUSED';END IF;
 IF role_arg NOT IN ('owner','manager','cashier') OR qty_arg NOT BETWEEN 1 AND 100 OR coalesce(cardinality(branches_arg),0) NOT BETWEEN 1 AND 10 OR hash_arg !~ '^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$' THEN RAISE EXCEPTION 'NQ:INVALID_ACCOUNT';END IF;
 IF cardinality(branches_arg)<>(SELECT count(DISTINCT b) FROM unnest(branches_arg) b) THEN RAISE EXCEPTION 'NQ:BRANCH_UNAUTHORIZED';END IF;
 FOREACH bid IN ARRAY branches_arg LOOP
  IF NOT EXISTS(SELECT 1 FROM branches WHERE id=bid AND merchant_id=mid AND status='active') OR (NOT is_platform_admin() AND NOT branch_access(mid,bid)) THEN RAISE EXCEPTION 'NQ:BRANCH_UNAUTHORIZED';END IF;
 END LOOP;
 SELECT * INTO limits FROM feature_entitlements WHERE merchant_id=mid FOR UPDATE;
 IF NOT FOUND OR (SELECT count(*) FROM staff_memberships WHERE merchant_id=mid)+(SELECT count(*) FROM invitations WHERE merchant_id=mid AND status='pending' AND expires_at>now())>=limits.max_staff THEN RAISE EXCEPTION 'NQ:PLAN_LIMIT';END IF;
 INSERT INTO users(email,display_name,password_hash,password_version) VALUES(lower(email_arg),split_part(email_arg,'@',1),hash_arg,1) ON CONFLICT(email) DO NOTHING RETURNING id INTO uid;
 IF uid IS NULL THEN RAISE EXCEPTION 'NQ:ACCOUNT_EXISTS_USE_INVITATION';END IF;
 INSERT INTO staff_memberships(merchant_id,user_id,email,name,role,max_qty) VALUES(mid,uid,lower(email_arg),split_part(email_arg,'@',1),role_arg,qty_arg) RETURNING id INTO sid;
 FOREACH bid IN ARRAY branches_arg LOOP INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES(mid,sid,bid);END LOOP;
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail) VALUES(app_user(),mid,'staff.account.create',sid,jsonb_build_object('role',role_arg,'branchIds',branches_arg));
 RETURN jsonb_build_object('id',sid,'userId',uid,'email',lower(email_arg),'role',role_arg,'status','active');
END $$;
REVOKE ALL ON FUNCTION create_staff_password_account(uuid,text,text,text,integer,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_staff_password_account(uuid,text,text,text,integer,uuid[]) TO nuqta_runtime;
