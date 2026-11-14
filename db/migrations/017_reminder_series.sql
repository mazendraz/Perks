-- Several reminders per absence, written for each customer (stamps left / reward waiting).
-- A customer away for inactivityDays gets reminder 1, then one every cooldownDays,
-- up to maxReminders (1-5, default 1 for shops that saved settings before this).
ALTER TABLE customer_reminders ADD COLUMN step integer NOT NULL DEFAULT 1 CHECK(step BETWEEN 1 AND 5);
DO $$ DECLARE c text; BEGIN
 SELECT conname INTO c FROM pg_constraint WHERE conrelid='customer_reminders'::regclass AND contype='u';
 EXECUTE format('ALTER TABLE customer_reminders DROP CONSTRAINT %I',c);
END $$;
ALTER TABLE customer_reminders ADD CONSTRAINT customer_reminders_step_key UNIQUE(merchant_id,profile_id,activity_at,channel,step);

-- A visit is a confirmed stamp (scan, request, automatic) or a reward collected at the counter.
-- Every visit restarts the absence: queued reminders for the old absence stop (reminder_eligible
-- compares this value) and the next one waits a full inactivityDays from this visit.
-- Welcome stamps and staff corrections are not visits.
CREATE OR REPLACE FUNCTION reminder_last_purchase(profile_arg uuid) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT max(t.at) FROM memberships ms JOIN loyalty_transactions t ON t.membership_id=ms.id
 WHERE ms.profile_id=profile_arg AND ((t.type='award' AND t.source IN ('scan','request','auto')) OR t.type='redeem')
$$;

CREATE OR REPLACE FUNCTION schedule_customer_reminders(apple_enabled boolean,google_enabled boolean) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE added integer;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('customer-reminder-schedule',0)) THEN RETURN 0; END IF;
 UPDATE customer_reminders r SET returned_at=reminder_last_purchase(r.profile_id)
 WHERE r.status='accepted' AND r.returned_at IS NULL AND reminder_last_purchase(r.profile_id)>r.accepted_at;
 INSERT INTO customer_reminders(merchant_id,profile_id,membership_id,activity_at,channel,step)
 SELECT m.id,cp.id,chosen.id,last_purchase.at,ch.channel,sent.n+1
 FROM customer_reminder_settings s JOIN merchants m ON m.id=s.merchant_id
 JOIN tenant_customer_profiles cp ON cp.merchant_id=m.id JOIN users u ON u.id=cp.user_id AND u.status='active'
 JOIN consent_current cc ON cc.merchant_id=m.id AND cc.user_id=u.id AND cc.channel='push' AND cc.granted
 CROSS JOIN LATERAL(SELECT reminder_last_purchase(cp.id) AS at) last_purchase
 CROSS JOIN (VALUES('apple',apple_enabled),('google',google_enabled)) ch(channel,enabled)
 CROSS JOIN LATERAL(
  SELECT ms.id FROM memberships ms JOIN programs p ON p.id=ms.program_id JOIN program_versions v ON v.id=ms.program_version_id
  WHERE ms.profile_id=cp.id AND ms.status='active' AND p.status='active' AND (v.ends_at IS NULL OR v.ends_at>now())
  AND CASE ch.channel WHEN 'apple' THEN EXISTS(SELECT 1 FROM wallet_passes w JOIN wallet_registrations wr ON wr.serial=w.serial WHERE w.membership_id=ms.id)
   ELSE EXISTS(SELECT 1 FROM google_wallet_objects g WHERE g.membership_id=ms.id) END
  ORDER BY ms.joined_at DESC,ms.id LIMIT 1
 ) chosen
 -- Reminders already made for this absence on this channel.
 CROSS JOIN LATERAL(SELECT count(*)::int AS n FROM customer_reminders old WHERE old.merchant_id=m.id AND old.profile_id=cp.id
  AND old.channel=ch.channel AND old.activity_at=last_purchase.at) sent
 WHERE s.settings->>'enabled'='true' AND ch.enabled AND m.status IN ('active','trial') AND merchant_earning_allowed(m.id)
 AND extract(hour FROM now() AT TIME ZONE m.timezone) BETWEEN (s.settings->>'sendHour')::int AND 20
 AND last_purchase.at<=now()-make_interval(days=>(s.settings->>'inactivityDays')::int)
 AND sent.n<least(5,greatest(1,coalesce((s.settings->>'maxReminders')::int,1)))
 AND NOT EXISTS(SELECT 1 FROM customer_reminders old WHERE old.merchant_id=m.id AND old.profile_id=cp.id AND old.channel=ch.channel
  AND old.created_at>now()-make_interval(days=>(s.settings->>'cooldownDays')::int))
 ORDER BY last_purchase.at,cp.id LIMIT 500 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 RETURN added;
