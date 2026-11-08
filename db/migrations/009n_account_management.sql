ALTER TABLE merchants ADD COLUMN contact_phone text NOT NULL DEFAULT '' CHECK(contact_phone='' OR contact_phone ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE users ADD COLUMN password_changed_at timestamptz;
CREATE FUNCTION record_password_change() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN IF NEW.password_hash IS NOT NULL AND (TG_OP='INSERT' OR NEW.password_hash IS DISTINCT FROM OLD.password_hash) THEN NEW.password_changed_at=clock_timestamp();END IF;RETURN NEW;END $$;
CREATE TRIGGER password_change_time BEFORE INSERT OR UPDATE OF password_hash ON users FOR EACH ROW EXECUTE FUNCTION record_password_change();
CREATE TABLE business_managed_accounts(user_id uuid PRIMARY KEY REFERENCES users(id),merchant_id uuid NOT NULL REFERENCES merchants(id),provisioned_by uuid NOT NULL REFERENCES users(id));
ALTER TABLE business_managed_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON business_managed_accounts FROM PUBLIC;
INSERT INTO business_managed_accounts(user_id,merchant_id,provisioned_by)
 SELECT DISTINCT ON(s.user_id) s.user_id,s.merchant_id,a.actor_id FROM audit_events a JOIN staff_memberships s ON s.id=a.target_id AND s.merchant_id=a.merchant_id WHERE a.action='staff.account.create' AND a.actor_id IS NOT NULL ORDER BY s.user_id,a.at;

CREATE FUNCTION can_manage_staff_credentials(mid uuid,sid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM staff_memberships target JOIN users u ON u.id=target.user_id WHERE target.id=sid AND target.merchant_id=mid AND u.global_role='customer' AND u.id<>app_user() AND (
 is_platform_admin() OR (target.role IN ('manager','cashier')
 AND EXISTS(SELECT 1 FROM staff_memberships owner JOIN users actor ON actor.id=owner.user_id WHERE owner.merchant_id=mid AND owner.user_id=app_user() AND owner.role='owner' AND owner.status='active' AND actor.status='active')
 AND EXISTS(SELECT 1 FROM business_managed_accounts managed WHERE managed.user_id=u.id AND managed.merchant_id=mid)
 AND NOT EXISTS(SELECT 1 FROM staff_memberships other WHERE other.user_id=u.id AND other.merchant_id<>mid)
 AND NOT EXISTS(SELECT 1 FROM tenant_customer_profiles other WHERE other.user_id=u.id AND other.merchant_id<>mid)
 AND NOT EXISTS(SELECT 1 FROM staff_branch_grants g WHERE g.staff_id=target.id AND NOT branch_access(mid,g.branch_id)))))
$$;
CREATE FUNCTION staff_account_security(mid uuid) RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT is_platform_admin() AND NOT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.role='owner' AND s.status='active' AND u.status='active') THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 RETURN QUERY SELECT jsonb_build_object('id',s.id,'email',s.email,'name',s.name,'role',s.role,'status',s.status,'revision',s.revision,'max_qty',s.max_qty,'user_status',u.status,
 'branch_ids',coalesce((SELECT jsonb_agg(g.branch_id ORDER BY g.branch_id) FROM staff_branch_grants g WHERE g.staff_id=s.id),'[]'),
 'branches',coalesce((SELECT jsonb_agg(b.name ORDER BY b.name) FROM staff_branch_grants g JOIN branches b ON b.id=g.branch_id WHERE g.staff_id=s.id),'[]'),
 'self',u.id=app_user(),'canManageCredentials',can_manage_staff_credentials(mid,s.id),
 'credentialVersion',CASE WHEN can_manage_staff_credentials(mid,s.id) THEN u.password_version END,
 'passwordSet',u.password_hash IS NOT NULL,'passwordChangedAt',CASE WHEN can_manage_staff_credentials(mid,s.id) OR u.id=app_user() THEN u.password_changed_at END,
 'activeSessions',CASE WHEN can_manage_staff_credentials(mid,s.id) OR u.id=app_user() THEN (SELECT count(*)::int FROM sessions session WHERE session.user_id=u.id AND session.revoked_at IS NULL AND session.expires_at>now() AND session.credential_version=u.password_version AND u.status='active') END,
 'lockedUntil',CASE WHEN can_manage_staff_credentials(mid,s.id) THEN (SELECT locked_until FROM password_login_guards WHERE email=u.email AND locked_until>now()) END)
 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=mid ORDER BY s.role,s.name;
