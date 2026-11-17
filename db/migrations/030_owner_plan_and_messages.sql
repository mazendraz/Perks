-- Subscription plans and entitlements, phase 4: the owner's plan page, requests to the Perks team,
-- what stays active after a downgrade, and manual Wallet messages.

/* ------------------------------------------------------------------ plan requests */
-- Billing is manual: the owner asks, the Perks team approves (and records the payment).
CREATE TABLE plan_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 merchant_id uuid NOT NULL REFERENCES merchant_subscriptions(merchant_id),
 kind text NOT NULL CHECK(kind IN ('change_plan','addon')),
 plan_key text CHECK(plan_key ~ '^[a-z][a-z0-9_]{1,31}$'),
 billing_period text CHECK(billing_period IN ('monthly','annual')),
 addon_key text CHECK(addon_key IN ('extra_branch','extra_staff')),
 quantity integer CHECK(quantity BETWEEN 1 AND 100),
 note text CHECK(char_length(note)<=500),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','approved','declined','withdrawn')),
 requested_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 closed_by uuid REFERENCES users(id),
 closed_at timestamptz,
 close_reason text CHECK(char_length(close_reason)<=500),
 CHECK((kind='change_plan' AND plan_key IS NOT NULL AND billing_period IS NOT NULL AND addon_key IS NULL AND quantity IS NULL)
  OR (kind='addon' AND addon_key IS NOT NULL AND quantity IS NOT NULL AND plan_key IS NULL)),
 CHECK((status='open')=(closed_at IS NULL))
);
-- One open request at a time keeps the conversation with the shop simple.
CREATE UNIQUE INDEX plan_requests_one_open ON plan_requests(merchant_id) WHERE status='open';
ALTER TABLE plan_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY plan_requests_read ON plan_requests FOR SELECT USING(is_platform_admin() OR merchant_owner(merchant_id));
CREATE POLICY plan_requests_insert ON plan_requests FOR INSERT WITH CHECK(merchant_owner(merchant_id) AND requested_by=app_user());
-- The owner can only withdraw their own open request; approving or declining is the platform's.
CREATE POLICY plan_requests_update ON plan_requests FOR UPDATE USING(is_platform_admin() OR (merchant_owner(merchant_id) AND status='open'))
 WITH CHECK(is_platform_admin() OR (merchant_owner(merchant_id) AND status='withdrawn' AND closed_by=app_user()));
REVOKE ALL ON plan_requests FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON plan_requests TO nuqta_runtime;

/* ------------------------------------------------------------- what stays active */
-- The limit an owner's choice is measured against: the incoming plan when a downgrade is
-- scheduled, otherwise today's effective limit. NULL = unlimited.
CREATE FUNCTION keep_limit(mid uuid,k text) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE pending uuid; r record;
BEGIN
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
REVOKE ALL ON FUNCTION keep_limit(uuid,text) FROM PUBLIC;

