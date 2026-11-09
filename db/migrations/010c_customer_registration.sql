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

CREATE FUNCTION register_customer_device(name_arg text,phone_arg text,device_hash text,agent_arg text,locale_arg text,
 mid uuid,pid uuid,version_arg uuid,branch_arg uuid,source_arg text,placement_arg text,terms_hash text,
 privacy_version text,privacy_text text,legacy_user_arg uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE uid uuid;did uuid;bound customer_devices;result jsonb;old_context text;placement jsonb;
BEGIN
 IF phone_arg !~ '^\+[1-9][0-9]{7,14}$' OR device_hash !~ '^[a-f0-9]{64}$' OR length(trim(name_arg)) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'NQ:VALIDATION_FAILED';END IF;
 IF NOT EXISTS(SELECT 1 FROM branches WHERE merchant_id=mid AND id=branch_arg AND status='active') THEN RAISE EXCEPTION 'NQ:PLACEMENT_UNAVAILABLE';END IF;
 IF placement_arg IS NOT NULL THEN
  placement:=resolve_placement(placement_arg);
  IF placement IS NULL OR placement->>'status'<>'active' OR (placement->>'branchId')::uuid<>branch_arg
   OR NOT EXISTS(SELECT 1 FROM merchants WHERE id=mid AND slug=placement->>'slug') THEN RAISE EXCEPTION 'NQ:PLACEMENT_UNAVAILABLE';END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('device-register:'||device_hash,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-phone:'||phone_arg,0));
 SELECT * INTO bound FROM customer_devices WHERE token_hash=device_hash FOR UPDATE;
 IF FOUND THEN
  IF bound.revoked_at IS NOT NULL OR bound.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM users WHERE id=bound.customer_id AND status='active') THEN RAISE EXCEPTION 'NQ:CUSTOMER_DEVICE_REVOKED';END IF;
  IF NOT EXISTS(SELECT 1 FROM customer_identities WHERE customer_id=bound.customer_id AND phone_e164=phone_arg) THEN RAISE EXCEPTION 'NQ:DEVICE_ALREADY_BOUND';END IF;
  uid:=bound.customer_id;did:=bound.id;
 ELSE
  IF EXISTS(SELECT 1 FROM customer_identities WHERE phone_e164=phone_arg AND customer_id IS DISTINCT FROM legacy_user_arg) THEN RETURN jsonb_build_object('phoneExists',true);END IF;
  IF legacy_user_arg IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM users WHERE id=legacy_user_arg AND global_role='customer' AND status='active') OR EXISTS(SELECT 1 FROM staff_memberships WHERE user_id=legacy_user_arg) THEN RAISE EXCEPTION 'NQ:DEVICE_ALREADY_BOUND';END IF;
   IF EXISTS(SELECT 1 FROM customer_identities WHERE customer_id=legacy_user_arg AND phone_e164 IS NOT NULL AND phone_e164<>phone_arg) THEN RAISE EXCEPTION 'NQ:DEVICE_ALREADY_BOUND';END IF;
   uid:=legacy_user_arg;
  ELSE INSERT INTO users(email,display_name,preferred_locale) VALUES(NULL,trim(name_arg),locale_arg) RETURNING id INTO uid;
  END IF;
  INSERT INTO customer_identities(customer_id,phone_e164,phone_normalized) VALUES(uid,phone_arg,phone_arg)
   ON CONFLICT(customer_id) DO UPDATE SET phone_e164=EXCLUDED.phone_e164,phone_normalized=EXCLUDED.phone_normalized,legacy=false;
  INSERT INTO customer_devices(customer_id,token_hash,user_agent_family) VALUES(uid,device_hash,agent_arg) RETURNING id INTO did;
 END IF;
 old_context:=current_setting('app.user_id',true);
 PERFORM set_config('app.user_id',uid::text,true);
 -- A response lost after commit resumes the existing membership on this device.
 SELECT jsonb_build_object('membershipId',id,'alreadyMember',true) INTO result FROM memberships WHERE user_id=uid AND merchant_id=mid AND program_id=pid;
 IF result IS NULL THEN result:=enroll_customer_with_terms(mid,pid,version_arg,trim(name_arg),source_arg,branch_arg,'{"email":false,"sms":false,"whatsapp":false}'::jsonb,terms_hash);END IF;
 PERFORM set_customer_contact_phone(mid,phone_arg,true);
 IF NOT EXISTS(SELECT 1 FROM customer_privacy_acceptances WHERE customer_id=uid) THEN
  INSERT INTO customer_privacy_acceptances(customer_id,device_id,version,text_hash,terms_text)
   VALUES(uid,did,privacy_version,encode(sha256(convert_to(privacy_text,'UTF8')),'hex'),privacy_text);
 END IF;
 PERFORM set_config('app.user_id',coalesce(old_context,''),true);
 RETURN result||jsonb_build_object('userId',uid,'phoneExists',false);
END $$;
REVOKE ALL ON FUNCTION register_customer_device(text,text,text,text,text,uuid,uuid,uuid,uuid,text,text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_customer_device(text,text,text,text,text,uuid,uuid,uuid,uuid,text,text,text,text,text,uuid) TO nuqta_auth;

-- A revoked device invalidates both the holder token and a derived cashier proof.
CREATE OR REPLACE FUNCTION valid_customer_presentation(proof_arg uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM presentation_tokens p
 JOIN presentation_tokens original ON original.id=coalesce(p.source_presentation_id,p.id) AND original.merchant_id=p.merchant_id AND original.membership_id=p.membership_id
 JOIN memberships m ON m.id=original.membership_id AND m.merchant_id=original.merchant_id
 JOIN sessions s ON s.id=original.session_id AND s.user_id=original.created_by JOIN users u ON u.id=s.user_id
 WHERE p.id=proof_arg AND member_access(p.membership_id)
 AND p.purpose IN ('customer_presentation','cashier_scan') AND original.purpose='customer_presentation'
 AND original.created_by=m.user_id AND m.status='active' AND u.status='active'
 AND p.expires_at>clock_timestamp() AND original.expires_at>clock_timestamp()
 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.credential_version=u.password_version
 AND (s.auth_method<>'device' OR customer_device_active(s.customer_device_id,s.user_id)))
$$;
