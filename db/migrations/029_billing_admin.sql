-- Subscription plans and entitlements, phase 3: plan changes, scheduled downgrades and locked items.

-- "Oldest stays active" needs an order. Existing rows share the migration time; ties fall back to name.
ALTER TABLE branches ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE staff_memberships ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp();

-- A downgrade waits for the next billing date; this is when it lands.
ALTER TABLE merchant_subscriptions ADD COLUMN pending_effective_at timestamptz;
ALTER TABLE merchant_subscriptions ADD CONSTRAINT pending_has_date
 CHECK((pending_plan_id IS NULL)=(pending_effective_at IS NULL));

-- What the owner chose to keep active when a smaller plan lands (Phase 4 lets the owner pick).
CREATE TABLE plan_keep_choices (
 merchant_id uuid NOT NULL REFERENCES merchant_subscriptions(merchant_id),
 kind text NOT NULL CHECK(kind IN ('branch','program','staff')),
 item_id uuid NOT NULL,
 chosen_by uuid REFERENCES users(id),
 chosen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,kind,item_id)
);
ALTER TABLE plan_keep_choices ENABLE ROW LEVEL SECURITY;
CREATE POLICY keep_read ON plan_keep_choices FOR SELECT USING(is_platform_admin() OR merchant_owner(merchant_id));
REVOKE ALL ON plan_keep_choices FROM PUBLIC;
GRANT SELECT ON plan_keep_choices TO nuqta_runtime;

