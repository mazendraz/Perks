CREATE FUNCTION start_merchant_signup(email_arg text, name_arg text, locale_arg text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE uid uuid;
BEGIN
 INSERT INTO users(email,display_name,preferred_locale)
 VALUES(email_arg,name_arg,locale_arg) ON CONFLICT(email) DO NOTHING RETURNING id INTO uid;
 IF uid IS NOT NULL THEN
  INSERT INTO merchant_onboarding_drafts(owner_id) VALUES(uid);
  RETURN uid;
 END IF;
 SELECT u.id INTO uid FROM users u
 WHERE u.email=email_arg AND u.status='active' AND u.password_hash IS NULL
   AND EXISTS (SELECT 1 FROM merchant_onboarding_drafts d WHERE d.owner_id=u.id AND d.merchant_id IS NULL);
 RETURN uid;
END $$;
REVOKE ALL ON FUNCTION start_merchant_signup(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_merchant_signup(text,text,text) TO nuqta_auth;

CREATE OR REPLACE FUNCTION password_session_portal(uid uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN u.global_role IN ('platform_admin','platform_support') THEN 'platform'
 WHEN EXISTS(SELECT 1 FROM staff_memberships s WHERE s.user_id=u.id AND s.status='active' AND s.role IN ('owner','manager')) THEN 'merchant'
 WHEN EXISTS(SELECT 1 FROM staff_memberships s WHERE s.user_id=u.id AND s.status='active' AND s.role='cashier') THEN 'cashier'
 WHEN EXISTS(SELECT 1 FROM merchant_onboarding_drafts d WHERE d.owner_id=u.id AND d.merchant_id IS NULL) THEN 'merchant'
 ELSE 'customer' END FROM users u WHERE u.id=uid AND u.status='active'
$$;
