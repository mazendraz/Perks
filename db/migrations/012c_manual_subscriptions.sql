ALTER TABLE feature_entitlements ADD COLUMN billing_required boolean NOT NULL DEFAULT false,
 ADD COLUMN earning_paused boolean NOT NULL DEFAULT false;
CREATE TABLE subscription_payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants(id),
 amount_minor integer NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),currency text NOT NULL DEFAULT 'EGP' CHECK(currency='EGP'),
 method text NOT NULL CHECK(method IN('instapay','cash','bank_transfer','vodafone_cash')),
 period_start date NOT NULL,period_end date NOT NULL CHECK(period_end>=period_start),
 starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 payment_reference text NOT NULL DEFAULT '' CHECK(length(payment_reference)<=100),reason text NOT NULL CHECK(length(reason) BETWEEN 4 AND 500),
 recorded_by uuid NOT NULL REFERENCES users(id),operation_id uuid NOT NULL UNIQUE REFERENCES operations(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(merchant_id,id)
);
CREATE TABLE subscription_payment_voids (
 payment_id uuid PRIMARY KEY,merchant_id uuid NOT NULL,recorded_by uuid NOT NULL REFERENCES users(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 4 AND 500),operation_id uuid NOT NULL UNIQUE REFERENCES operations(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),FOREIGN KEY(merchant_id,payment_id) REFERENCES subscription_payments(merchant_id,id)
);
CREATE TRIGGER subscription_payments_immutable BEFORE UPDATE OR DELETE ON subscription_payments FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER subscription_voids_immutable BEFORE UPDATE OR DELETE ON subscription_payment_voids FOR EACH ROW EXECUTE FUNCTION immutable_row();
ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_payment_voids ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_read ON subscription_payments FOR SELECT USING(is_platform_admin() OR EXISTS(SELECT 1 FROM staff_memberships WHERE merchant_id=subscription_payments.merchant_id AND user_id=app_user() AND role='owner' AND status='active'));
CREATE POLICY payment_insert ON subscription_payments FOR INSERT WITH CHECK(is_platform_admin() AND recorded_by=app_user());
CREATE POLICY payment_void_read ON subscription_payment_voids FOR SELECT USING(is_platform_admin() OR EXISTS(SELECT 1 FROM staff_memberships WHERE merchant_id=subscription_payment_voids.merchant_id AND user_id=app_user() AND role='owner' AND status='active'));
CREATE POLICY payment_void_insert ON subscription_payment_voids FOR INSERT WITH CHECK(is_platform_admin() AND recorded_by=app_user());
REVOKE ALL ON subscription_payments,subscription_payment_voids FROM PUBLIC;
GRANT SELECT,INSERT ON subscription_payments,subscription_payment_voids TO nuqta_runtime;
CREATE INDEX subscription_coverage ON subscription_payments(merchant_id,starts_at,ends_at);
CREATE INDEX subscription_reference_lookup ON subscription_payments(merchant_id,method,lower(payment_reference)) WHERE payment_reference<>'';
CREATE FUNCTION merchant_earning_allowed(mid uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce((SELECT NOT e.earning_paused AND (e.expires_at IS NULL OR e.expires_at>clock_timestamp()) AND
 (NOT e.billing_required OR EXISTS(SELECT 1 FROM subscription_payments p WHERE p.merchant_id=mid
 AND p.starts_at<=clock_timestamp() AND p.ends_at>clock_timestamp()
 AND NOT EXISTS(SELECT 1 FROM subscription_payment_voids v WHERE v.payment_id=p.id)))
 FROM feature_entitlements e WHERE e.merchant_id=mid),false)
$$;
REVOKE ALL ON FUNCTION merchant_earning_allowed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merchant_earning_allowed(uuid) TO nuqta_runtime;
