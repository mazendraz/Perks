-- Subscription plans and entitlements, phase 1: data, backfill and the single source of truth.
-- Enforcement still runs through feature_entitlements until migration 028 switches it over.

-- ------------------------------------------------------------------ value rules
-- One closed list of entitlement keys and the value shape each one accepts.
CREATE FUNCTION entitlement_value_ok(k text,t text,i integer,b boolean,e text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public,pg_temp AS $$
 SELECT CASE
  WHEN k IN ('max_branches','max_staff','max_active_programs','manual_messages_per_month') THEN
   (t='int' AND i IS NOT NULL AND i BETWEEN 0 AND 100000 AND b IS NULL AND e IS NULL)
   OR (t='unlimited' AND i IS NULL AND b IS NULL AND e IS NULL)
  WHEN k IN ('merchant_branding','apple_wallet','google_wallet','web_card','qr_enrollment','nfc_enrollment',
             'data_export_csv','customer_segments','custom_card_template') THEN
   t='bool' AND b IS NOT NULL AND i IS NULL AND e IS NULL
  WHEN k='reminders' THEN t='enum' AND e IN ('reward_near','all') AND i IS NULL AND b IS NULL
  WHEN k='analytics_level' THEN t='enum' AND e IN ('basic','branches','advanced') AND i IS NULL AND b IS NULL
  WHEN k='support_level' THEN t='enum' AND e IN ('standard','priority','account_manager','sla') AND i IS NULL AND b IS NULL
  ELSE false END
$$;

-- ------------------------------------------------------------------ catalog
CREATE TABLE plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 key text NOT NULL UNIQUE CHECK(key ~ '^[a-z][a-z0-9_]{1,31}$'),
 name_ar text NOT NULL CHECK(length(name_ar) BETWEEN 1 AND 60),
 name_en text NOT NULL CHECK(length(name_en) BETWEEN 1 AND 60),
 sort_order integer NOT NULL DEFAULT 0,
 is_public boolean NOT NULL DEFAULT false,
 is_active boolean NOT NULL DEFAULT true,
 is_custom boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE plan_prices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 plan_id uuid NOT NULL REFERENCES plans(id),
 currency text NOT NULL CHECK(currency IN ('EGP','SAR','AED')),
 billing_period text NOT NULL CHECK(billing_period IN ('monthly','annual')),
 amount_minor integer NOT NULL CHECK(amount_minor BETWEEN 0 AND 1000000000),
 setup_fee_per_branch_minor integer NOT NULL DEFAULT 0 CHECK(setup_fee_per_branch_minor BETWEEN 0 AND 100000000),
 is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Price history is kept: a change deactivates the old row and inserts a new one.
CREATE UNIQUE INDEX plan_prices_one_active ON plan_prices(plan_id,currency,billing_period) WHERE is_active;
CREATE TABLE plan_entitlements (
 plan_id uuid NOT NULL REFERENCES plans(id),
 key text NOT NULL,
 value_type text NOT NULL CHECK(value_type IN ('int','bool','enum','unlimited')),
 int_value integer,bool_value boolean,enum_value text,
 PRIMARY KEY(plan_id,key),
 CHECK(entitlement_value_ok(key,value_type,int_value,bool_value,enum_value))
);
CREATE TABLE plan_addons (
 plan_id uuid NOT NULL REFERENCES plans(id),
 key text NOT NULL CHECK(key IN ('extra_branch','extra_staff')),
 currency text NOT NULL CHECK(currency IN ('EGP','SAR','AED')),
 unit_amount_minor integer NOT NULL CHECK(unit_amount_minor BETWEEN 0 AND 100000000),
 -- The most the related limit may reach with add-ons (e.g. Scale: 10 branches in total). NULL = no cap.
 max_total integer CHECK(max_total IS NULL OR max_total BETWEEN 1 AND 100000),
 is_active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(plan_id,key,currency)
);

-- ------------------------------------------------------------------ per merchant
CREATE TABLE merchant_subscriptions (
 merchant_id uuid PRIMARY KEY REFERENCES merchants(id),
 plan_id uuid NOT NULL REFERENCES plans(id),
 currency text NOT NULL DEFAULT 'EGP' CHECK(currency IN ('EGP','SAR','AED')),
 billing_period text NOT NULL DEFAULT 'monthly' CHECK(billing_period IN ('monthly','annual')),
 -- The base price this merchant pays, locked when the plan was chosen. A catalog change never moves it.
 price_minor integer NOT NULL DEFAULT 0 CHECK(price_minor BETWEEN 0 AND 1000000000),
 status text NOT NULL CHECK(status IN ('trialing','active','past_due','grace','suspended','cancelled')),
 trial_ends_at timestamptz,
 -- NULL period end = no billing schedule yet (legacy pilots); nothing becomes past due.
 current_period_start timestamptz,
 current_period_end timestamptz,
 cancel_at_period_end boolean NOT NULL DEFAULT false,
 pending_plan_id uuid REFERENCES plans(id),
 past_due_since timestamptz,
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(status<>'trialing' OR trial_ends_at IS NOT NULL),
 CHECK(current_period_end IS NULL OR current_period_start IS NULL OR current_period_end>current_period_start),
 CHECK(pending_plan_id IS NULL OR pending_plan_id<>plan_id)
);
CREATE TABLE subscription_addons (
 merchant_id uuid NOT NULL REFERENCES merchant_subscriptions(merchant_id),
 key text NOT NULL CHECK(key IN ('extra_branch','extra_staff')),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000),
 unit_amount_minor integer NOT NULL CHECK(unit_amount_minor BETWEEN 0 AND 100000000),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(merchant_id,key)
);
CREATE TABLE entitlement_overrides (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 merchant_id uuid NOT NULL REFERENCES merchant_subscriptions(merchant_id),
 key text NOT NULL,
 value_type text NOT NULL CHECK(value_type IN ('int','bool','enum','unlimited')),
 int_value integer,bool_value boolean,enum_value text,
 reason text NOT NULL CHECK(length(reason) BETWEEN 4 AND 500),
 expires_at timestamptz,
 -- NULL creator = written by the system (the legacy pilot backfill).
 created_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 revoked_at timestamptz,
 revoked_by uuid REFERENCES users(id),
 CHECK(entitlement_value_ok(key,value_type,int_value,bool_value,enum_value))
);
CREATE UNIQUE INDEX entitlement_overrides_one_open ON entitlement_overrides(merchant_id,key) WHERE revoked_at IS NULL;
CREATE TABLE subscription_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 actor_id uuid REFERENCES users(id),
 event_type text NOT NULL CHECK(event_type ~ '^[a-z][a-z_.]{2,60}$'),
 before jsonb,
 after jsonb,
 reason text CHECK(reason IS NULL OR length(reason)<=500),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX subscription_events_timeline ON subscription_events(merchant_id,created_at DESC,id);
