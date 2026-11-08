-- Surface per-IP restrictions through the existing scoped, audited account controls.
CREATE FUNCTION password_guard_locked_until(email_arg text) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT max(g.locked_until) FROM (SELECT locked_until FROM password_login_guards WHERE email=email_arg UNION ALL SELECT locked_until FROM password_login_ip_guards WHERE email=email_arg) g WHERE g.locked_until>now()
$$;
REVOKE ALL ON FUNCTION password_guard_locked_until(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION staff_account_security(mid uuid) RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT is_platform_admin() AND NOT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.role='owner' AND s.status='active' AND u.status='active') THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 RETURN QUERY SELECT jsonb_build_object('id',s.id,'email',s.email,'name',s.name,'role',s.role,'status',s.status,'revision',s.revision,'max_qty',s.max_qty,'user_status',u.status,
 'branch_ids',coalesce((SELECT jsonb_agg(g.branch_id ORDER BY g.branch_id) FROM staff_branch_grants g WHERE g.staff_id=s.id),'[]'),
 'branches',coalesce((SELECT jsonb_agg(b.name ORDER BY b.name) FROM staff_branch_grants g JOIN branches b ON b.id=g.branch_id WHERE g.staff_id=s.id),'[]'),
 'self',u.id=app_user(),'canManageCredentials',can_manage_staff_credentials(mid,s.id),
 'credentialVersion',CASE WHEN can_manage_staff_credentials(mid,s.id) THEN u.password_version END,
 'passwordSet',u.password_hash IS NOT NULL,'passwordChangedAt',CASE WHEN can_manage_staff_credentials(mid,s.id) OR u.id=app_user() THEN u.password_changed_at END,
 'activeSessions',CASE WHEN can_manage_staff_credentials(mid,s.id) OR u.id=app_user() THEN (SELECT count(*)::int FROM sessions session WHERE session.user_id=u.id AND session.revoked_at IS NULL AND session.expires_at>now() AND session.credential_version=u.password_version AND u.status='active') END,
 'lockedUntil',CASE WHEN can_manage_staff_credentials(mid,s.id) THEN password_guard_locked_until(u.email) END)
 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=mid ORDER BY s.role,s.name;
END $$;

CREATE OR REPLACE FUNCTION platform_admin_accounts() RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT is_platform_admin() THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 RETURN QUERY SELECT jsonb_build_object('id',u.id,'name',u.display_name,'email',u.email,'status',u.status,'self',u.id=app_user(),'credentialVersion',u.password_version,'passwordSet',u.password_hash IS NOT NULL,'passwordChangedAt',u.password_changed_at,'createdAt',u.created_at,'activeSessions',(SELECT count(*)::int FROM sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL AND s.expires_at>now() AND s.credential_version=u.password_version),'lastSignIn',(SELECT max(s.created_at) FROM sessions s WHERE s.user_id=u.id),'lockedUntil',password_guard_locked_until(u.email)) FROM users u WHERE u.global_role='platform_admin' ORDER BY u.created_at,u.id;
END $$;

