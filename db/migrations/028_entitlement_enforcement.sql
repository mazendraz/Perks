-- Subscription plans and entitlements, phase 2: every limit now comes from effective entitlements.

-- Options a staff member sees when stopped: what fixes it, but prices only for the owner and Perks.
CREATE OR REPLACE FUNCTION entitlement_options(mid uuid,k text,needed integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH sub AS (SELECT s.plan_id,s.currency,p.sort_order,(p.is_public AND NOT p.is_custom) AS standard,
   (is_platform_admin() OR merchant_owner(mid)) AS show_prices
   FROM merchant_subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.merchant_id=mid),
 addon AS (
  SELECT jsonb_build_object('type','addon','key',a.key)
   || CASE WHEN sub.show_prices THEN jsonb_build_object('price',a.unit_amount_minor/100.0,'currency',a.currency) ELSE '{}'::jsonb END AS o
  FROM plan_addons a JOIN sub ON sub.plan_id=a.plan_id AND sub.currency=a.currency
  WHERE a.is_active AND a.key=CASE k WHEN 'max_branches' THEN 'extra_branch' WHEN 'max_staff' THEN 'extra_staff' END
   AND (a.max_total IS NULL OR needed<=a.max_total)),
 upgrade AS (
  SELECT jsonb_build_object('type','upgrade','plan',p.key)
   || CASE WHEN sub.show_prices THEN jsonb_build_object('price',pr.amount_minor/100.0,'currency',pr.currency) ELSE '{}'::jsonb END AS o
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

-- Same check as before, plus: grace stops new branches/staff/programs; cancelled/suspended too.
CREATE OR REPLACE FUNCTION assert_entitlement(mid uuid,k text,increment integer DEFAULT 1) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r record; used integer; st text;
BEGIN
 IF NOT tenant_access(mid) THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 IF increment NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'NQ:INVALID_QUERY'; END IF;
 SELECT status INTO st FROM merchant_subscriptions WHERE merchant_id=mid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:ENTITLEMENTS_NOT_CONFIGURED'; END IF;
 -- Grace (and later states) stop new branches, staff and programs until a payment is recorded.
 -- Nothing here touches customers: stamping and cards never call this.
 IF k IN ('max_branches','max_staff','max_active_programs') THEN
  IF st='grace' THEN RAISE EXCEPTION 'NQ:SUBSCRIPTION_GRACE'; END IF;
  IF st IN ('cancelled','suspended') THEN RAISE EXCEPTION 'NQ:SUBSCRIPTION_INACTIVE'; END IF;
 END IF;
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

-- Branch creation: the plan (with add-ons and overrides) decides, under the same row lock.
CREATE OR REPLACE FUNCTION public.create_merchant_branch(mid uuid, name_arg text, address_arg text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE b branches;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.role='owner' AND s.status='active' AND u.status='active') THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 PERFORM id FROM merchants WHERE id=mid AND status IN ('active','trial') FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'NQ:MERCHANT_PAUSED';END IF;
 PERFORM assert_entitlement(mid,'max_branches',1);
 IF length(trim(name_arg)) NOT BETWEEN 2 AND 100 OR length(address_arg)>500 THEN RAISE EXCEPTION 'NQ:INVALID_QUERY';END IF;
 INSERT INTO branches(merchant_id,name,address) VALUES(mid,name_arg,address_arg) RETURNING * INTO b;
 INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) SELECT merchant_id,id,b.id FROM staff_memberships WHERE merchant_id=mid AND role='owner' AND status='active';
 RETURN to_jsonb(b);
END $$;

-- Staff accounts: owners are free; everyone else uses a staff slot.
CREATE OR REPLACE FUNCTION public.create_staff_password_account(mid uuid, email_arg text, hash_arg text, role_arg text, qty_arg integer, branches_arg uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE uid uuid;sid uuid;bid uuid;
BEGIN
 IF NOT is_platform_admin() AND NOT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.role='owner' AND s.status='active' AND u.status='active') THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 PERFORM 1 FROM merchants WHERE id=mid AND status IN ('active','trial') FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'NQ:MERCHANT_PAUSED';END IF;
 IF role_arg NOT IN ('owner','manager','cashier') OR qty_arg NOT BETWEEN 1 AND 100 OR coalesce(cardinality(branches_arg),0) NOT BETWEEN 1 AND 10 OR hash_arg !~ '^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$' THEN RAISE EXCEPTION 'NQ:INVALID_ACCOUNT';END IF;
 IF cardinality(branches_arg)<>(SELECT count(DISTINCT b) FROM unnest(branches_arg) b) THEN RAISE EXCEPTION 'NQ:BRANCH_UNAUTHORIZED';END IF;
 FOREACH bid IN ARRAY branches_arg LOOP
  IF NOT EXISTS(SELECT 1 FROM branches WHERE id=bid AND merchant_id=mid AND status='active') OR (NOT is_platform_admin() AND NOT branch_access(mid,bid)) THEN RAISE EXCEPTION 'NQ:BRANCH_UNAUTHORIZED';END IF;
 END LOOP;
 -- Owners do not count against the staff limit.
 IF role_arg<>'owner' THEN PERFORM assert_entitlement(mid,'max_staff',1); END IF;
 INSERT INTO users(email,display_name,password_hash,password_version,password_must_change) VALUES(lower(email_arg),split_part(email_arg,'@',1),hash_arg,1,true) ON CONFLICT(email) DO NOTHING RETURNING id INTO uid;
 IF uid IS NULL THEN RAISE EXCEPTION 'NQ:ACCOUNT_EXISTS_USE_INVITATION';END IF;
 INSERT INTO staff_memberships(merchant_id,user_id,email,name,role,max_qty) VALUES(mid,uid,lower(email_arg),split_part(email_arg,'@',1),role_arg,qty_arg) RETURNING id INTO sid;
 INSERT INTO business_managed_accounts(user_id,merchant_id,provisioned_by) VALUES(uid,mid,app_user());
 FOREACH bid IN ARRAY branches_arg LOOP INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES(mid,sid,bid);END LOOP;
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail) VALUES(app_user(),mid,'staff.account.create',sid,jsonb_build_object('role',role_arg,'branchIds',branches_arg));
 RETURN jsonb_build_object('id',sid,'userId',uid,'email',lower(email_arg),'role',role_arg,'status','active');