CREATE TRIGGER subscription_events_immutable BEFORE UPDATE OR DELETE ON subscription_events FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE usage_counters (
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 key text NOT NULL CHECK(key='manual_messages_per_month'),
 period text NOT NULL CHECK(period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 count integer NOT NULL DEFAULT 0 CHECK(count>=0),
 PRIMARY KEY(merchant_id,key,period)
);

-- Locked = over the plan after a downgrade: visible and kept, but nothing new runs there.
ALTER TABLE branches ADD COLUMN locked_at timestamptz;
ALTER TABLE programs ADD COLUMN locked_at timestamptz;
ALTER TABLE staff_memberships ADD COLUMN locked_at timestamptz;

-- Payments: two more manual methods the prompt names. Existing rows keep their values.
ALTER TABLE subscription_payments DROP CONSTRAINT subscription_payments_method_check;
ALTER TABLE subscription_payments ADD CONSTRAINT subscription_payments_method_check
 CHECK(method IN ('instapay','cash','bank_transfer','vodafone_cash','wallet','card_link'));

-- ------------------------------------------------------------------ access
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlement_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;

-- Only shop owners (to compare plans) and the platform team read the catalog. Customers never do.
CREATE FUNCTION is_active_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id
  WHERE s.user_id=app_user() AND s.role='owner' AND s.status='active' AND u.status='active')
