CREATE FUNCTION record_onboarding_payment(order_arg uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o merchant_onboarding_orders; d merchant_onboarding_drafts; operation_id uuid; starts timestamptz; ends timestamptz;
BEGIN
 SELECT * INTO o FROM merchant_onboarding_orders WHERE id=order_arg;
 IF o.confirmed_at IS NULL THEN RETURN; END IF;
 SELECT * INTO d FROM merchant_onboarding_drafts WHERE id=o.draft_id AND published_order_id=o.id;
 IF d.merchant_id IS NULL THEN RETURN; END IF;
 INSERT INTO operations(actor_id,merchant_id,scope,idempotency_key,request_hash,status,result,committed_at)
 VALUES(o.confirmed_by,d.merchant_id,'merchant.onboarding.payment',o.id::text,o.id::text,'committed',
  jsonb_build_object('orderId',o.id),clock_timestamp())
 ON CONFLICT(actor_id,scope,idempotency_key) DO NOTHING RETURNING id INTO operation_id;
 IF operation_id IS NULL THEN RETURN; END IF;
 SELECT current_period_start INTO starts FROM merchant_subscriptions WHERE merchant_id=d.merchant_id;
 starts:=coalesce(starts,o.confirmed_at);
 IF o.corrects_order_id IS NOT NULL THEN starts:=o.confirmed_at; END IF;
 ends:=starts+make_interval(days=>o.duration_days);
 INSERT INTO subscription_payments(merchant_id,amount_minor,currency,method,period_start,period_end,
   starts_at,ends_at,payment_reference,reason,recorded_by,operation_id)
 VALUES(d.merchant_id,o.amount_minor,o.currency,'instapay',(starts AT TIME ZONE 'Africa/Cairo')::date,
  (ends AT TIME ZONE 'Africa/Cairo')::date,starts,ends,left(o.confirmed_reference,100),
  'Confirmed self-service InstaPay payment',o.confirmed_by,operation_id);
 UPDATE feature_entitlements SET billing_required=true,expires_at=ends,revision=revision+1
 WHERE merchant_id=d.merchant_id;
 UPDATE merchant_subscriptions SET current_period_start=starts,current_period_end=ends,
   revision=revision+1,updated_at=clock_timestamp() WHERE merchant_id=d.merchant_id;
END $$;
REVOKE ALL ON FUNCTION record_onboarding_payment(uuid) FROM PUBLIC;

CREATE FUNCTION record_confirmed_onboarding_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM record_onboarding_payment(NEW.id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION record_confirmed_onboarding_payment() FROM PUBLIC;
CREATE TRIGGER z_onboarding_order_payment AFTER UPDATE OF confirmed_at ON merchant_onboarding_orders
 FOR EACH ROW WHEN (OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL)
 EXECUTE FUNCTION record_confirmed_onboarding_payment();

CREATE FUNCTION record_published_onboarding_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM record_onboarding_payment(NEW.published_order_id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION record_published_onboarding_payment() FROM PUBLIC;
CREATE TRIGGER merchant_onboarding_publication_payment AFTER UPDATE OF published_order_id ON merchant_onboarding_drafts
 FOR EACH ROW WHEN (NEW.published_order_id IS DISTINCT FROM OLD.published_order_id)
 EXECUTE FUNCTION record_published_onboarding_payment();