-- The owner picks which branches, programs or staff stay active. Only items that are active
-- or were locked by the plan can be picked; anything the owner turned off stays off.
-- With no downgrade waiting, the pick applies now: the chosen come back, others are locked.
CREATE FUNCTION owner_keep_items(mid uuid,kind_arg text,ids uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE k text; lim integer; valid integer; pending uuid; st text; now_at timestamptz:=clock_timestamp(); result jsonb:='{"locked":[],"unlocked":[]}';
BEGIN
 IF NOT merchant_owner(mid) THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 IF kind_arg NOT IN ('branch','program','staff') OR ids IS NULL OR cardinality(ids)>500
  OR cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids) x) THEN RAISE EXCEPTION 'NQ:VALIDATION_FAILED'; END IF;
 SELECT pending_plan_id,status INTO pending,st FROM merchant_subscriptions WHERE merchant_id=mid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:ENTITLEMENTS_NOT_CONFIGURED'; END IF;
 IF st IN ('cancelled','suspended') THEN RAISE EXCEPTION 'NQ:SUBSCRIPTION_INACTIVE'; END IF;
 k:=CASE kind_arg WHEN 'branch' THEN 'max_branches' WHEN 'program' THEN 'max_active_programs' ELSE 'max_staff' END;
 lim:=keep_limit(mid,k);
 IF kind_arg='branch' AND cardinality(ids)<1 THEN RAISE EXCEPTION 'NQ:VALIDATION_FAILED'; END IF;
 IF lim IS NOT NULL AND cardinality(ids)>lim THEN
  RAISE EXCEPTION 'NQ:PLAN_LIMIT_REACHED'
   USING DETAIL=jsonb_build_object('entitlement',k,'limit',lim,'used',cardinality(ids),'options','[]'::jsonb)::text;
 END IF;
 valid:=CASE kind_arg
  WHEN 'branch' THEN (SELECT count(*) FROM branches WHERE merchant_id=mid AND id=ANY(ids) AND (status='active' OR locked_at IS NOT NULL))
  WHEN 'program' THEN (SELECT count(*) FROM programs WHERE merchant_id=mid AND id=ANY(ids) AND (status='active' OR locked_at IS NOT NULL))
  ELSE (SELECT count(*) FROM staff_memberships WHERE merchant_id=mid AND id=ANY(ids) AND role<>'owner' AND (status='active' OR locked_at IS NOT NULL)) END;
 IF valid<>cardinality(ids) THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 DELETE FROM plan_keep_choices WHERE merchant_id=mid AND kind=kind_arg;
 INSERT INTO plan_keep_choices(merchant_id,kind,item_id,chosen_by) SELECT mid,kind_arg,x,app_user() FROM unnest(ids) x;
 -- A scheduled downgrade reads these choices when it lands; nothing moves today.
 IF pending IS NOT NULL OR lim IS NULL THEN RETURN result; END IF;
 -- Swap now: lock the active items that were not chosen, then let the plan fill the free
 -- places, chosen first and then the oldest. Only items the plan locked are ever touched.
 IF kind_arg='branch' AND EXISTS(SELECT 1 FROM branches WHERE merchant_id=mid AND locked_at IS NOT NULL AND id=ANY(ids)) THEN
  UPDATE branches SET status='disabled',locked_at=now_at,revision=revision+1
   WHERE merchant_id=mid AND status='active' AND locked_at IS NULL AND NOT id=ANY(ids);
 ELSIF kind_arg='program' AND EXISTS(SELECT 1 FROM programs WHERE merchant_id=mid AND locked_at IS NOT NULL AND id=ANY(ids)) THEN
  UPDATE programs SET status='ended',locked_at=now_at WHERE merchant_id=mid AND status='active' AND locked_at IS NULL AND NOT id=ANY(ids);
 ELSIF kind_arg='staff' AND EXISTS(SELECT 1 FROM staff_memberships WHERE merchant_id=mid AND locked_at IS NOT NULL AND id=ANY(ids)) THEN
  UPDATE staff_memberships SET status='disabled',locked_at=now_at,revision=revision+1
   WHERE merchant_id=mid AND role<>'owner' AND status='active' AND locked_at IS NULL AND NOT id=ANY(ids);
 ELSE
  RETURN result;
 END IF;
 RETURN enforce_plan_limits(mid);
