-- Explain why a matching customer is excluded, using the same audience rules as sending.
CREATE FUNCTION wallet_message_candidates(mid uuid,audience_arg text,days_arg integer,apple_enabled boolean,google_enabled boolean)
RETURNS TABLE(profile_id uuid,membership_id uuid,channel text,joined_at timestamptz,
 connected boolean,push_allowed boolean,recently_contacted boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT cp.id,ms.id,ch.channel,ms.joined_at,
  ch.enabled AND CASE ch.channel
   WHEN 'apple' THEN EXISTS(SELECT 1 FROM wallet_passes w JOIN wallet_registrations wr ON wr.serial=w.serial WHERE w.membership_id=ms.id)
   ELSE EXISTS(SELECT 1 FROM google_wallet_objects g WHERE g.membership_id=ms.id) END,
  coalesce(cc.granted,false),
  EXISTS(SELECT 1 FROM wallet_message_deliveries d WHERE d.merchant_id=mid AND d.profile_id=cp.id
   AND d.created_at>now()-interval '1 day')
 FROM tenant_customer_profiles cp
 JOIN users u ON u.id=cp.user_id AND u.status='active'
 JOIN memberships ms ON ms.profile_id=cp.id AND ms.merchant_id=cp.merchant_id AND ms.status='active'
 JOIN programs p ON p.id=ms.program_id AND p.status='active'
 JOIN program_versions v ON v.id=ms.program_version_id
 JOIN loyalty_accounts a ON a.membership_id=ms.id
 LEFT JOIN consent_current cc ON cc.merchant_id=cp.merchant_id AND cc.user_id=u.id AND cc.channel='push'
 CROSS JOIN (VALUES('apple',apple_enabled),('google',google_enabled)) ch(channel,enabled)
 WHERE cp.merchant_id=mid
 AND CASE audience_arg
  WHEN 'reward_ready' THEN EXISTS(SELECT 1 FROM reward_grants r WHERE r.membership_id=ms.id AND r.status='available' AND r.expires_at>now())
  WHEN 'near_reward' THEN v.threshold-a.balance BETWEEN 1 AND 2
   AND NOT EXISTS(SELECT 1 FROM reward_grants r WHERE r.membership_id=ms.id AND r.status='available' AND r.expires_at>now())
  WHEN 'inactive' THEN coalesce(reminder_last_purchase(cp.id),cp.created_at)<=now()-make_interval(days=>days_arg)
  WHEN 'all' THEN true
  ELSE EXISTS(SELECT 1 FROM customer_stats s WHERE s.profile_id=cp.id
   AND (s.lifecycle=audience_arg OR audience_arg=ANY(s.tags))) END
$$;
REVOKE ALL ON FUNCTION wallet_message_candidates(uuid,text,integer,boolean,boolean) FROM PUBLIC;

CREATE OR REPLACE FUNCTION wallet_message_audience(mid uuid,audience_arg text,days_arg integer,apple_enabled boolean,google_enabled boolean)
RETURNS TABLE(profile_id uuid,membership_id uuid,channel text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT DISTINCT ON (c.profile_id,c.channel) c.profile_id,c.membership_id,c.channel
 FROM wallet_message_candidates(mid,audience_arg,days_arg,apple_enabled,google_enabled) c
 WHERE c.connected AND c.push_allowed AND NOT c.recently_contacted
 ORDER BY c.profile_id,c.channel,c.joined_at DESC,c.membership_id
$$;

CREATE OR REPLACE FUNCTION wallet_message_preview(mid uuid,audience_arg text,days_arg integer,apple_enabled boolean,google_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF NOT merchant_owner(mid) THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 IF NOT wallet_audience_known(audience_arg) THEN RAISE EXCEPTION 'NQ:VALIDATION_FAILED'; END IF;
 WITH profiles AS (
  SELECT c.profile_id,bool_or(c.connected AND c.channel='apple') AS apple,
   bool_or(c.connected AND c.channel='google') AS google,
   bool_or(c.connected) AS connected,c.push_allowed,c.recently_contacted
  FROM wallet_message_candidates(mid,audience_arg,coalesce(days_arg,30),apple_enabled,google_enabled) c
  GROUP BY c.profile_id,c.push_allowed,c.recently_contacted
 )
 SELECT jsonb_build_object('groupSize',count(*),
  'customers',count(*) FILTER(WHERE connected AND push_allowed AND NOT recently_contacted),
  'apple',count(*) FILTER(WHERE apple AND push_allowed AND NOT recently_contacted),
  'google',count(*) FILTER(WHERE google AND push_allowed AND NOT recently_contacted),
  'notLinked',count(*) FILTER(WHERE NOT connected),
  'notificationsOff',count(*) FILTER(WHERE connected AND NOT push_allowed),
  'recentlyContacted',count(*) FILTER(WHERE connected AND push_allowed AND recently_contacted))
 INTO result FROM profiles;
 RETURN result;
END $$;
