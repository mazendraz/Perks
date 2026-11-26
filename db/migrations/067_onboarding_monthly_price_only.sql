-- Self-service sign-up charges the plan's monthly price only (no per-branch setup fee), so the
-- amount a shop owner is asked to transfer matches the price on the /business landing page.
-- The plans offered are exactly the ones publish_merchant_onboarding accepts, so an owner can
-- never pay for a plan (Scale, Enterprise, …) that self-service publishing would then refuse.
-- Orders already quoted keep their amount: they store it themselves.
CREATE OR REPLACE FUNCTION merchant_onboarding_monthly_plans()
RETURNS TABLE (plan_id uuid, plan_key text, name_ar text, name_en text, amount_minor integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p.id,p.key,p.name_ar,p.name_en,pr.amount_minor
 FROM plans p JOIN plan_prices pr ON pr.plan_id=p.id
 WHERE p.key IN ('starter','growth','pro')
   AND p.is_public AND p.is_active AND NOT p.is_custom
   AND pr.is_active AND pr.currency='EGP' AND pr.billing_period='monthly'
   AND pr.amount_minor > 0
 ORDER BY p.sort_order,p.key
$$;
REVOKE ALL ON FUNCTION merchant_onboarding_monthly_plans() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merchant_onboarding_monthly_plans() TO nuqta_runtime;