END $$;
CREATE FUNCTION manage_staff_security(mid uuid,sid uuid,action_arg text,hash_arg text,version_arg integer,reason_arg text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE uid uuid;email_arg text;current_version integer;revoked integer;
BEGIN
 PERFORM 1 FROM merchants WHERE id=mid FOR SHARE;
 PERFORM 1 FROM staff_memberships WHERE merchant_id=mid AND user_id=app_user() FOR SHARE;
 SELECT user_id INTO uid FROM staff_memberships WHERE merchant_id=mid AND id=sid FOR UPDATE;
 IF uid IS NULL OR NOT can_manage_staff_credentials(mid,sid) THEN RAISE EXCEPTION 'NQ:ACCOUNT_SECURITY_NOT_MANAGED';END IF;
 SELECT email,password_version INTO email_arg,current_version FROM users WHERE id=uid FOR UPDATE;
 IF NOT can_manage_staff_credentials(mid,sid) THEN RAISE EXCEPTION 'NQ:ACCOUNT_SECURITY_NOT_MANAGED';END IF;
 IF action_arg NOT IN ('password','sessions','unlock') OR char_length(reason_arg) NOT BETWEEN 4 AND 500 THEN RAISE EXCEPTION 'NQ:INVALID_ACCOUNT_ACTION';END IF;
 IF version_arg IS DISTINCT FROM current_version THEN RAISE EXCEPTION 'NQ:REVISION_CONFLICT';END IF;
 IF action_arg='password' THEN
  IF hash_arg IS NULL OR hash_arg !~ '^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$' THEN RAISE EXCEPTION 'NQ:INVALID_ACCOUNT';END IF;
  UPDATE users SET password_hash=hash_arg,password_version=password_version+1 WHERE id=uid;
 ELSIF action_arg='sessions' THEN UPDATE users SET password_version=password_version+1 WHERE id=uid;
 END IF;
 revoked:=0;
 IF action_arg IN ('password','sessions') THEN
  UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=uid AND revoked_at IS NULL;GET DIAGNOSTICS revoked=ROW_COUNT;
 END IF;
 IF action_arg IN ('password','unlock') THEN UPDATE password_login_guards SET failures=0,locked_until=NULL WHERE email=email_arg;END IF;
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail) VALUES(app_user(),mid,'staff.security.'||action_arg,sid,jsonb_build_object('reason',reason_arg,'sessionsRevoked',revoked));
 RETURN jsonb_build_object('id',sid,'action',action_arg,'sessionsRevoked',revoked);
