-- A subscriber keeps what their plan gave them until their current period ends, even if the plan
-- itself is changed in the catalog meanwhile.
-- Until now every limit and feature was read live from plan_entitlements, so changing a plan in the
-- catalog (say, moving a feature up to a higher plan) took it away from paying customers at once.
-- Now each subscription carries a snapshot of its plan's entitlements, taken when a period starts,
-- renews or the plan changes, and for each key the better of "snapshot" and "plan today" applies
-- until the period ends. After that the plan as it is today applies. Add-ons and overrides are
-- untouched (they stay on top, as before). The price was already locked the same way.
-- Also opens every analytics section to every plan for now (analytics_level = advanced).
-- Additive: two nullable columns, one trigger, functions replaced with the same signatures.

ALTER TABLE merchant_subscriptions
 ADD COLUMN entitlements_snapshot jsonb,
 ADD COLUMN snapshot_until timestamptz;

-- Which of two values of the same key gives the merchant more. Unknown enums keep the plan's value.
CREATE FUNCTION entitlement_rank(k text,value_type text,int_value integer,bool_value boolean,enum_value text)
RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT CASE value_type
  WHEN 'unlimited' THEN 9223372036854775807
  WHEN 'int' THEN int_value
  WHEN 'bool' THEN CASE WHEN bool_value THEN 1 ELSE 0 END
  ELSE coalesce(array_position(CASE k
    WHEN 'analytics_level' THEN ARRAY['basic','branches','advanced']
    WHEN 'reminders' THEN ARRAY['reward_near','all']
    WHEN 'support_level' THEN ARRAY['standard','priority','account_manager','sla']
    ELSE ARRAY[]::text[] END,enum_value),-1)
 END
$$;

-- A plan's own entitlements as one jsonb object: key -> {value_type,int_value,bool_value,enum_value}.
CREATE FUNCTION plan_entitlement_snapshot(plan uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_object_agg(e.key,jsonb_build_object('value_type',e.value_type,'int_value',e.int_value,
   'bool_value',e.bool_value,'enum_value',e.enum_value)),'{}'::jsonb)
 FROM plan_entitlements e WHERE e.plan_id=plan
$$;
REVOKE ALL ON FUNCTION plan_entitlement_snapshot(uuid) FROM PUBLIC;

-- Keeps the better value of each key from two snapshots (the protected one and the plan today).
CREATE FUNCTION merge_entitlement_snapshots(a jsonb,b jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_object_agg(k,CASE
   WHEN a->k IS NULL THEN b->k WHEN b->k IS NULL THEN a->k
   WHEN entitlement_rank(k,a->k->>'value_type',(a->k->>'int_value')::int,(a->k->>'bool_value')::boolean,a->k->>'enum_value')
      > entitlement_rank(k,b->k->>'value_type',(b->k->>'int_value')::int,(b->k->>'bool_value')::boolean,b->k->>'enum_value')
   THEN a->k ELSE b->k END),'{}'::jsonb)
 FROM (SELECT jsonb_object_keys(coalesce(a,'{}')) AS k UNION SELECT jsonb_object_keys(coalesce(b,'{}'))) keys
$$;

-- Whenever the subscription itself changes (new period, renewal, trial dates, or a plan change the
-- merchant or the Perks team made on purpose) the snapshot is retaken from the plan as it is now.
-- Only catalog edits made by the platform afterwards wait for the period to end.
CREATE FUNCTION subscription_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
    OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end
    OR NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at THEN
  NEW.entitlements_snapshot:=plan_entitlement_snapshot(NEW.plan_id);
  NEW.snapshot_until:=coalesce(NEW.current_period_end,NEW.trial_ends_at);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER subscription_entitlement_snapshot BEFORE INSERT OR UPDATE OF plan_id,current_period_end,trial_ends_at
 ON merchant_subscriptions FOR EACH ROW EXECUTE FUNCTION subscription_snapshot();

-- Same shape and callers as before; the plan's base values now honour a live snapshot.
CREATE OR REPLACE FUNCTION entitlements_effective_rows(mid uuid)
RETURNS TABLE(key text,value_type text,int_value integer,bool_value boolean,enum_value text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH sub AS (SELECT plan_id,currency,
   CASE WHEN snapshot_until>clock_timestamp() THEN entitlements_snapshot END AS snap
   FROM merchant_subscriptions WHERE merchant_id=mid),
 planned AS (
  SELECT x.key,(x.v->>'value_type') AS value_type,(x.v->>'int_value')::int AS int_value,
   (x.v->>'bool_value')::boolean AS bool_value,(x.v->>'enum_value') AS enum_value
  FROM sub CROSS JOIN LATERAL jsonb_each(merge_entitlement_snapshots(sub.snap,plan_entitlement_snapshot(sub.plan_id))) AS x(key,v)),
 base AS (
  SELECT e.key,e.value_type,
   CASE WHEN e.value_type='int' THEN least(
    e.int_value+coalesce((SELECT a.quantity FROM subscription_addons a WHERE a.merchant_id=mid AND a.key=addon.k),0),
    -- An add-on never lifts a limit past its plan's cap (e.g. Scale: 10 branches in total).
    coalesce((SELECT greatest(c.max_total,e.int_value) FROM plan_addons c
      WHERE c.plan_id=sub.plan_id AND c.key=addon.k AND c.currency=sub.currency AND c.max_total IS NOT NULL),2147483647))
   END AS int_value,e.bool_value,e.enum_value
  FROM planned e CROSS JOIN sub
  CROSS JOIN LATERAL (SELECT CASE e.key WHEN 'max_branches' THEN 'extra_branch' WHEN 'max_staff' THEN 'extra_staff' END AS k) addon),
 ov AS (
  SELECT o.key,o.value_type,o.int_value,o.bool_value,o.enum_value FROM entitlement_overrides o
  WHERE o.merchant_id=mid AND o.revoked_at IS NULL AND (o.expires_at IS NULL OR o.expires_at>clock_timestamp()))
 SELECT coalesce(ov.key,base.key),
  CASE WHEN ov.key IS NOT NULL THEN ov.value_type ELSE base.value_type END,
  CASE WHEN ov.key IS NOT NULL THEN ov.int_value ELSE base.int_value END,
  CASE WHEN ov.key IS NOT NULL THEN ov.bool_value ELSE base.bool_value END,
  CASE WHEN ov.key IS NOT NULL THEN ov.enum_value ELSE base.enum_value END
 FROM base FULL JOIN ov ON ov.key=base.key
$$;

-- Every plan gets the full analytics page for now. Locking parts later is a catalog change,
-- and the snapshots below keep current subscribers on "advanced" until their period ends.
UPDATE plan_entitlements SET enum_value='advanced' WHERE key='analytics_level';

-- Protect every running subscription from today.
UPDATE merchant_subscriptions SET
 entitlements_snapshot=plan_entitlement_snapshot(plan_id),
 snapshot_until=coalesce(current_period_end,trial_ends_at);