$$;
CREATE FUNCTION merchant_owner(mid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id
  WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.role='owner' AND s.status='active' AND u.status='active')
$$;
REVOKE ALL ON FUNCTION is_active_owner(),merchant_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_active_owner(),merchant_owner(uuid) TO nuqta_runtime;

CREATE POLICY plans_read ON plans FOR SELECT USING(is_platform_admin() OR (is_active_owner() AND is_public AND is_active));
CREATE POLICY plans_write ON plans FOR INSERT WITH CHECK(is_platform_admin());
CREATE POLICY plans_update ON plans FOR UPDATE USING(is_platform_admin()) WITH CHECK(is_platform_admin());
CREATE POLICY plan_prices_read ON plan_prices FOR SELECT USING(is_platform_admin()
 OR (is_active_owner() AND is_active AND EXISTS(SELECT 1 FROM plans p WHERE p.id=plan_id AND p.is_public AND p.is_active)));
CREATE POLICY plan_prices_write ON plan_prices FOR INSERT WITH CHECK(is_platform_admin());
CREATE POLICY plan_prices_update ON plan_prices FOR UPDATE USING(is_platform_admin()) WITH CHECK(is_platform_admin());
CREATE POLICY plan_entitlements_read ON plan_entitlements FOR SELECT USING(is_platform_admin()
 OR (is_active_owner() AND EXISTS(SELECT 1 FROM plans p WHERE p.id=plan_id AND p.is_public AND p.is_active)));
CREATE POLICY plan_entitlements_write ON plan_entitlements FOR INSERT WITH CHECK(is_platform_admin());
CREATE POLICY plan_entitlements_update ON plan_entitlements FOR UPDATE USING(is_platform_admin()) WITH CHECK(is_platform_admin());
CREATE POLICY plan_addons_read ON plan_addons FOR SELECT USING(is_platform_admin()
 OR (is_active_owner() AND is_active AND EXISTS(SELECT 1 FROM plans p WHERE p.id=plan_id AND p.is_public AND p.is_active)));
CREATE POLICY plan_addons_write ON plan_addons FOR INSERT WITH CHECK(is_platform_admin());
CREATE POLICY plan_addons_update ON plan_addons FOR UPDATE USING(is_platform_admin()) WITH CHECK(is_platform_admin());

-- A merchant's own billing is visible to its owner and the platform team only; staff never see prices.
CREATE POLICY subscription_read ON merchant_subscriptions FOR SELECT USING(is_platform_admin() OR merchant_owner(merchant_id));
CREATE POLICY subscription_insert ON merchant_subscriptions FOR INSERT WITH CHECK(is_platform_admin());
CREATE POLICY subscription_update ON merchant_subscriptions FOR UPDATE USING(is_platform_admin()) WITH CHECK(is_platform_admin());
CREATE POLICY addons_read ON subscription_addons FOR SELECT USING(is_platform_admin() OR merchant_owner(merchant_id));
CREATE POLICY addons_write ON subscription_addons FOR ALL USING(is_platform_admin()) WITH CHECK(is_platform_admin());
CREATE POLICY overrides_read ON entitlement_overrides FOR SELECT USING(is_platform_admin() OR merchant_owner(merchant_id));
CREATE POLICY overrides_insert ON entitlement_overrides FOR INSERT WITH CHECK(is_platform_admin() AND created_by=app_user());
CREATE POLICY overrides_revoke ON entitlement_overrides FOR UPDATE USING(is_platform_admin()) WITH CHECK(is_platform_admin() AND revoked_by=app_user());
CREATE POLICY subscription_events_read ON subscription_events FOR SELECT USING(is_platform_admin() OR merchant_owner(merchant_id));
CREATE POLICY subscription_events_insert ON subscription_events FOR INSERT WITH CHECK(is_platform_admin() AND actor_id=app_user());
CREATE POLICY usage_read ON usage_counters FOR SELECT USING(is_platform_admin() OR merchant_owner(merchant_id));