END $$;
REVOKE ALL ON FUNCTION owner_keep_items(uuid,text,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION owner_keep_items(uuid,text,uuid[]) TO nuqta_runtime;

/* --------------------------------------------------------- manual Wallet messages */
-- A message the owner writes once and the Wallet cards of chosen customers receive.
-- Each send uses one of the plan's messages for the month (Cairo calendar month).
CREATE TABLE wallet_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 audience text NOT NULL CHECK(audience IN ('all','reward_ready','near_reward','inactive')),
 inactive_days integer CHECK(inactive_days BETWEEN 7 AND 365),
 body_ar text NOT NULL CHECK(char_length(body_ar) BETWEEN 1 AND 150),
 body_en text CHECK(char_length(body_en) BETWEEN 1 AND 150),
 recipients integer NOT NULL CHECK(recipients>=0),
 send_after timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((audience='inactive')=(inactive_days IS NOT NULL))
);
CREATE TABLE wallet_message_deliveries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 message_id uuid NOT NULL REFERENCES wallet_messages(id),
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 profile_id uuid NOT NULL,
 membership_id uuid NOT NULL,
 channel text NOT NULL CHECK(channel IN ('apple','google')),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','accepted','failed','skipped','uncertain')),
 attempts integer NOT NULL DEFAULT 0,
 lease_id uuid,lease_until timestamptz,
 next_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 accepted_at timestamptz,error_code text,
 UNIQUE(message_id,profile_id,channel),
 FOREIGN KEY(merchant_id,profile_id) REFERENCES tenant_customer_profiles(merchant_id,id),
 FOREIGN KEY(merchant_id,membership_id) REFERENCES memberships(merchant_id,id)
);
CREATE INDEX wallet_message_queue ON wallet_message_deliveries(next_at) WHERE status IN ('queued','processing','uncertain');
CREATE INDEX wallet_message_recent ON wallet_message_deliveries(merchant_id,profile_id,created_at);
ALTER TABLE wallet_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_message_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_messages_read ON wallet_messages FOR SELECT USING(is_platform_admin() OR merchant_owner(merchant_id));
CREATE POLICY wallet_message_deliveries_read ON wallet_message_deliveries FOR SELECT USING(is_platform_admin() OR merchant_owner(merchant_id));
REVOKE ALL ON wallet_messages,wallet_message_deliveries FROM PUBLIC;
GRANT SELECT ON wallet_messages,wallet_message_deliveries TO nuqta_runtime;

-- Quiet hours: cards are only notified between 10:00 and 21:00 shop time.
CREATE FUNCTION wallet_message_send_at(tz text,at timestamptz) RETURNS timestamptz LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT CASE
  WHEN extract(hour FROM at AT TIME ZONE tz) BETWEEN 10 AND 20 THEN at
  WHEN extract(hour FROM at AT TIME ZONE tz)<10 THEN (date_trunc('day',at AT TIME ZONE tz)+interval '10 hours') AT TIME ZONE tz
  ELSE (date_trunc('day',at AT TIME ZONE tz)+interval '1 day 10 hours') AT TIME ZONE tz END
$$;