-- Keeps active items within the plan. Locking re-uses the states every screen already respects
-- (a disabled branch, an ended program, a disabled staff account) and marks them locked_at, so
-- nothing is ever deleted and unlocking only touches what the plan locked, never what the owner
-- turned off. Kept first: the owner's choices, then the oldest.
CREATE FUNCTION enforce_plan_limits(mid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE lim integer; unlimited boolean; r record; locked jsonb:='[]'; unlocked jsonb:='[]'; active_n integer; now_at timestamptz:=clock_timestamp();
BEGIN
 PERFORM 1 FROM merchant_subscriptions WHERE merchant_id=mid FOR UPDATE;
 -- branches
 SELECT e.int_value,e.value_type='unlimited' INTO lim,unlimited FROM entitlements_effective_rows(mid) e WHERE e.key='max_branches';
 IF NOT coalesce(unlimited,false) AND lim IS NOT NULL THEN
  lim := greatest(lim,1);
  FOR r IN SELECT b.id FROM branches b WHERE b.merchant_id=mid AND b.status='active' AND b.locked_at IS NULL
   ORDER BY EXISTS(SELECT 1 FROM plan_keep_choices k WHERE k.merchant_id=mid AND k.kind='branch' AND k.item_id=b.id) DESC,b.created_at,b.name,b.id
   OFFSET lim LOOP
   UPDATE branches SET status='disabled',locked_at=now_at,revision=revision+1 WHERE id=r.id;
   locked := locked || jsonb_build_object('kind','branch','id',r.id);
  END LOOP;
 END IF;
 SELECT count(*) INTO active_n FROM branches WHERE merchant_id=mid AND status='active' AND locked_at IS NULL;
 FOR r IN SELECT b.id FROM branches b WHERE b.merchant_id=mid AND b.locked_at IS NOT NULL
  ORDER BY EXISTS(SELECT 1 FROM plan_keep_choices k WHERE k.merchant_id=mid AND k.kind='branch' AND k.item_id=b.id) DESC,b.created_at,b.name,b.id
  LIMIT CASE WHEN coalesce(unlimited,false) OR lim IS NULL THEN NULL ELSE greatest(lim-active_n,0) END LOOP
  UPDATE branches SET status='active',locked_at=NULL,revision=revision+1 WHERE id=r.id;
  unlocked := unlocked || jsonb_build_object('kind','branch','id',r.id);
 END LOOP;
 -- programs
 SELECT e.int_value,e.value_type='unlimited' INTO lim,unlimited FROM entitlements_effective_rows(mid) e WHERE e.key='max_active_programs';
 IF NOT coalesce(unlimited,false) AND lim IS NOT NULL THEN
  FOR r IN SELECT p.id FROM programs p WHERE p.merchant_id=mid AND p.status='active' AND p.locked_at IS NULL
   ORDER BY EXISTS(SELECT 1 FROM plan_keep_choices k WHERE k.merchant_id=mid AND k.kind='program' AND k.item_id=p.id) DESC,p.created_at,p.id
   OFFSET lim LOOP
   UPDATE programs SET status='ended',locked_at=now_at WHERE id=r.id;
   locked := locked || jsonb_build_object('kind','program','id',r.id);
  END LOOP;
 END IF;
 SELECT count(*) INTO active_n FROM programs WHERE merchant_id=mid AND status='active' AND locked_at IS NULL;
 FOR r IN SELECT p.id FROM programs p WHERE p.merchant_id=mid AND p.locked_at IS NOT NULL
  ORDER BY EXISTS(SELECT 1 FROM plan_keep_choices k WHERE k.merchant_id=mid AND k.kind='program' AND k.item_id=p.id) DESC,p.created_at,p.id
  LIMIT CASE WHEN coalesce(unlimited,false) OR lim IS NULL THEN NULL ELSE greatest(lim-active_n,0) END LOOP
  UPDATE programs SET status='active',locked_at=NULL WHERE id=r.id;
  unlocked := unlocked || jsonb_build_object('kind','program','id',r.id);
 END LOOP;
 -- staff (owners are never locked and never counted)
 SELECT e.int_value,e.value_type='unlimited' INTO lim,unlimited FROM entitlements_effective_rows(mid) e WHERE e.key='max_staff';
 IF NOT coalesce(unlimited,false) AND lim IS NOT NULL THEN
  lim := greatest(lim-(SELECT count(*)::int FROM invitations WHERE merchant_id=mid AND role<>'owner' AND status='pending' AND expires_at>now()),0);
  FOR r IN SELECT s.id FROM staff_memberships s WHERE s.merchant_id=mid AND s.role<>'owner' AND s.status='active' AND s.locked_at IS NULL
   ORDER BY EXISTS(SELECT 1 FROM plan_keep_choices k WHERE k.merchant_id=mid AND k.kind='staff' AND k.item_id=s.id) DESC,s.created_at,s.id
   OFFSET lim LOOP
   UPDATE staff_memberships SET status='disabled',locked_at=now_at,revision=revision+1 WHERE id=r.id;
   locked := locked || jsonb_build_object('kind','staff','id',r.id);
  END LOOP;
 END IF;
 SELECT count(*) INTO active_n FROM staff_memberships WHERE merchant_id=mid AND role<>'owner' AND status='active' AND locked_at IS NULL;
 FOR r IN SELECT s.id FROM staff_memberships s WHERE s.merchant_id=mid AND s.locked_at IS NOT NULL
  ORDER BY EXISTS(SELECT 1 FROM plan_keep_choices k WHERE k.merchant_id=mid AND k.kind='staff' AND k.item_id=s.id) DESC,s.created_at,s.id
  LIMIT CASE WHEN coalesce(unlimited,false) OR lim IS NULL THEN NULL ELSE greatest(lim-active_n,0) END LOOP
  UPDATE staff_memberships SET status='active',locked_at=NULL,revision=revision+1 WHERE id=r.id;
  unlocked := unlocked || jsonb_build_object('kind','staff','id',r.id);
 END LOOP;
 IF jsonb_array_length(locked)>0 OR jsonb_array_length(unlocked)>0 THEN
  INSERT INTO subscription_events(merchant_id,actor_id,event_type,after,reason)
  VALUES(mid,nullif(current_setting('app.user_id',true),'')::uuid,'plan.items_rebalanced',
   jsonb_build_object('locked',locked,'unlocked',unlocked),'Keep active items within the plan');
 END IF;
 RETURN jsonb_build_object('locked',locked,'unlocked',unlocked);
END $$;
REVOKE ALL ON FUNCTION enforce_plan_limits(uuid) FROM PUBLIC;

-- The platform team (only) moves a merchant between plans through this function.
CREATE FUNCTION change_merchant_plan(mid uuid,plan_key text,period text,effective text,why text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s merchant_subscriptions; p plans; price integer; result jsonb:='{}';
BEGIN
 IF NOT is_platform_admin() THEN RAISE EXCEPTION 'NQ:FORBIDDEN'; END IF;
 IF period NOT IN ('monthly','annual') OR effective NOT IN ('now','period_end') THEN RAISE EXCEPTION 'NQ:INVALID_QUERY'; END IF;
 SELECT * INTO s FROM merchant_subscriptions WHERE merchant_id=mid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 SELECT * INTO p FROM plans WHERE key=plan_key AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 SELECT amount_minor INTO price FROM plan_prices WHERE plan_id=p.id AND currency=s.currency AND billing_period=period AND is_active;
 -- Custom plans (Enterprise, legacy) may have no list price; the agreed price is set separately.
 price := coalesce(price,CASE WHEN p.is_custom THEN s.price_minor ELSE NULL END);
 IF price IS NULL THEN RAISE EXCEPTION 'NQ:PLAN_PRICE_MISSING'; END IF;
 IF effective='period_end' THEN
  IF s.current_period_end IS NULL OR s.current_period_end<=clock_timestamp() THEN RAISE EXCEPTION 'NQ:NO_BILLING_PERIOD'; END IF;
  IF p.id=s.plan_id THEN
   UPDATE merchant_subscriptions SET pending_plan_id=NULL,pending_effective_at=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE merchant_id=mid;
  ELSE
   UPDATE merchant_subscriptions SET pending_plan_id=p.id,pending_effective_at=s.current_period_end,revision=revision+1,updated_at=clock_timestamp() WHERE merchant_id=mid;
  END IF;
 ELSE
  UPDATE merchant_subscriptions SET plan_id=p.id,billing_period=period,price_minor=price,pending_plan_id=NULL,pending_effective_at=NULL,
   revision=revision+1,updated_at=clock_timestamp() WHERE merchant_id=mid;
  -- An add-on the new plan does not sell (e.g. extra branches on Starter) ends with the change.
  DELETE FROM subscription_addons a WHERE a.merchant_id=mid AND NOT EXISTS(
   SELECT 1 FROM plan_addons x WHERE x.plan_id=p.id AND x.key=a.key AND x.currency=s.currency AND x.is_active);
  result := enforce_plan_limits(mid);
 END IF;
 INSERT INTO subscription_events(merchant_id,actor_id,event_type,before,after,reason)
 VALUES(mid,app_user(),CASE effective WHEN 'now' THEN 'subscription.plan_changed' ELSE 'subscription.plan_scheduled' END,
  jsonb_build_object('plan',(SELECT key FROM plans WHERE id=s.plan_id),'billingPeriod',s.billing_period,'priceMinor',s.price_minor),
  jsonb_build_object('plan',p.key,'billingPeriod',period,'priceMinor',price,'effective',effective,
   'effectiveAt',CASE WHEN effective='period_end' THEN s.current_period_end END)||result,left(why,500));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION change_merchant_plan(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION change_merchant_plan(uuid,text,text,text,text) TO nuqta_runtime;

-- Re-checks limits after an add-on or override change (platform team only).
CREATE FUNCTION rebalance_plan_items(mid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT is_platform_admin() THEN RAISE EXCEPTION 'NQ:FORBIDDEN'; END IF;
 RETURN enforce_plan_limits(mid);
END $$;
REVOKE ALL ON FUNCTION rebalance_plan_items(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rebalance_plan_items(uuid) TO nuqta_runtime;

-- The billing calendar, now also landing scheduled downgrades on their date.
CREATE OR REPLACE FUNCTION advance_subscription_states() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s merchant_subscriptions; next_status text; since timestamptz; moved integer:=0; now_at timestamptz:=clock_timestamp(); price integer; pending plans;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('subscription-calendar',0)) THEN RETURN 0; END IF;
 FOR s IN SELECT * FROM merchant_subscriptions WHERE pending_effective_at<=now_at FOR UPDATE SKIP LOCKED LOOP
  SELECT * INTO pending FROM plans WHERE id=s.pending_plan_id;
  SELECT amount_minor INTO price FROM plan_prices WHERE plan_id=pending.id AND currency=s.currency AND billing_period=s.billing_period AND is_active;
  UPDATE merchant_subscriptions SET plan_id=pending.id,price_minor=coalesce(price,price_minor),pending_plan_id=NULL,pending_effective_at=NULL,
   revision=revision+1,updated_at=now_at WHERE merchant_id=s.merchant_id;
  DELETE FROM subscription_addons a WHERE a.merchant_id=s.merchant_id AND NOT EXISTS(
   SELECT 1 FROM plan_addons x WHERE x.plan_id=pending.id AND x.key=a.key AND x.currency=s.currency AND x.is_active);
  INSERT INTO subscription_events(merchant_id,event_type,before,after,reason)
  VALUES(s.merchant_id,'subscription.plan_changed',jsonb_build_object('plan',(SELECT key FROM plans WHERE id=s.plan_id)),
   jsonb_build_object('plan',pending.key)||enforce_plan_limits(s.merchant_id),'Scheduled downgrade reached its date');
  moved := moved+1;
 END LOOP;
 FOR s IN SELECT * FROM merchant_subscriptions WHERE
   (status='trialing' AND trial_ends_at<=now_at)
   OR (status='active' AND current_period_end IS NOT NULL AND current_period_end<=now_at)
   OR (status='past_due' AND past_due_since<=now_at-interval '7 days')
  FOR UPDATE SKIP LOCKED LOOP
  next_status := NULL; since := s.past_due_since;
  IF s.status='trialing' THEN next_status:='past_due'; since:=s.trial_ends_at;
  ELSIF s.status='active' AND s.cancel_at_period_end THEN next_status:='cancelled';
  ELSIF s.status='active' THEN next_status:='past_due'; since:=s.current_period_end;
  ELSIF s.status='past_due' THEN next_status:='grace';
  END IF;
  CONTINUE WHEN next_status IS NULL;
  UPDATE merchant_subscriptions SET status=next_status,past_due_since=since,revision=revision+1,updated_at=now_at
   WHERE merchant_id=s.merchant_id;
  INSERT INTO subscription_events(merchant_id,event_type,before,after,reason)
  VALUES(s.merchant_id,'subscription.status_changed',jsonb_build_object('status',s.status),
   jsonb_build_object('status',next_status),'Billing calendar');
  moved := moved+1;
 END LOOP;
 RETURN moved;
END $$;

-- The value check behind every entitlement row runs as the writer; the app writes overrides now.
GRANT EXECUTE ON FUNCTION entitlement_value_ok(text,text,integer,boolean,text) TO nuqta_runtime;
