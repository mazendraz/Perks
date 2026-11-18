-- Subscription plans, phase 5: a cancelled shop is read-only. Customers keep their cards and can
-- still redeem rewards they earned; the shop can export its customers as CSV for 30 days.

ALTER TABLE merchant_subscriptions ADD COLUMN cancelled_at timestamptz;
UPDATE merchant_subscriptions SET cancelled_at=updated_at WHERE status='cancelled';
ALTER TABLE merchant_subscriptions ADD CONSTRAINT cancelled_has_date CHECK((status='cancelled')=(cancelled_at IS NOT NULL));

CREATE FUNCTION merchant_subscriptions_cancelled_at() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status='cancelled' AND (TG_OP='INSERT' OR OLD.status<>'cancelled') THEN NEW.cancelled_at:=clock_timestamp();
 ELSIF NEW.status<>'cancelled' THEN NEW.cancelled_at:=NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER merchant_subscriptions_cancelled_at BEFORE INSERT OR UPDATE OF status ON merchant_subscriptions
 FOR EACH ROW EXECUTE FUNCTION merchant_subscriptions_cancelled_at();

-- 'normal', 'read_only' (cancelled, CSV still open) or 'closed' (cancelled over 30 days ago).
-- Members of the shop only; anyone else gets 'normal' and the route answers NOT_FOUND as usual.
CREATE FUNCTION merchant_subscription_mode(mid uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN NOT tenant_access(mid) OR s.status IS DISTINCT FROM 'cancelled' THEN 'normal'
  WHEN s.cancelled_at>clock_timestamp()-interval '30 days' THEN 'read_only' ELSE 'closed' END
 FROM (SELECT 1) one LEFT JOIN merchant_subscriptions s ON s.merchant_id=mid
$$;
REVOKE ALL ON FUNCTION merchant_subscription_mode(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merchant_subscription_mode(uuid) TO nuqta_runtime;

-- No new stamps once the subscription is cancelled. Every earning path (cashier award, customer
-- request, automatic stamp) already asks this, and customers see the neutral "paused" message.
CREATE OR REPLACE FUNCTION merchant_earning_allowed(mid uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce((SELECT NOT e.earning_paused FROM feature_entitlements e WHERE e.merchant_id=mid),false)
  AND coalesce((SELECT s.status<>'cancelled' FROM merchant_subscriptions s WHERE s.merchant_id=mid),true)
$$;

-- Defence in depth: the plan a downgrade lands on is the owner's (or the platform's) business only.
CREATE OR REPLACE FUNCTION keep_limit(mid uuid,k text) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE pending uuid; r record;
BEGIN
 IF NOT (is_platform_admin() OR merchant_owner(mid)) THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 SELECT pending_plan_id INTO pending FROM merchant_subscriptions WHERE merchant_id=mid;
 IF pending IS NOT NULL THEN
  SELECT value_type,int_value INTO r FROM plan_entitlements WHERE plan_id=pending AND key=k;
  IF NOT FOUND OR r.value_type='unlimited' THEN RETURN NULL; END IF;
  RETURN CASE WHEN k='max_branches' THEN greatest(r.int_value,1) ELSE r.int_value END;
 END IF;
 SELECT value_type,int_value INTO r FROM entitlements_effective_rows(mid) e WHERE e.key=k;
 IF NOT FOUND OR r.value_type='unlimited' THEN RETURN NULL; END IF;
 RETURN CASE WHEN k='max_branches' THEN greatest(r.int_value,1) ELSE r.int_value END;
END $$;
