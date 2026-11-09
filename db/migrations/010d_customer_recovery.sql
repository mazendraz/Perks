CREATE FUNCTION customer_recovery_role(mid uuid,bid uuid) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE role_arg text;
BEGIN
 SELECT s.role INTO role_arg FROM staff_memberships s JOIN users u ON u.id=s.user_id
 JOIN staff_branch_grants g ON g.staff_id=s.id AND g.merchant_id=s.merchant_id
 JOIN branches b ON b.id=g.branch_id AND b.merchant_id=s.merchant_id
 WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.status='active' AND u.status='active' AND b.id=bid AND b.status='active';
 IF role_arg IS NULL THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 RETURN role_arg;
END $$;
CREATE FUNCTION lookup_customer_phone(mid uuid,bid uuid,phone_arg text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM customer_recovery_role(mid,bid);
 SELECT jsonb_build_object('customerId',ci.customer_id,'profileId',cp.id,'name',cp.alias,'phone',mask_customer_phone(ci.phone_e164),
 'cards',(SELECT jsonb_agg(jsonb_build_object('membershipId',ms.id,'programName',p.name,'balance',a.balance,'threshold',v.threshold))
 FROM memberships ms JOIN programs p ON p.id=ms.program_id JOIN program_versions v ON v.id=ms.program_version_id JOIN loyalty_accounts a ON a.membership_id=ms.id
 WHERE ms.profile_id=cp.id AND ms.status='active' AND EXISTS(SELECT 1 FROM program_branches pb WHERE pb.program_version_id=ms.program_version_id AND pb.branch_id=bid)
 AND (owner_full_customer_scope(mid) OR ms.origin_branch_id=bid OR EXISTS(SELECT 1 FROM loyalty_transactions t WHERE t.membership_id=ms.id AND t.branch_id=bid)))) INTO result
 FROM customer_identities ci JOIN users u ON u.id=ci.customer_id JOIN tenant_customer_profiles cp ON cp.user_id=ci.customer_id
 WHERE ci.phone_e164=phone_arg AND u.status='active' AND cp.merchant_id=mid;
 IF result->'cards' IS NULL OR result->'cards'='null'::jsonb THEN RETURN NULL;END IF;
 RETURN result;
END $$;
CREATE FUNCTION create_customer_recovery(mid uuid,bid uuid,uid uuid,hash_arg text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE role_arg text;target jsonb;phone text;existing customer_recoveries;new_row customer_recoveries;day_start timestamptz;
BEGIN
 role_arg:=customer_recovery_role(mid,bid);
 IF role_arg='cashier' AND NOT (SELECT cashier_recovery_enabled FROM merchants WHERE id=mid) THEN RAISE EXCEPTION 'NQ:CASHIER_RECOVERY_DISABLED';END IF;
 SELECT phone_e164 INTO phone FROM customer_identities WHERE customer_id=uid;
 target:=lookup_customer_phone(mid,bid,phone);
 IF target IS NULL OR (target->>'customerId')::uuid IS DISTINCT FROM uid THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-recovery:'||uid::text,0));
 SELECT * INTO existing FROM customer_recoveries WHERE token_hash=hash_arg;
 IF FOUND THEN
  IF existing.customer_id<>uid OR existing.merchant_id<>mid OR existing.branch_id<>bid OR existing.created_by<>app_user() THEN RAISE EXCEPTION 'NQ:IDEMPOTENCY_CONFLICT';END IF;
  IF existing.used_at IS NOT NULL OR existing.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'NQ:RECOVERY_LINK_INVALID';END IF;
  new_row:=existing;
 ELSE
  day_start:=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  IF (SELECT count(*) FROM customer_recoveries WHERE customer_id=uid AND created_at>=day_start)>=10 THEN
   INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail) VALUES(app_user(),mid,'customer.recovery.limit',uid,jsonb_build_object('branchId',bid));
   RETURN jsonb_build_object('limited',true);
  END IF;
  INSERT INTO customer_recoveries(customer_id,merchant_id,branch_id,profile_id,token_hash,created_by)
   VALUES(uid,mid,bid,(target->>'profileId')::uuid,hash_arg,app_user()) RETURNING * INTO new_row;
  INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail)
   VALUES(app_user(),mid,'customer.recovery.requested',uid,jsonb_build_object('branchId',bid,'recoveryId',new_row.id,'mode','manual_whatsapp','purpose','requested_by_customer'));
 END IF;
 RETURN jsonb_build_object('id',new_row.id,'expiresAt',new_row.expires_at,'phone',phone,'name',target->>'name','merchantName',(SELECT name FROM merchants WHERE id=mid));
