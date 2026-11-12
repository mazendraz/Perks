CREATE TABLE customer_reminder_settings (
 merchant_id uuid PRIMARY KEY REFERENCES merchants(id),
 settings jsonb NOT NULL CHECK(jsonb_typeof(settings)='object'),
 revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE customer_reminders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 profile_id uuid NOT NULL,
 membership_id uuid NOT NULL,
 activity_at timestamptz NOT NULL,
 channel text NOT NULL CHECK(channel IN ('apple','google')),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','accepted','failed','skipped','uncertain')),
 attempts integer NOT NULL DEFAULT 0,
 lease_id uuid,lease_until timestamptz,
 next_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 accepted_at timestamptz,returned_at timestamptz,error_code text,
 UNIQUE(merchant_id,profile_id,activity_at,channel),
 FOREIGN KEY(merchant_id,profile_id) REFERENCES tenant_customer_profiles(merchant_id,id),
 FOREIGN KEY(merchant_id,membership_id) REFERENCES memberships(merchant_id,id)
);
CREATE INDEX customer_reminders_queue ON customer_reminders(next_at) WHERE status IN ('queued','processing','uncertain');
ALTER TABLE customer_reminder_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY reminder_settings_scope ON customer_reminder_settings USING(is_platform_admin() OR tenant_access(merchant_id))
 WITH CHECK(is_platform_admin() OR owner_full_customer_scope(merchant_id));
CREATE POLICY reminders_scope ON customer_reminders USING(is_platform_admin() OR owner_full_customer_scope(merchant_id));
GRANT SELECT,INSERT,UPDATE ON customer_reminder_settings TO nuqta_runtime;
GRANT SELECT ON customer_reminders TO nuqta_runtime;

-- A reminder episode uses the customer's latest confirmed purchase across all their programs.
CREATE FUNCTION reminder_last_purchase(profile_arg uuid) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT max(t.at) FROM memberships ms JOIN loyalty_transactions t ON t.membership_id=ms.id
 WHERE ms.profile_id=profile_arg AND t.type='award' AND t.source IN ('scan','request','auto')