REVOKE ALL ON plans,plan_prices,plan_entitlements,plan_addons,merchant_subscriptions,subscription_addons,
 entitlement_overrides,subscription_events,usage_counters FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON plans,plan_prices,plan_entitlements,plan_addons,merchant_subscriptions,entitlement_overrides TO nuqta_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON subscription_addons TO nuqta_runtime;
GRANT SELECT,INSERT ON subscription_events TO nuqta_runtime;
-- Counters only move through consume_entitlement_usage().
GRANT SELECT ON usage_counters TO nuqta_runtime;

-- ------------------------------------------------------------------ seed: the plans
INSERT INTO plans(key,name_ar,name_en,sort_order,is_public,is_custom) VALUES
 ('starter','Starter','Starter',10,true,false),
 ('growth','Growth','Growth',20,true,false),
 ('pro','Pro','Pro',30,true,false),
 ('scale','Scale','Scale',40,true,false),
 ('enterprise','Enterprise','Enterprise',50,true,true),
 ('legacy','الباقة التجريبية','Pilot',90,false,true);

-- EGP, whole piasters. Annual = 10 months for 12; the setup fee is waived on annual.
INSERT INTO plan_prices(plan_id,currency,billing_period,amount_minor,setup_fee_per_branch_minor)
SELECT p.id,'EGP',v.period,v.amount,v.setup FROM plans p JOIN (VALUES
 ('starter','monthly',50000,50000),('starter','annual',500000,0),
 ('growth','monthly',90000,50000),('growth','annual',900000,0),
 ('pro','monthly',150000,50000),('pro','annual',1500000,0),
 ('scale','monthly',250000,50000),('scale','annual',2500000,0)
) v(key,period,amount,setup) ON v.key=p.key;

INSERT INTO plan_addons(plan_id,key,currency,unit_amount_minor,max_total)
SELECT p.id,v.addon,'EGP',v.amount,v.cap FROM plans p JOIN (VALUES
 ('starter','extra_staff',5000,NULL),
 ('growth','extra_branch',40000,10),('growth','extra_staff',5000,NULL),
 ('pro','extra_branch',35000,10),('pro','extra_staff',5000,NULL),
 ('scale','extra_branch',25000,10)
) v(key,addon,amount,cap) ON v.key=p.key;

INSERT INTO plan_entitlements(plan_id,key,value_type,int_value,bool_value,enum_value)
SELECT p.id,v.k,v.t,v.i,v.b,v.e FROM plans p JOIN (VALUES
 ('starter','max_branches','int',1,NULL::boolean,NULL),('starter','max_staff','int',3,NULL,NULL),
 ('starter','max_active_programs','int',1,NULL,NULL),('starter','manual_messages_per_month','int',2,NULL,NULL),
 ('growth','max_branches','int',2,NULL,NULL),('growth','max_staff','int',6,NULL,NULL),
 ('growth','max_active_programs','int',3,NULL,NULL),('growth','manual_messages_per_month','int',8,NULL,NULL),
 ('pro','max_branches','int',4,NULL,NULL),('pro','max_staff','int',12,NULL,NULL),
 ('pro','max_active_programs','int',5,NULL,NULL),('pro','manual_messages_per_month','int',15,NULL,NULL),
 ('scale','max_branches','int',10,NULL,NULL),('scale','max_staff','unlimited',NULL,NULL,NULL),
 ('scale','max_active_programs','int',10,NULL,NULL),('scale','manual_messages_per_month','int',30,NULL,NULL),
 ('enterprise','max_branches','int',10,NULL,NULL),('enterprise','max_staff','unlimited',NULL,NULL,NULL),
 ('enterprise','max_active_programs','int',10,NULL,NULL),('enterprise','manual_messages_per_month','int',30,NULL,NULL),
 ('legacy','max_branches','int',1,NULL,NULL),('legacy','max_staff','int',3,NULL,NULL),
 ('legacy','max_active_programs','int',1,NULL,NULL),('legacy','manual_messages_per_month','int',8,NULL,NULL)
) v(key,k,t,i,b,e) ON v.key=p.key;

