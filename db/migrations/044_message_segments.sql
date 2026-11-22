-- Owners can send a Wallet message straight to an analytics segment ("late", "came once", ...).
-- The rest of the rules stay exactly as before: push consent, a saved Wallet card, one message a
-- day per customer, the monthly allowance. Segment membership is read from customer_stats.
-- Additive: a wider CHECK and the three functions replaced with the same signatures.

ALTER TABLE wallet_messages DROP CONSTRAINT wallet_messages_audience_check;
ALTER TABLE wallet_messages ADD CONSTRAINT wallet_messages_audience_check CHECK(audience IN
 ('all','reward_ready','near_reward','inactive','new','one_time','regular','at_risk','lost','reactivated','vip'));

CREATE FUNCTION wallet_audience_known(a text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT a IN ('all','reward_ready','near_reward','inactive','new','one_time','regular','at_risk','lost','reactivated','vip')
$$;

CREATE OR REPLACE FUNCTION wallet_message_audience(mid uuid,audience_arg text,days_arg integer,apple_enabled boolean,google_enabled boolean)
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
 -- Analytics segments: the customer's current lifecycle or tag.
 AND (audience_arg IN ('all','reward_ready','near_reward','inactive')
  OR EXISTS(SELECT 1 FROM customer_stats s WHERE s.profile_id=cp.id
   AND (s.lifecycle=audience_arg OR audience_arg=ANY(s.tags))))
 AND NOT EXISTS(SELECT 1 FROM wallet_message_deliveries d WHERE d.merchant_id=mid AND d.profile_id=cp.id
  AND d.created_at>now()-interval '1 day')
$$;

CREATE OR REPLACE FUNCTION wallet_message_preview(mid uuid,audience_arg text,days_arg integer,apple_enabled boolean,google_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT merchant_owner(mid) THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 IF NOT wallet_audience_known(audience_arg) THEN RAISE EXCEPTION 'NQ:VALIDATION_FAILED'; END IF;
 SELECT jsonb_build_object('customers',count(DISTINCT a.profile_id),
  'apple',count(*) FILTER(WHERE a.channel='apple'),'google',count(*) FILTER(WHERE a.channel='google'))
 INTO result FROM wallet_message_audience(mid,audience_arg,coalesce(days_arg,30),apple_enabled,google_enabled) a;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION create_wallet_message(mid uuid,audience_arg text,days_arg integer,ar text,en text,apple_enabled boolean,google_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE msg uuid; n integer; tz text; ms text; st text; at timestamptz;
BEGIN
 IF NOT merchant_owner(mid) THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 IF NOT wallet_audience_known(audience_arg) THEN RAISE EXCEPTION 'NQ:VALIDATION_FAILED'; END IF;
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

-- Who came back after a message: customers it reached who visited within 14 days after delivery.
CREATE FUNCTION wallet_message_returns(msg uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT count(DISTINCT d.profile_id)::int FROM wallet_message_deliveries d
 JOIN memberships ms ON ms.profile_id=d.profile_id
 JOIN loyalty_transactions t ON t.membership_id=ms.id AND t.type='award' AND t.source<>'welcome'
  AND t.at>d.accepted_at AND t.at<=d.accepted_at+interval '14 days'
 WHERE d.message_id=msg AND d.status='accepted' AND tenant_access(d.merchant_id) AND award_still_counts(t.id,t.quantity)
$$;
REVOKE ALL ON FUNCTION wallet_message_returns(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wallet_message_returns(uuid) TO nuqta_runtime;
