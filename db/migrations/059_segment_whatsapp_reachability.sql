-- Owner analytics needs to know which customers can receive a WhatsApp draft (a number on
-- file and current WhatsApp consent) without the runtime role reading raw contact phones,
-- which 009d deliberately withholds. This returns only profile ids, only to an active owner
-- or manager of the shop; the caller's query still limits rows to the customers its
-- customer_stats row-level security lets it see.
CREATE FUNCTION whatsapp_reachable_profiles(mid uuid) RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT is_platform_admin() AND NOT EXISTS(
  SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id
  WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.status='active'
   AND s.role IN ('owner','manager') AND u.status='active'
 ) THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 RETURN QUERY
  SELECT cp.id FROM tenant_customer_profiles cp
  JOIN consent_current c ON c.merchant_id=cp.merchant_id AND c.user_id=cp.user_id
   AND c.channel='whatsapp' AND c.granted
  WHERE cp.merchant_id=mid AND cp.contact_phone<>'';
END $$;
REVOKE ALL ON FUNCTION whatsapp_reachable_profiles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION whatsapp_reachable_profiles(uuid) TO nuqta_runtime;
