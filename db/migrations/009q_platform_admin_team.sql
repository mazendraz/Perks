CREATE FUNCTION platform_admin_accounts() RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT is_platform_admin() THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 RETURN QUERY SELECT jsonb_build_object('id',u.id,'name',u.display_name,'email',u.email,'status',u.status,'self',u.id=app_user(),'credentialVersion',u.password_version,'passwordSet',u.password_hash IS NOT NULL,'passwordChangedAt',u.password_changed_at,'createdAt',u.created_at,'activeSessions',(SELECT count(*)::int FROM sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL AND s.expires_at>now() AND s.credential_version=u.password_version),'lastSignIn',(SELECT max(s.created_at) FROM sessions s WHERE s.user_id=u.id),'lockedUntil',(SELECT g.locked_until FROM password_login_guards g WHERE g.email=u.email AND g.locked_until>now())) FROM users u WHERE u.global_role='platform_admin' ORDER BY u.created_at,u.id;
END $$;

CREATE FUNCTION create_platform_admin(email_arg text,name_arg text,hash_arg text,reason_arg text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE uid uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('platform-admin-team',0));
 PERFORM 1 FROM users WHERE id=app_user() AND global_role='platform_admin' AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF email_arg IS NULL OR email_arg<>lower(email_arg) OR char_length(email_arg) NOT BETWEEN 6 AND 254 OR position('@' in email_arg)<2 OR coalesce(char_length(trim(name_arg)),0) NOT BETWEEN 1 AND 100 OR coalesce(char_length(trim(reason_arg)),0) NOT BETWEEN 4 AND 500 OR hash_arg IS NULL OR hash_arg !~ '^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$' THEN RAISE EXCEPTION 'NQ:INVALID_ACCOUNT';END IF;
 IF EXISTS(SELECT 1 FROM users WHERE email=email_arg) THEN RAISE EXCEPTION 'NQ:ADMIN_EMAIL_IN_USE';END IF;
 INSERT INTO users(email,display_name,global_role,password_hash,password_version) VALUES(email_arg,trim(name_arg),'platform_admin',hash_arg,1) RETURNING id INTO uid;
 INSERT INTO audit_events(actor_id,action,target_id,detail) VALUES(app_user(),'platform.admin.create',uid,jsonb_build_object('reason',trim(reason_arg)));
 RETURN jsonb_build_object('id',uid,'name',trim(name_arg),'email',email_arg,'status','active');
END $$;

CREATE FUNCTION manage_platform_admin(uid uuid,action_arg text,hash_arg text,version_arg integer,reason_arg text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target_user users;revoked integer:=0;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('platform-admin-team',0));
 PERFORM 1 FROM users WHERE id=app_user() AND global_role='platform_admin' AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 SELECT * INTO target_user FROM users WHERE id=uid AND global_role='platform_admin' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF action_arg IS NULL OR action_arg NOT IN ('password','sessions','unlock','disable','enable') OR coalesce(char_length(trim(reason_arg)),0) NOT BETWEEN 4 AND 500 THEN RAISE EXCEPTION 'NQ:INVALID_ACCOUNT_ACTION';END IF;
 IF version_arg IS DISTINCT FROM target_user.password_version THEN RAISE EXCEPTION 'NQ:REVISION_CONFLICT';END IF;
 IF action_arg='disable' AND target_user.status='active' AND (SELECT count(*) FROM users WHERE global_role='platform_admin' AND status='active')<=1 THEN RAISE EXCEPTION 'NQ:LAST_PLATFORM_ADMIN';END IF;
 IF uid=app_user() THEN RAISE EXCEPTION 'NQ:ADMIN_SELF_MANAGEMENT';END IF;
 IF action_arg<>'password' AND hash_arg IS NOT NULL THEN RAISE EXCEPTION 'NQ:INVALID_ACCOUNT_ACTION';END IF;
 IF action_arg='password' THEN
  IF hash_arg IS NULL OR hash_arg !~ '^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$' THEN RAISE EXCEPTION 'NQ:INVALID_ACCOUNT';END IF;
  UPDATE users SET password_hash=hash_arg,password_version=password_version+1 WHERE id=uid;
 ELSIF action_arg='sessions' THEN UPDATE users SET password_version=password_version+1 WHERE id=uid;
 ELSIF action_arg IN ('disable','enable') THEN UPDATE users SET status=CASE WHEN action_arg='disable' THEN 'disabled' ELSE 'active' END,password_version=password_version+1 WHERE id=uid;
 ELSIF hash_arg IS NOT NULL THEN RAISE EXCEPTION 'NQ:INVALID_ACCOUNT_ACTION';
 END IF;
 IF action_arg IN ('password','sessions','disable','enable') THEN UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=uid AND revoked_at IS NULL;GET DIAGNOSTICS revoked=ROW_COUNT;END IF;
 IF action_arg IN ('password','unlock') THEN UPDATE password_login_guards SET failures=0,locked_until=NULL WHERE email=target_user.email;END IF;
 INSERT INTO audit_events(actor_id,action,target_id,detail) VALUES(app_user(),'platform.admin.'||action_arg,uid,jsonb_build_object('reason',trim(reason_arg),'sessionsRevoked',revoked));
 RETURN jsonb_build_object('id',uid,'action',action_arg,'sessionsRevoked',revoked);
END $$;
REVOKE ALL ON FUNCTION platform_admin_accounts(),create_platform_admin(text,text,text,text),manage_platform_admin(uuid,text,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_admin_accounts(),create_platform_admin(text,text,text,text),manage_platform_admin(uuid,text,text,integer,text) TO nuqta_runtime;