-- Feature flags. Every plan gets the shared basics.
INSERT INTO plan_entitlements(plan_id,key,value_type,bool_value)
SELECT p.id,f.k,'bool',true FROM plans p CROSS JOIN (VALUES
 ('merchant_branding'),('apple_wallet'),('google_wallet'),('web_card'),('qr_enrollment'),('nfc_enrollment'),('data_export_csv')
) f(k);
INSERT INTO plan_entitlements(plan_id,key,value_type,bool_value)
SELECT p.id,v.k,'bool',v.b FROM plans p JOIN (VALUES
 ('starter','customer_segments',false),('growth','customer_segments',true),('pro','customer_segments',true),
 ('scale','customer_segments',true),('enterprise','customer_segments',true),('legacy','customer_segments',true),
 ('starter','custom_card_template',false),('growth','custom_card_template',false),('pro','custom_card_template',false),
 ('scale','custom_card_template',true),('enterprise','custom_card_template',true),('legacy','custom_card_template',false)
) v(key,k,b) ON v.key=p.key;
INSERT INTO plan_entitlements(plan_id,key,value_type,enum_value)
SELECT p.id,v.k,'enum',v.e FROM plans p JOIN (VALUES
 ('starter','reminders','reward_near'),('growth','reminders','all'),('pro','reminders','all'),
 ('scale','reminders','all'),('enterprise','reminders','all'),('legacy','reminders','all'),
 ('starter','analytics_level','basic'),('growth','analytics_level','branches'),('pro','analytics_level','branches'),
 ('scale','analytics_level','advanced'),('enterprise','analytics_level','advanced'),('legacy','analytics_level','advanced'),
 ('starter','support_level','standard'),('growth','support_level','priority'),('pro','support_level','priority'),
 ('scale','support_level','account_manager'),('enterprise','support_level','sla'),('legacy','support_level','standard')
) v(key,k,e) ON v.key=p.key;