END $$;
CREATE FUNCTION customer_recovery_preview(hash_arg text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('merchantName',m.name,'merchantId',m.id,'valid',true) FROM customer_recoveries r JOIN merchants m ON m.id=r.merchant_id JOIN users u ON u.id=r.customer_id
 WHERE r.token_hash=hash_arg AND r.used_at IS NULL AND r.expires_at>clock_timestamp() AND u.status='active'
$$;
CREATE FUNCTION consume_customer_recovery(hash_arg text,device_hash text,agent_arg text,revoke_old boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r customer_recoveries;d customer_devices;phone text;target jsonb;old_context text;membership uuid;
BEGIN
 SELECT * INTO r FROM customer_recoveries WHERE token_hash=hash_arg FOR UPDATE;
 IF NOT FOUND OR r.used_at IS NOT NULL OR r.expires_at<=clock_timestamp() THEN RETURN NULL;END IF;
 SELECT phone_e164 INTO phone FROM customer_identities WHERE customer_id=r.customer_id FOR UPDATE;
 old_context:=current_setting('app.user_id',true);
 PERFORM set_config('app.user_id',r.created_by::text,true);
 BEGIN
  IF customer_recovery_role(r.merchant_id,r.branch_id)='cashier' AND NOT (SELECT cashier_recovery_enabled FROM merchants WHERE id=r.merchant_id) THEN
   PERFORM set_config('app.user_id',coalesce(old_context,''),true);RETURN NULL;
  END IF;
  target:=lookup_customer_phone(r.merchant_id,r.branch_id,phone);
 EXCEPTION WHEN raise_exception THEN PERFORM set_config('app.user_id',coalesce(old_context,''),true);RETURN NULL;
 END;
 PERFORM set_config('app.user_id',coalesce(old_context,''),true);
 IF target IS NULL OR target->>'customerId'<>r.customer_id::text THEN RETURN NULL;END IF;
 membership:=(target->'cards'->0->>'membershipId')::uuid;
 SELECT * INTO d FROM customer_devices WHERE token_hash=device_hash FOR UPDATE;
 IF FOUND AND d.customer_id<>r.customer_id THEN RETURN jsonb_build_object('deviceConflict',true);END IF;
 IF revoke_old THEN
  UPDATE customer_devices SET revoked_at=clock_timestamp() WHERE customer_id=r.customer_id AND revoked_at IS NULL;
  UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=r.customer_id AND revoked_at IS NULL;
 END IF;
 INSERT INTO customer_devices(customer_id,token_hash,user_agent_family) VALUES(r.customer_id,device_hash,agent_arg)
 ON CONFLICT(token_hash) DO UPDATE SET revoked_at=NULL,last_seen_at=clock_timestamp(),expires_at=clock_timestamp()+interval '365 days',user_agent_family=EXCLUDED.user_agent_family;
 UPDATE customer_recoveries SET used_at=clock_timestamp() WHERE id=r.id;
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail)
  VALUES(r.customer_id,r.merchant_id,'customer.recovery.consumed',r.customer_id,jsonb_build_object('recoveryId',r.id,'revokedOldDevices',revoke_old));
 RETURN jsonb_build_object('membershipId',membership);
END $$;
REVOKE ALL ON FUNCTION customer_recovery_role(uuid,uuid),lookup_customer_phone(uuid,uuid,text),create_customer_recovery(uuid,uuid,uuid,text),customer_recovery_preview(text),consume_customer_recovery(text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION customer_recovery_role(uuid,uuid),lookup_customer_phone(uuid,uuid,text),create_customer_recovery(uuid,uuid,uuid,text) TO nuqta_runtime;
GRANT EXECUTE ON FUNCTION customer_recovery_preview(text),consume_customer_recovery(text,text,text,boolean) TO nuqta_auth;

CREATE FUNCTION set_customer_recovery_policy(mid uuid,revision_arg integer,enabled_arg boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE merchant merchants;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.status='active' AND s.role='owner' AND u.status='active') THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 SELECT * INTO merchant FROM merchants WHERE id=mid FOR UPDATE;
 IF merchant.revision<>revision_arg THEN RAISE EXCEPTION 'NQ:REVISION_CONFLICT';END IF;
 UPDATE merchants SET cashier_recovery_enabled=enabled_arg,revision=revision+1 WHERE id=mid RETURNING * INTO merchant;
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail) VALUES(app_user(),mid,'customer.recovery.policy',mid,jsonb_build_object('cashierEnabled',enabled_arg));
 RETURN jsonb_build_object('cashierEnabled',merchant.cashier_recovery_enabled,'revision',merchant.revision);
END $$;
REVOKE ALL ON FUNCTION set_customer_recovery_policy(uuid,integer,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_customer_recovery_policy(uuid,integer,boolean) TO nuqta_runtime;

CREATE OR REPLACE FUNCTION customer_contact_state(mid uuid,profile_arg uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cp tenant_customer_profiles;consented boolean;rev integer;
BEGIN
 SELECT * INTO cp FROM tenant_customer_profiles WHERE merchant_id=mid AND id=profile_arg;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF NOT is_platform_admin() AND cp.user_id<>app_user() AND NOT EXISTS(SELECT 1 FROM customer_directory(mid,NULL,'all',profile_arg,1,0)) THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 SELECT granted,revision INTO consented,rev FROM consent_current WHERE merchant_id=mid AND user_id=cp.user_id AND channel='whatsapp';
 RETURN jsonb_build_object('contactPhone',CASE WHEN cp.user_id=app_user() THEN cp.contact_phone WHEN coalesce(consented,false) THEN mask_customer_phone(cp.contact_phone) ELSE '' END,'phonePresent',cp.contact_phone<>'','whatsappConsent',coalesce(consented,false),'revision',rev);
END $$;