END $$;
REVOKE ALL ON FUNCTION can_manage_staff_credentials(uuid,uuid),staff_account_security(uuid),manage_staff_security(uuid,uuid,text,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION can_manage_staff_credentials(uuid,uuid),staff_account_security(uuid),manage_staff_security(uuid,uuid,text,text,integer,text) TO nuqta_runtime;

CREATE OR REPLACE FUNCTION create_staff_password_account(mid uuid,email_arg text,hash_arg text,role_arg text,qty_arg integer,branches_arg uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
 INSERT INTO business_managed_accounts(user_id,merchant_id,provisioned_by) VALUES(uid,mid,app_user());
 FOREACH bid IN ARRAY branches_arg LOOP INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES(mid,sid,bid);END LOOP;
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail) VALUES(app_user(),mid,'staff.account.create',sid,jsonb_build_object('role',role_arg,'branchIds',branches_arg));
 RETURN jsonb_build_object('id',sid,'userId',uid,'email',lower(email_arg),'role',role_arg,'status','active');
END $$;

ALTER TABLE tenant_customer_profiles ADD COLUMN contact_phone text NOT NULL DEFAULT '' CHECK(contact_phone='' OR contact_phone ~ '^\+[1-9][0-9]{7,14}$');
CREATE FUNCTION customer_contact_state(mid uuid,profile_arg uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cp tenant_customer_profiles;consented boolean;rev integer;
BEGIN
 SELECT * INTO cp FROM tenant_customer_profiles WHERE merchant_id=mid AND id=profile_arg;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF NOT is_platform_admin() AND cp.user_id<>app_user() AND NOT EXISTS(SELECT 1 FROM customer_directory(mid,NULL,'all',profile_arg,1,0)) THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 SELECT granted,revision INTO consented,rev FROM consent_current WHERE merchant_id=mid AND user_id=cp.user_id AND channel='whatsapp';
 RETURN jsonb_build_object('contactPhone',CASE WHEN coalesce(consented,false) OR cp.user_id=app_user() THEN cp.contact_phone ELSE '' END,'phonePresent',cp.contact_phone<>'','whatsappConsent',coalesce(consented,false),'revision',rev);
END $$;
CREATE FUNCTION set_customer_contact_phone(mid uuid,phone_arg text,initial_only boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cp tenant_customer_profiles;changed boolean;
BEGIN
 IF phone_arg IS NULL OR (phone_arg<>'' AND phone_arg !~ '^\+[1-9][0-9]{7,14}$') THEN RAISE EXCEPTION 'NQ:INVALID_PHONE';END IF;
 SELECT * INTO cp FROM tenant_customer_profiles WHERE merchant_id=mid AND user_id=app_user() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF initial_only AND cp.contact_phone<>'' AND cp.contact_phone<>phone_arg THEN RAISE EXCEPTION 'NQ:PHONE_UPDATE_FROM_PREFERENCES';END IF;
 changed:=cp.contact_phone<>phone_arg;
 IF changed THEN
  UPDATE tenant_customer_profiles SET contact_phone=phone_arg WHERE id=cp.id;
  IF NOT initial_only THEN
   INSERT INTO consent_events(merchant_id,user_id,channel,granted) VALUES(mid,app_user(),'whatsapp',false);
   INSERT INTO consent_current(merchant_id,user_id,channel,granted) VALUES(mid,app_user(),'whatsapp',false) ON CONFLICT(merchant_id,user_id,channel) DO UPDATE SET granted=false,revision=consent_current.revision+1,updated_at=clock_timestamp();
  END IF;
 END IF;
 RETURN jsonb_build_object('contactPhone',phone_arg,'whatsappConsentReset',changed AND NOT initial_only);
END $$;
CREATE FUNCTION merchant_contact_readiness(mid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT is_platform_admin() THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 RETURN jsonb_build_object('missing_phones',(SELECT count(*)::int FROM tenant_customer_profiles WHERE merchant_id=mid AND contact_phone=''),'whatsapp_ready',(SELECT count(*)::int FROM tenant_customer_profiles cp JOIN consent_current c ON c.merchant_id=cp.merchant_id AND c.user_id=cp.user_id AND c.channel='whatsapp' AND c.granted WHERE cp.merchant_id=mid AND cp.contact_phone<>''));
END $$;
CREATE FUNCTION whatsapp_customer_recipient(mid uuid,profile_arg uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cp tenant_customer_profiles;consented boolean;rev integer;
BEGIN
 IF NOT is_platform_admin() AND NOT EXISTS(SELECT 1 FROM customer_directory(mid,NULL,'all',profile_arg,1,0)) THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 SELECT * INTO cp FROM tenant_customer_profiles WHERE merchant_id=mid AND id=profile_arg FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 SELECT granted,revision INTO consented,rev FROM consent_current WHERE merchant_id=mid AND user_id=cp.user_id AND channel='whatsapp' FOR SHARE;
 IF NOT coalesce(consented,false) THEN RAISE EXCEPTION 'NQ:WHATSAPP_CONSENT_REQUIRED';END IF;
 IF cp.contact_phone='' THEN RAISE EXCEPTION 'NQ:WHATSAPP_PHONE_REQUIRED';END IF;
 RETURN jsonb_build_object('contact_phone',cp.contact_phone,'revision',rev);
END $$;
REVOKE ALL ON FUNCTION customer_contact_state(uuid,uuid),set_customer_contact_phone(uuid,text,boolean),merchant_contact_readiness(uuid),whatsapp_customer_recipient(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION customer_contact_state(uuid,uuid),set_customer_contact_phone(uuid,text,boolean),merchant_contact_readiness(uuid),whatsapp_customer_recipient(uuid,uuid) TO nuqta_runtime;
