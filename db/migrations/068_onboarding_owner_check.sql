-- True for someone who signed up as a shop owner and has not published yet: an open
-- self-service draft and no staff role anywhere. Setting the first password signs such an owner
-- straight in and back to their draft; nobody else (staff, platform users) gets that shortcut.
CREATE FUNCTION is_onboarding_owner(uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM merchant_onboarding_drafts d WHERE d.owner_id=uid AND d.merchant_id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM staff_memberships s WHERE s.user_id=uid AND s.status='active')
    AND EXISTS(SELECT 1 FROM users u WHERE u.id=uid AND u.status='active' AND u.global_role='customer')
$$;
REVOKE ALL ON FUNCTION is_onboarding_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_onboarding_owner(uuid) TO nuqta_auth;
