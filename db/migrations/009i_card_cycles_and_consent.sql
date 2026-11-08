-- Preserve immutable consent history; append a correction from authoritative preferences.
LOCK TABLE consent_current,consent_events IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO consent_events(merchant_id,user_id,channel,granted,text_version)
 SELECT c.merchant_id,c.user_id,c.channel,c.granted,'reconciled-current-v1'
 FROM consent_current c LEFT JOIN LATERAL (SELECT granted FROM consent_events e WHERE e.merchant_id=c.merchant_id AND e.user_id=c.user_id AND e.channel=c.channel ORDER BY created_at DESC,id DESC LIMIT 1) e ON true
 WHERE e.granted IS DISTINCT FROM c.granted;
CREATE OR REPLACE FUNCTION enroll_customer(mid uuid,pid uuid,version_arg uuid,alias_arg text,source_arg text,branch_arg uuid,consents_arg jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE account users; merchant merchants; prog programs; ver program_versions; profile uuid; existing memberships; membership uuid; limits feature_entitlements; ch text; accept_text text;
BEGIN
 SELECT * INTO account FROM users WHERE id=app_user() AND status='active';IF NOT FOUND THEN RAISE EXCEPTION 'NQ:UNAUTHENTICATED';END IF;
 SELECT * INTO merchant FROM merchants WHERE id=mid FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF merchant.status='suspended' THEN RAISE EXCEPTION 'NQ:MERCHANT_PAUSED';END IF;
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
  IF (SELECT count(*) FROM tenant_customer_profiles WHERE merchant_id=mid)>=limits.max_customers THEN RAISE EXCEPTION 'NQ:PLAN_LIMIT';END IF;
  INSERT INTO tenant_customer_profiles(merchant_id,user_id,alias,contact_email) VALUES(mid,account.id,alias_arg,account.email) RETURNING id INTO profile;
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

ALTER TABLE loyalty_accounts ADD COLUMN cycle_number integer NOT NULL DEFAULT 1 CHECK(cycle_number>=1), ADD COLUMN cycle_renewed_at timestamptz;
UPDATE loyalty_accounts a SET cycle_number=1+(SELECT count(*)::int FROM reward_redemptions rd JOIN reward_grants r ON r.id=rd.reward_id WHERE r.membership_id=a.membership_id),cycle_renewed_at=(SELECT max(r.redeemed_at) FROM reward_grants r WHERE r.membership_id=a.membership_id);
CREATE OR REPLACE FUNCTION my_cards() RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',ms.id,'merchant_id',m.id,'merchant_slug',m.slug,'merchant_name',m.name,'alias',cp.alias,'program_id',p.id,'program_version_id',v.id,'program_version',v.version,'program_name',p.name,'threshold',v.threshold,'balance',a.balance,'cycle_number',a.cycle_number,'cycle_renewed_at',a.cycle_renewed_at,'pending_rewards',(SELECT count(*)::int FROM reward_grants r WHERE r.membership_id=ms.id AND r.status='available' AND r.expires_at>now()),'display_balance',CASE WHEN EXISTS(SELECT 1 FROM reward_grants r WHERE r.membership_id=ms.id AND r.status='available' AND r.expires_at>now()) THEN v.threshold ELSE a.balance END,'revision',a.revision,'primary_color',m.primary_color,'accent_color',m.accent_color,'surface_color',m.surface_color,'template',m.template,'reward_title',v.reward_title,'reward_terms',v.reward_terms,'status',ms.status,'merchant_status',m.status,'earning_active',p.status='active' AND m.status<>'suspended' AND (v.ends_at IS NULL OR v.ends_at>now()),'joined_at',ms.joined_at)
 FROM memberships ms JOIN tenant_customer_profiles cp ON cp.id=ms.profile_id JOIN merchants m ON m.id=ms.merchant_id JOIN programs p ON p.id=ms.program_id JOIN program_versions v ON v.id=ms.program_version_id JOIN loyalty_accounts a ON a.membership_id=ms.id
 WHERE ms.user_id=app_user() ORDER BY ms.joined_at DESC
$$;