END $$;

-- Customers are never limited by the shop's plan: the customer cap is gone.
CREATE OR REPLACE FUNCTION public.enroll_customer(mid uuid, pid uuid, version_arg uuid, alias_arg text, source_arg text, branch_arg uuid, consents_arg jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE account users; merchant merchants; prog programs; ver program_versions; profile uuid; existing memberships; membership uuid; limits feature_entitlements; ch text; accept_text text;
BEGIN
 SELECT * INTO account FROM users WHERE id=app_user() AND status='active';IF NOT FOUND THEN RAISE EXCEPTION 'NQ:UNAUTHENTICATED';END IF;
 SELECT * INTO merchant FROM merchants WHERE id=mid FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF merchant.status='suspended' THEN RAISE EXCEPTION 'NQ:MERCHANT_PAUSED';END IF;
 IF NOT customer_scope_ok(mid) THEN RAISE EXCEPTION 'NQ:DEVICE_SCOPE_RECOVERY_REQUIRED';END IF;
 SELECT * INTO prog FROM programs WHERE id=pid AND merchant_id=mid FOR SHARE;IF NOT FOUND OR prog.status<>'active' THEN RAISE EXCEPTION 'NQ:PROGRAM_INACTIVE';END IF;
 SELECT * INTO ver FROM program_versions WHERE id=prog.current_version_id;
 IF version_arg<>ver.id THEN RAISE EXCEPTION 'NQ:PROGRAM_VERSION_CHANGED';END IF;
 IF ver.starts_at>clock_timestamp() OR (ver.ends_at IS NOT NULL AND ver.ends_at<=clock_timestamp()) THEN RAISE EXCEPTION 'NQ:PROGRAM_INACTIVE';END IF;
 IF branch_arg IS NOT NULL AND NOT EXISTS(SELECT 1 FROM branches WHERE id=branch_arg AND merchant_id=mid AND status='active') THEN RAISE EXCEPTION 'NQ:BRANCH_UNAUTHORIZED';END IF;
 SELECT * INTO limits FROM feature_entitlements WHERE merchant_id=mid FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'NQ:ENTITLEMENTS_NOT_CONFIGURED';END IF;
 SELECT * INTO existing FROM memberships WHERE merchant_id=mid AND program_id=pid AND user_id=account.id;
 IF FOUND THEN RETURN jsonb_build_object('membershipId',existing.id,'alreadyMember',true);END IF;
 SELECT id INTO profile FROM tenant_customer_profiles WHERE merchant_id=mid AND user_id=account.id;
 IF profile IS NULL THEN
  INSERT INTO tenant_customer_profiles(merchant_id,user_id,alias,contact_email) VALUES(mid,account.id,alias_arg,coalesce(account.email,'')) RETURNING id INTO profile;
 END IF;
 INSERT INTO memberships(merchant_id,profile_id,user_id,program_id,program_version_id,source,origin_branch_id) VALUES(mid,profile,account.id,pid,ver.id,source_arg,branch_arg) RETURNING id INTO membership;
 INSERT INTO loyalty_accounts(membership_id,merchant_id,program_version_id) VALUES(membership,mid,ver.id);
 accept_text=merchant.terms||E'\n'||ver.reward_terms;
 INSERT INTO terms_acceptances(merchant_id,membership_id,user_id,program_version_id,terms_text,terms_hash) VALUES(mid,membership,account.id,ver.id,accept_text,encode(sha256(convert_to(accept_text,'UTF8')),'hex'));
 PERFORM pg_advisory_xact_lock(hashtextextended('consent:'||mid::text||':'||account.id::text,0));
 FOREACH ch IN ARRAY ARRAY['email','sms','whatsapp'] LOOP
  INSERT INTO consent_current(merchant_id,user_id,channel,granted) VALUES(mid,account.id,ch,coalesce((consents_arg->>ch)::boolean,false)) ON CONFLICT DO NOTHING;
  IF FOUND THEN
   INSERT INTO consent_events(merchant_id,user_id,channel,granted) VALUES(mid,account.id,ch,coalesce((consents_arg->>ch)::boolean,false));
  END IF;
 END LOOP;
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail) VALUES(account.id,mid,'membership.enroll',membership,jsonb_build_object('programVersionId',ver.id,'source',source_arg));
 RETURN jsonb_build_object('membershipId',membership,'alreadyMember',false);
END $$;

-- Earning (customer stamping) is no longer tied to payment. Only an explicit admin pause, or the
-- existing merchant suspension, stops it; a late payment only limits what the owner can add.
CREATE OR REPLACE FUNCTION merchant_earning_allowed(mid uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce((SELECT NOT e.earning_paused FROM feature_entitlements e WHERE e.merchant_id=mid),false)
$$;

-- The billing calendar, run by the worker every minute. Nothing here suspends a shop: after grace,
-- suspension stays a Super Admin decision (the existing paused screen).
--   trial ended or paid period ended without payment → past_due (cancel_at_period_end → cancelled)
--   past_due for 7 days → grace (no new branches/staff/programs)
CREATE FUNCTION advance_subscription_states() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s merchant_subscriptions; next_status text; since timestamptz; moved integer:=0; now_at timestamptz:=clock_timestamp();
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('subscription-calendar',0)) THEN RETURN 0; END IF;
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
REVOKE ALL ON FUNCTION advance_subscription_states() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION advance_subscription_states() TO nuqta_worker;