END $$;

CREATE OR REPLACE FUNCTION claim_customer_reminder(apple_enabled boolean,google_enabled boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE job customer_reminders; result jsonb; local_hour integer; previously_uncertain boolean;
BEGIN
 SELECT * INTO job FROM customer_reminders r WHERE r.next_at<=now()
 AND (r.status IN ('queued','uncertain') OR (r.status='processing' AND r.lease_until<now()))
 AND CASE r.channel WHEN 'apple' THEN apple_enabled ELSE google_enabled END
 ORDER BY r.next_at,r.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 -- An interrupted request may have reached Google. Reconcile it before considering another send.
 previously_uncertain:=job.status='uncertain' OR (job.status='processing' AND job.channel='google');
 IF NOT reminder_eligible(job.id) THEN
  UPDATE customer_reminders SET status='skipped',lease_until=NULL,error_code='NO_LONGER_ELIGIBLE' WHERE id=job.id;
  RETURN NULL;
 END IF;
 SELECT extract(hour FROM now() AT TIME ZONE m.timezone) INTO local_hour FROM merchants m WHERE m.id=job.merchant_id;
 IF local_hour<8 OR local_hour>20 THEN
  UPDATE customer_reminders SET next_at=now()+interval '1 hour' WHERE id=job.id;
  RETURN NULL;
 END IF;
 UPDATE customer_reminders SET status='processing',lease_id=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1
 WHERE id=job.id RETURNING * INTO job;
 IF job.channel='apple' THEN
  -- Publish the new pass before APNs tells the phone to fetch it.
  UPDATE wallet_passes w SET changed_at=clock_timestamp(),fingerprint=wallet_fingerprint(wallet_card_json(w.membership_id)) WHERE w.membership_id=job.membership_id;
 END IF;
 SELECT jsonb_build_object('id',job.id,'lease',job.lease_id,'channel',job.channel,'reconcileOnly',previously_uncertain,
  'card',wallet_card_json(job.membership_id),'locale',u.preferred_locale,
  'templates',(SELECT jsonb_build_object('wallet',settings->'wallet','walletReady',settings->'walletReady') FROM customer_reminder_settings WHERE merchant_id=job.merchant_id),
  'objectKey',(SELECT object_key FROM google_wallet_objects WHERE membership_id=job.membership_id),
  'tokens',coalesce((SELECT jsonb_agg(DISTINCT wr.push_token) FROM wallet_passes w JOIN wallet_registrations wr ON wr.serial=w.serial WHERE w.membership_id=job.membership_id),'[]'))
 INTO result FROM memberships ms JOIN users u ON u.id=ms.user_id WHERE ms.id=job.membership_id;
 RETURN result;
END $$;

-- The pass gets the templates and fills them with its own numbers (apps/api/src/wallet/apple-pass.ts).
CREATE OR REPLACE FUNCTION wallet_card_json(member_arg uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT wallet_card_base_json(member_arg) || jsonb_build_object('reminder_templates',message.templates)
 FROM (SELECT 1) singleton LEFT JOIN LATERAL(
  SELECT jsonb_build_object('wallet',s.settings->'wallet','walletReady',s.settings->'walletReady') AS templates
  FROM customer_reminders r JOIN customer_reminder_settings s ON s.merchant_id=r.merchant_id
  WHERE r.membership_id=member_arg AND r.channel='apple' AND r.status IN ('processing','accepted') AND reminder_eligible(r.id)
  ORDER BY r.created_at DESC LIMIT 1
 ) message ON true
$$;