$$;
CREATE FUNCTION reminder_eligible(id_arg uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(bool_and(s.settings->>'enabled'='true' AND m.status IN ('active','trial') AND u.status='active'
  AND ms.status='active' AND p.status='active' AND (v.ends_at IS NULL OR v.ends_at>now())
  AND merchant_earning_allowed(m.id) AND coalesce(cc.granted,false)
  AND reminder_last_purchase(r.profile_id)=r.activity_at
  AND r.activity_at<=now()-make_interval(days=>(s.settings->>'inactivityDays')::int)
  AND r.created_at>now()-interval '7 days'),false)
 FROM customer_reminders r JOIN customer_reminder_settings s ON s.merchant_id=r.merchant_id
 JOIN merchants m ON m.id=r.merchant_id JOIN memberships ms ON ms.id=r.membership_id
 JOIN programs p ON p.id=ms.program_id JOIN program_versions v ON v.id=ms.program_version_id
 JOIN users u ON u.id=ms.user_id
 LEFT JOIN consent_current cc ON cc.merchant_id=m.id AND cc.user_id=u.id AND cc.channel='push'
 WHERE r.id=id_arg
$$;

CREATE FUNCTION schedule_customer_reminders(apple_enabled boolean,google_enabled boolean) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE added integer;
BEGIN
 IF NOT pg_try_advisory_xact_lock(hashtextextended('customer-reminder-schedule',0)) THEN RETURN 0; END IF;
 UPDATE customer_reminders r SET returned_at=reminder_last_purchase(r.profile_id)
 WHERE r.status='accepted' AND r.returned_at IS NULL AND reminder_last_purchase(r.profile_id)>r.accepted_at;
 INSERT INTO customer_reminders(merchant_id,profile_id,membership_id,activity_at,channel)
 SELECT m.id,cp.id,chosen.id,last_purchase.at,ch.channel
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
 WHERE s.settings->>'enabled'='true' AND ch.enabled AND m.status IN ('active','trial') AND merchant_earning_allowed(m.id)
 AND extract(hour FROM now() AT TIME ZONE m.timezone) BETWEEN (s.settings->>'sendHour')::int AND 20
 AND last_purchase.at<=now()-make_interval(days=>(s.settings->>'inactivityDays')::int)
 AND NOT EXISTS(SELECT 1 FROM customer_reminders old WHERE old.merchant_id=m.id AND old.profile_id=cp.id AND old.channel=ch.channel
  AND (old.activity_at=last_purchase.at OR old.created_at>now()-make_interval(days=>(s.settings->>'cooldownDays')::int)))
 ORDER BY last_purchase.at,cp.id LIMIT 500 ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 RETURN added;
END $$;

CREATE FUNCTION claim_customer_reminder(apple_enabled boolean,google_enabled boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
  'templates',(SELECT settings->'wallet' FROM customer_reminder_settings WHERE merchant_id=job.merchant_id),
  'objectKey',(SELECT object_key FROM google_wallet_objects WHERE membership_id=job.membership_id),
  'tokens',coalesce((SELECT jsonb_agg(DISTINCT wr.push_token) FROM wallet_passes w JOIN wallet_registrations wr ON wr.serial=w.serial WHERE w.membership_id=job.membership_id),'[]'))
 INTO result FROM memberships ms JOIN users u ON u.id=ms.user_id WHERE ms.id=job.membership_id;
 RETURN result;
END $$;
CREATE FUNCTION finish_customer_reminder(id_arg uuid,lease_arg uuid,outcome text,error_arg text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF outcome NOT IN ('accepted','retry','failed','skipped','uncertain') THEN RAISE EXCEPTION 'NQ:VALIDATION_FAILED'; END IF;
 UPDATE customer_reminders SET
  status=CASE WHEN outcome='retry' THEN CASE WHEN attempts<5 THEN 'queued' ELSE 'failed' END ELSE outcome END,
  accepted_at=CASE WHEN outcome='accepted' THEN clock_timestamp() ELSE accepted_at END,
  error_code=error_arg,lease_until=NULL,
  next_at=CASE WHEN attempts>=5 AND outcome='uncertain' THEN now()+interval '8 days' ELSE now()+make_interval(mins=>least(60,attempts*5)) END
 WHERE id=id_arg AND lease_id=lease_arg AND status='processing' AND lease_until>now();
END $$;
CREATE FUNCTION reminder_dispatch_allowed(id_arg uuid,lease_arg uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM customer_reminders WHERE id=id_arg AND lease_id=lease_arg AND status='processing'
  AND lease_until>now() AND reminder_eligible(id_arg))
$$;

ALTER FUNCTION wallet_card_json(uuid) RENAME TO wallet_card_base_json;
CREATE FUNCTION wallet_card_json(member_arg uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT wallet_card_base_json(member_arg) || jsonb_build_object('reminder_ar',coalesce(message.ar,''),'reminder_en',coalesce(message.en,''))
 FROM (SELECT 1) singleton LEFT JOIN LATERAL(
  SELECT replace(replace(s.settings->'wallet'->>'ar','{name}',cp.alias),'{business}',m.name) AS ar,
   replace(replace(s.settings->'wallet'->>'en','{name}',cp.alias),'{business}',m.name) AS en
  FROM customer_reminders r JOIN customer_reminder_settings s ON s.merchant_id=r.merchant_id
  JOIN merchants m ON m.id=r.merchant_id JOIN tenant_customer_profiles cp ON cp.id=r.profile_id
  WHERE r.membership_id=member_arg AND r.channel='apple' AND r.status IN ('processing','accepted') AND reminder_eligible(r.id)
  ORDER BY r.created_at DESC LIMIT 1
 ) message ON true
$$;
REVOKE ALL ON FUNCTION reminder_last_purchase(uuid),reminder_eligible(uuid),schedule_customer_reminders(boolean,boolean),
 claim_customer_reminder(boolean,boolean),finish_customer_reminder(uuid,uuid,text,text),reminder_dispatch_allowed(uuid,uuid),wallet_card_json(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION schedule_customer_reminders(boolean,boolean),claim_customer_reminder(boolean,boolean),
 finish_customer_reminder(uuid,uuid,text,text),reminder_dispatch_allowed(uuid,uuid) TO nuqta_worker;