-- ------------------------------------------------------------------ legacy pilots
-- Every merchant gets a subscription. Pilots (any merchant provisioned the old way) sit on the
-- hidden "legacy" plan with overrides equal to their existing limits, so nothing changes for them.
-- Their billing schedule is left empty (no period end), so nothing becomes past due by itself.
CREATE FUNCTION sync_legacy_subscription(mid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE fe feature_entitlements; legacy uuid; sub merchant_subscriptions; k text; v integer;
BEGIN
 SELECT * INTO fe FROM feature_entitlements WHERE merchant_id=mid;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT id INTO legacy FROM plans WHERE key='legacy';
 SELECT * INTO sub FROM merchant_subscriptions WHERE merchant_id=mid FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO merchant_subscriptions(merchant_id,plan_id,status,current_period_end)
  VALUES(mid,legacy,'active',(SELECT max(p.ends_at) FROM subscription_payments p WHERE p.merchant_id=mid
   AND NOT EXISTS(SELECT 1 FROM subscription_payment_voids x WHERE x.payment_id=p.id)))
  RETURNING * INTO sub;
  INSERT INTO subscription_events(merchant_id,event_type,after,reason)
  VALUES(mid,'subscription.legacy_created',jsonb_build_object('plan','legacy','status','active'),'Existing pilot moved to the legacy plan');
 END IF;
 -- Only a merchant still on the legacy plan follows feature_entitlements.
 IF sub.plan_id<>legacy THEN RETURN; END IF;
 FOREACH k IN ARRAY ARRAY['max_branches','max_staff','max_active_programs'] LOOP
  v := CASE k WHEN 'max_branches' THEN fe.max_branches WHEN 'max_staff' THEN fe.max_staff ELSE fe.max_programs END;
  IF NOT EXISTS(SELECT 1 FROM entitlement_overrides WHERE merchant_id=mid AND key=k AND revoked_at IS NULL
                AND value_type='int' AND int_value=v AND created_by IS NULL) THEN
   UPDATE entitlement_overrides SET revoked_at=clock_timestamp() WHERE merchant_id=mid AND key=k AND revoked_at IS NULL;
   INSERT INTO entitlement_overrides(merchant_id,key,value_type,int_value,reason)
   VALUES(mid,k,'int',v,'Legacy pilot limits');
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION sync_legacy_subscription(uuid) FROM PUBLIC;

CREATE FUNCTION feature_entitlements_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN PERFORM sync_legacy_subscription(NEW.merchant_id); RETURN NULL; END $$;
REVOKE ALL ON FUNCTION feature_entitlements_sync() FROM PUBLIC;
CREATE TRIGGER feature_entitlements_follow AFTER INSERT OR UPDATE ON feature_entitlements
 FOR EACH ROW EXECUTE FUNCTION feature_entitlements_sync();

SELECT sync_legacy_subscription(merchant_id) FROM feature_entitlements;

-- ------------------------------------------------------------------ the single source of truth
-- Monthly counters follow the calendar month in Cairo, not 30 days after the first send.
CREATE FUNCTION usage_period(at timestamptz) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public,pg_temp AS $$
 SELECT to_char(at AT TIME ZONE 'Africa/Cairo','YYYY-MM')
$$;
GRANT EXECUTE ON FUNCTION usage_period(timestamptz) TO nuqta_runtime;

-- Effective value = plan → + add-ons → replaced by an active override. Unlimited stays unlimited.
CREATE FUNCTION entitlements_effective_rows(mid uuid)
RETURNS TABLE(key text,value_type text,int_value integer,bool_value boolean,enum_value text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH sub AS (SELECT plan_id,currency FROM merchant_subscriptions WHERE merchant_id=mid),
 base AS (
  SELECT e.key,e.value_type,
   CASE WHEN e.value_type='int' THEN least(
    e.int_value+coalesce((SELECT a.quantity FROM subscription_addons a WHERE a.merchant_id=mid AND a.key=addon.k),0),
    -- An add-on never lifts a limit past its plan's cap (e.g. Scale: 10 branches in total).
    coalesce((SELECT greatest(c.max_total,e.int_value) FROM plan_addons c
      WHERE c.plan_id=sub.plan_id AND c.key=addon.k AND c.currency=sub.currency AND c.max_total IS NOT NULL),2147483647))
   END AS int_value,e.bool_value,e.enum_value
  FROM plan_entitlements e JOIN sub ON sub.plan_id=e.plan_id
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
REVOKE ALL ON FUNCTION entitlements_effective_rows(uuid) FROM PUBLIC;

-- What counts against each limit. Locked and disabled items do not; pending staff invitations do.
CREATE FUNCTION entitlement_usage(mid uuid,k text) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE k
  WHEN 'max_branches' THEN (SELECT count(*)::int FROM branches WHERE merchant_id=mid AND status='active' AND locked_at IS NULL)
  WHEN 'max_staff' THEN (SELECT count(*)::int FROM staff_memberships WHERE merchant_id=mid AND role<>'owner' AND status='active' AND locked_at IS NULL)
   + (SELECT count(*)::int FROM invitations WHERE merchant_id=mid AND role<>'owner' AND status='pending' AND expires_at>now())
  WHEN 'max_active_programs' THEN (SELECT count(*)::int FROM programs WHERE merchant_id=mid AND status='active' AND locked_at IS NULL)
  WHEN 'manual_messages_per_month' THEN coalesce((SELECT count FROM usage_counters
   WHERE merchant_id=mid AND key=k AND period=usage_period(clock_timestamp())),0)
 END
$$;
REVOKE ALL ON FUNCTION entitlement_usage(uuid,text) FROM PUBLIC;

-- Everything the app needs about one merchant's plan, for its own staff or the platform team.
CREATE FUNCTION effective_entitlements(mid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE sub merchant_subscriptions; p plans; pending plans; limits jsonb:='{}'; features jsonb:='{}'; usage jsonb:='{}'; r record;
BEGIN
 IF NOT tenant_access(mid) THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 SELECT * INTO sub FROM merchant_subscriptions WHERE merchant_id=mid;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:ENTITLEMENTS_NOT_CONFIGURED'; END IF;
 SELECT * INTO p FROM plans WHERE id=sub.plan_id;
 SELECT * INTO pending FROM plans WHERE id=sub.pending_plan_id;
 FOR r IN SELECT * FROM entitlements_effective_rows(mid) LOOP
  IF r.value_type IN ('int','unlimited') THEN
   limits := limits || jsonb_build_object(r.key, CASE WHEN r.value_type='unlimited' THEN 'null'::jsonb ELSE to_jsonb(r.int_value) END);
   usage := usage || jsonb_build_object(r.key, entitlement_usage(mid,r.key));
  ELSIF r.value_type='bool' THEN features := features || jsonb_build_object(r.key,r.bool_value);
  ELSE features := features || jsonb_build_object(r.key,r.enum_value);
  END IF;
 END LOOP;
 RETURN jsonb_build_object(
  'plan',jsonb_build_object('key',p.key,'nameAr',p.name_ar,'nameEn',p.name_en,'custom',p.is_custom),
  'status',sub.status,
  'currency',sub.currency,'billingPeriod',sub.billing_period,
  'trialEndsAt',sub.trial_ends_at,'currentPeriodEnd',sub.current_period_end,
  'cancelAtPeriodEnd',sub.cancel_at_period_end,
  'pendingPlan',CASE WHEN pending.id IS NULL THEN NULL ELSE jsonb_build_object('key',pending.key,'nameAr',pending.name_ar,'nameEn',pending.name_en) END,
  'limits',limits,'features',features,'usage',usage,
  'usagePeriod',usage_period(clock_timestamp()),
  'revision',sub.revision);
END $$;
REVOKE ALL ON FUNCTION effective_entitlements(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION effective_entitlements(uuid) TO nuqta_runtime;

-- What a merchant can do when a limit or feature stops them: buy an add-on (if their plan sells one
-- and it stays under the cap) or move to the cheapest public plan that fits. Prices in major units.
CREATE FUNCTION entitlement_options(mid uuid,k text,needed integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH sub AS (SELECT s.plan_id,s.currency,p.sort_order,(p.is_public AND NOT p.is_custom) AS standard
   FROM merchant_subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.merchant_id=mid),
 addon AS (
  SELECT jsonb_build_object('type','addon','key',a.key,'price',a.unit_amount_minor/100.0,'currency',a.currency) AS o
  FROM plan_addons a JOIN sub ON sub.plan_id=a.plan_id AND sub.currency=a.currency
  WHERE a.is_active AND a.key=CASE k WHEN 'max_branches' THEN 'extra_branch' WHEN 'max_staff' THEN 'extra_staff' END
   AND (a.max_total IS NULL OR needed<=a.max_total)),
 upgrade AS (
  SELECT jsonb_build_object('type','upgrade','plan',p.key,'price',pr.amount_minor/100.0,'currency',pr.currency) AS o
  FROM plans p JOIN sub ON true
  JOIN plan_prices pr ON pr.plan_id=p.id AND pr.currency=sub.currency AND pr.billing_period='monthly' AND pr.is_active
  JOIN plan_entitlements e ON e.plan_id=p.id AND e.key=k
  WHERE p.is_public AND p.is_active AND NOT p.is_custom AND p.id<>sub.plan_id
   AND (NOT sub.standard OR p.sort_order>sub.sort_order)
   AND CASE e.value_type WHEN 'unlimited' THEN true WHEN 'int' THEN e.int_value>=needed WHEN 'bool' THEN e.bool_value ELSE false END
  ORDER BY pr.amount_minor,p.sort_order LIMIT 1)
 SELECT coalesce(jsonb_agg(o),'[]'::jsonb) FROM (
  SELECT o FROM addon
  UNION ALL SELECT o FROM upgrade
  -- Nothing public fits: talk to sales about Enterprise.
  UNION ALL SELECT jsonb_build_object('type','contact','plan','enterprise') WHERE NOT EXISTS(SELECT 1 FROM upgrade)
 ) x
$$;
REVOKE ALL ON FUNCTION entitlement_options(uuid,text,integer) FROM PUBLIC;

-- Checks one limit before a create, holding the merchant's subscription row so two parallel
-- creates cannot both pass. Call it inside the same transaction as the insert it guards.
CREATE FUNCTION assert_entitlement(mid uuid,k text,increment integer DEFAULT 1) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r record; used integer;
BEGIN
 IF NOT tenant_access(mid) THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 IF increment NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'NQ:INVALID_QUERY'; END IF;
 PERFORM 1 FROM merchant_subscriptions WHERE merchant_id=mid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:ENTITLEMENTS_NOT_CONFIGURED'; END IF;
 SELECT * INTO r FROM entitlements_effective_rows(mid) e WHERE e.key=k;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:INVALID_QUERY'; END IF;
 IF r.value_type='bool' THEN
  IF NOT r.bool_value THEN
   RAISE EXCEPTION 'NQ:FEATURE_NOT_IN_PLAN'
    USING DETAIL=jsonb_build_object('entitlement',k,'options',entitlement_options(mid,k,1))::text;
  END IF;
  RETURN;
 END IF;
 IF r.value_type NOT IN ('int','unlimited') THEN RAISE EXCEPTION 'NQ:INVALID_QUERY'; END IF;
 IF r.value_type='unlimited' THEN RETURN; END IF;
 used := entitlement_usage(mid,k);
 IF used+increment>r.int_value THEN
  RAISE EXCEPTION 'NQ:PLAN_LIMIT_REACHED'
   USING DETAIL=jsonb_build_object('entitlement',k,'limit',r.int_value,'used',used,
    'options',entitlement_options(mid,k,used+increment))::text;
 END IF;
END $$;
REVOKE ALL ON FUNCTION assert_entitlement(uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assert_entitlement(uuid,text,integer) TO nuqta_runtime;

-- Uses one unit of a monthly allowance (manual Wallet messages), atomically with the check.
CREATE FUNCTION consume_entitlement_usage(mid uuid,k text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer;
BEGIN
 IF k<>'manual_messages_per_month' THEN RAISE EXCEPTION 'NQ:INVALID_QUERY'; END IF;
 PERFORM assert_entitlement(mid,k,1);
 INSERT INTO usage_counters(merchant_id,key,period,count) VALUES(mid,k,usage_period(clock_timestamp()),1)
 ON CONFLICT(merchant_id,key,period) DO UPDATE SET count=usage_counters.count+1
 RETURNING count INTO n;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION consume_entitlement_usage(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_entitlement_usage(uuid,text) TO nuqta_runtime;
