-- Customer recovery revokes customer credentials, while preserving explicit team sessions.
CREATE OR REPLACE FUNCTION consume_customer_recovery(hash_arg text,device_hash text,agent_arg text,revoke_old boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
  UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=r.customer_id AND revoked_at IS NULL AND (auth_method='device' OR portal IS NULL OR portal='customer');
 END IF;
 INSERT INTO customer_devices(customer_id,token_hash,user_agent_family) VALUES(r.customer_id,device_hash,agent_arg)
 ON CONFLICT(token_hash) DO UPDATE SET revoked_at=NULL,last_seen_at=clock_timestamp(),expires_at=clock_timestamp()+interval '365 days',user_agent_family=EXCLUDED.user_agent_family;
 UPDATE customer_recoveries SET used_at=clock_timestamp() WHERE id=r.id;
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail)
  VALUES(r.customer_id,r.merchant_id,'customer.recovery.consumed',r.customer_id,jsonb_build_object('recoveryId',r.id,'revokedOldDevices',revoke_old));
 RETURN jsonb_build_object('membershipId',membership);
END $$;