-- Who a message reaches: one card per customer and channel (their newest active card on it),
-- only with push consent, and never twice in a day from the same shop.
CREATE FUNCTION wallet_message_audience(mid uuid,audience_arg text,days_arg integer,apple_enabled boolean,google_enabled boolean)
RETURNS TABLE(profile_id uuid,membership_id uuid,channel text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT cp.id,chosen.id,ch.channel
 FROM merchants m JOIN tenant_customer_profiles cp ON cp.merchant_id=m.id
 JOIN users u ON u.id=cp.user_id AND u.status='active'
 JOIN consent_current cc ON cc.merchant_id=m.id AND cc.user_id=u.id AND cc.channel='push' AND cc.granted
 CROSS JOIN (VALUES('apple',apple_enabled),('google',google_enabled)) ch(channel,enabled)
 CROSS JOIN LATERAL(
  SELECT ms.id FROM memberships ms JOIN programs p ON p.id=ms.program_id
  JOIN program_versions v ON v.id=ms.program_version_id JOIN loyalty_accounts a ON a.membership_id=ms.id
  WHERE ms.profile_id=cp.id AND ms.status='active' AND p.status='active'
  AND CASE ch.channel WHEN 'apple' THEN EXISTS(SELECT 1 FROM wallet_passes w JOIN wallet_registrations wr ON wr.serial=w.serial WHERE w.membership_id=ms.id)
   ELSE EXISTS(SELECT 1 FROM google_wallet_objects g WHERE g.membership_id=ms.id) END
  AND CASE audience_arg
   WHEN 'reward_ready' THEN EXISTS(SELECT 1 FROM reward_grants r WHERE r.membership_id=ms.id AND r.status='available' AND r.expires_at>now())
   WHEN 'near_reward' THEN v.threshold-a.balance BETWEEN 1 AND 2
    AND NOT EXISTS(SELECT 1 FROM reward_grants r WHERE r.membership_id=ms.id AND r.status='available' AND r.expires_at>now())
   ELSE true END
  ORDER BY ms.joined_at DESC,ms.id LIMIT 1
 ) chosen
 WHERE m.id=mid AND ch.enabled
 AND (audience_arg<>'inactive' OR coalesce(reminder_last_purchase(cp.id),cp.created_at)<=now()-make_interval(days=>days_arg))
 AND NOT EXISTS(SELECT 1 FROM wallet_message_deliveries d WHERE d.merchant_id=mid AND d.profile_id=cp.id
  AND d.created_at>now()-interval '1 day')
$$;
REVOKE ALL ON FUNCTION wallet_message_audience(uuid,text,integer,boolean,boolean) FROM PUBLIC;

CREATE FUNCTION wallet_message_preview(mid uuid,audience_arg text,days_arg integer,apple_enabled boolean,google_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT merchant_owner(mid) THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 IF audience_arg NOT IN ('all','reward_ready','near_reward','inactive') THEN RAISE EXCEPTION 'NQ:VALIDATION_FAILED'; END IF;
 SELECT jsonb_build_object('customers',count(DISTINCT a.profile_id),
  'apple',count(*) FILTER(WHERE a.channel='apple'),'google',count(*) FILTER(WHERE a.channel='google'))
 INTO result FROM wallet_message_audience(mid,audience_arg,coalesce(days_arg,30),apple_enabled,google_enabled) a;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION wallet_message_preview(uuid,text,integer,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wallet_message_preview(uuid,text,integer,boolean,boolean) TO nuqta_runtime;

CREATE FUNCTION create_wallet_message(mid uuid,audience_arg text,days_arg integer,ar text,en text,apple_enabled boolean,google_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE msg uuid; n integer; tz text; ms text; st text; at timestamptz;
BEGIN
 IF NOT merchant_owner(mid) THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 IF audience_arg NOT IN ('all','reward_ready','near_reward','inactive') THEN RAISE EXCEPTION 'NQ:VALIDATION_FAILED'; END IF;
 SELECT m.timezone,m.status INTO tz,ms FROM merchants m WHERE m.id=mid FOR SHARE;
 IF ms='suspended' THEN RAISE EXCEPTION 'NQ:MERCHANT_PAUSED'; END IF;
 SELECT status INTO st FROM merchant_subscriptions WHERE merchant_id=mid;
 IF st IN ('cancelled','suspended') THEN RAISE EXCEPTION 'NQ:SUBSCRIPTION_INACTIVE'; END IF;
 IF NOT (apple_enabled OR google_enabled) THEN RAISE EXCEPTION 'NQ:WALLET_MESSAGES_UNAVAILABLE'; END IF;
 SELECT count(DISTINCT a.profile_id) INTO n FROM wallet_message_audience(mid,audience_arg,days_arg,apple_enabled,google_enabled) a;
 -- No customer would get it: say so before using one of the month's messages.
 IF n=0 THEN RAISE EXCEPTION 'NQ:NO_RECIPIENTS'; END IF;
 -- Locks the subscription row, checks the month's allowance and counts this send.
 PERFORM consume_entitlement_usage(mid,'manual_messages_per_month');
 at:=wallet_message_send_at(tz,clock_timestamp());
 INSERT INTO wallet_messages(merchant_id,audience,inactive_days,body_ar,body_en,recipients,send_after,created_by)
 VALUES(mid,audience_arg,CASE WHEN audience_arg='inactive' THEN days_arg END,ar,en,n,at,app_user()) RETURNING id INTO msg;
 INSERT INTO wallet_message_deliveries(message_id,merchant_id,profile_id,membership_id,channel,next_at)
 SELECT msg,mid,a.profile_id,a.membership_id,a.channel,at FROM wallet_message_audience(mid,audience_arg,days_arg,apple_enabled,google_enabled) a
 ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('id',msg,'recipients',n,'sendAfter',at);
END $$;
REVOKE ALL ON FUNCTION create_wallet_message(uuid,text,integer,text,text,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_wallet_message(uuid,text,integer,text,text,boolean,boolean) TO nuqta_runtime;

-- Still worth sending? The card, the customer, their consent and the shop all still allow it.
CREATE FUNCTION wallet_message_eligible(id_arg uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(bool_and(m.status<>'suspended' AND u.status='active' AND ms.status='active' AND p.status='active'
  AND coalesce(cc.granted,false) AND d.created_at>now()-interval '7 days'
  AND coalesce(s.status NOT IN ('cancelled','suspended'),true)),false)
 FROM wallet_message_deliveries d JOIN merchants m ON m.id=d.merchant_id
 JOIN memberships ms ON ms.id=d.membership_id JOIN programs p ON p.id=ms.program_id JOIN users u ON u.id=ms.user_id
 LEFT JOIN merchant_subscriptions s ON s.merchant_id=m.id
 LEFT JOIN consent_current cc ON cc.merchant_id=m.id AND cc.user_id=u.id AND cc.channel='push'
 WHERE d.id=id_arg
$$;
REVOKE ALL ON FUNCTION wallet_message_eligible(uuid) FROM PUBLIC;

CREATE FUNCTION claim_wallet_message(apple_enabled boolean,google_enabled boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job wallet_message_deliveries; result jsonb; tz text; previously_uncertain boolean;
BEGIN
 SELECT * INTO job FROM wallet_message_deliveries d WHERE d.next_at<=now()
 AND (d.status IN ('queued','uncertain') OR (d.status='processing' AND d.lease_until<now()))
 AND CASE d.channel WHEN 'apple' THEN apple_enabled ELSE google_enabled END
 ORDER BY d.next_at,d.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 previously_uncertain:=job.status='uncertain' OR (job.status='processing' AND job.channel='google');
 IF NOT wallet_message_eligible(job.id) THEN
  UPDATE wallet_message_deliveries SET status='skipped',lease_until=NULL,error_code='NO_LONGER_ELIGIBLE' WHERE id=job.id;
  RETURN NULL;
 END IF;
 SELECT m.timezone INTO tz FROM merchants m WHERE m.id=job.merchant_id;
 IF wallet_message_send_at(tz,now())>now() THEN
  UPDATE wallet_message_deliveries SET next_at=wallet_message_send_at(tz,now()) WHERE id=job.id;
  RETURN NULL;
 END IF;
 UPDATE wallet_message_deliveries SET status='processing',lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1
 WHERE id=job.id RETURNING * INTO job;
 IF job.channel='apple' THEN
  -- Publish the new pass before APNs tells the phone to fetch it.
  UPDATE wallet_passes w SET changed_at=clock_timestamp(),fingerprint=wallet_fingerprint(wallet_card_json(w.membership_id)) WHERE w.membership_id=job.membership_id;
 END IF;
 SELECT jsonb_build_object('id',job.id,'lease',job.lease_id,'channel',job.channel,'reconcileOnly',previously_uncertain,
  'card',wallet_card_json(job.membership_id),
  'message',jsonb_build_object('ar',wm.body_ar,'en',coalesce(wm.body_en,wm.body_ar)),
  'objectKey',(SELECT object_key FROM google_wallet_objects WHERE membership_id=job.membership_id),
  'tokens',coalesce((SELECT jsonb_agg(DISTINCT wr.push_token) FROM wallet_passes w JOIN wallet_registrations wr ON wr.serial=w.serial WHERE w.membership_id=job.membership_id),'[]'))
 INTO result FROM wallet_messages wm WHERE wm.id=job.message_id;
 RETURN result;
END $$;
CREATE FUNCTION finish_wallet_message(id_arg uuid,lease_arg uuid,outcome text,error_arg text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF outcome NOT IN ('accepted','retry','failed','skipped','uncertain') THEN RAISE EXCEPTION 'NQ:VALIDATION_FAILED'; END IF;
 UPDATE wallet_message_deliveries SET
  status=CASE WHEN outcome='retry' THEN CASE WHEN attempts<5 THEN 'queued' ELSE 'failed' END ELSE outcome END,
  accepted_at=CASE WHEN outcome='accepted' THEN clock_timestamp() ELSE accepted_at END,
  error_code=error_arg,lease_until=NULL,
  next_at=CASE WHEN attempts>=5 AND outcome='uncertain' THEN now()+interval '8 days' ELSE now()+make_interval(mins=>least(60,attempts*5)) END
 WHERE id=id_arg AND lease_id=lease_arg AND status='processing' AND lease_until>now();
END $$;
CREATE FUNCTION wallet_message_dispatch_allowed(id_arg uuid,lease_arg uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM wallet_message_deliveries WHERE id=id_arg AND lease_id=lease_arg AND status='processing'
  AND lease_until>now() AND wallet_message_eligible(id_arg))
$$;
REVOKE ALL ON FUNCTION claim_wallet_message(boolean,boolean),finish_wallet_message(uuid,uuid,text,text),
 wallet_message_dispatch_allowed(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_wallet_message(boolean,boolean),finish_wallet_message(uuid,uuid,text,text),
 wallet_message_dispatch_allowed(uuid,uuid) TO nuqta_worker;

-- The Apple card shows the newest of: the shop's reminder or its manual message.
-- reminder_templates stays in every card (NULL when none) so existing passes are not re-sent.
CREATE OR REPLACE FUNCTION wallet_card_json(member_arg uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT wallet_card_base_json(member_arg)
  || jsonb_build_object('reminder_templates',CASE WHEN manual.at IS NULL OR reminder.at>manual.at THEN reminder.templates END)
  || CASE WHEN manual.at IS NOT NULL AND (reminder.at IS NULL OR manual.at>=reminder.at)
     THEN jsonb_build_object('manual_message',manual.message) ELSE '{}'::jsonb END
 FROM (SELECT 1) singleton LEFT JOIN LATERAL(
  SELECT jsonb_build_object('wallet',s.settings->'wallet','walletReady',s.settings->'walletReady') AS templates,r.created_at AS at
  FROM customer_reminders r JOIN customer_reminder_settings s ON s.merchant_id=r.merchant_id
  WHERE r.membership_id=member_arg AND r.channel='apple' AND r.status IN ('processing','accepted') AND reminder_eligible(r.id)
  ORDER BY r.created_at DESC LIMIT 1
 ) reminder ON true LEFT JOIN LATERAL(
  SELECT jsonb_build_object('id',d.id,'ar',wm.body_ar,'en',coalesce(wm.body_en,wm.body_ar)) AS message,d.created_at AS at
  FROM wallet_message_deliveries d JOIN wallet_messages wm ON wm.id=d.message_id
  WHERE d.membership_id=member_arg AND d.channel='apple' AND d.status IN ('processing','accepted') AND wallet_message_eligible(d.id)
  ORDER BY d.created_at DESC LIMIT 1
 ) manual ON true
$$;

-- Google gets messages through addMessage; neither the reminder nor the manual message
-- changes the Google card itself, so both stay out of its fingerprint.
CREATE OR REPLACE FUNCTION google_wallet_claim_changes() RETURNS TABLE(object_key uuid,card jsonb) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 RETURN QUERY
 WITH candidates AS (
  SELECT g.object_key,g.fingerprint AS old,wallet_card_json(g.membership_id)-'reminder_templates'-'manual_message' AS card FROM google_wallet_objects g
  FOR UPDATE OF g SKIP LOCKED
 ), changed AS (
  UPDATE google_wallet_objects g SET fingerprint=wallet_fingerprint(c.card),changed_at=clock_timestamp()
  FROM candidates c WHERE g.object_key=c.object_key AND c.old<>wallet_fingerprint(c.card)
  RETURNING g.object_key
 )
 SELECT c.object_key,c.card FROM candidates c JOIN changed USING(object_key);
END $$;
-- google_wallet_issue was patched since (device scope, 020), so only its fingerprint line changes.
DO $$
DECLARE def text:=pg_get_functiondef('google_wallet_issue(uuid,uuid)'::regprocedure);
 old_text text:='wallet_fingerprint(card-''reminder_templates'')';
BEGIN
 IF (length(def)-length(replace(def,old_text,'')))/length(old_text)<>1 THEN
  RAISE EXCEPTION 'google_wallet_issue: expected exactly one fingerprint line';
 END IF;
 EXECUTE replace(def,old_text,'wallet_fingerprint(card-''reminder_templates''-''manual_message'')');
END $$;
GRANT EXECUTE ON FUNCTION keep_limit(uuid,text) TO nuqta_runtime;
