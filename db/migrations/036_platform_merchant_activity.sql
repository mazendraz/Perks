-- Platform staff see when each business last had a real purchase, so quiet businesses can be followed up.
-- Counts only; no customer data leaves the tenant.
CREATE FUNCTION platform_merchant_activity() RETURNS TABLE(merchant_id uuid,last_purchase_at timestamptz,visits_7d integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT m.id,
  (SELECT max(t.at) FROM loyalty_transactions t WHERE t.merchant_id=m.id AND t.type='award' AND t.source<>'welcome'),
  (SELECT count(DISTINCT t.purchase_id)::int FROM loyalty_transactions t WHERE t.merchant_id=m.id AND t.type='award'
     AND t.source<>'welcome' AND t.at>=clock_timestamp()-interval '7 days')
 FROM merchants m WHERE is_platform_staff()
$$;
REVOKE ALL ON FUNCTION platform_merchant_activity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_merchant_activity() TO nuqta_runtime;
