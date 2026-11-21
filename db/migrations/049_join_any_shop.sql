-- The cashier door at any shop (docs/CUSTOMER-IDENTITY-SCENARIOS.md, phase 3).
-- Before: a number already on Perks could not join a NEW shop from another phone (the new shop's
-- staff could not find the customer, who has no card there), and a phone restored by one shop
-- could never add another shop. Both were dead ends.
--
-- 1. "join" pairings: the customer's phone shows a code and remembers the number they typed. Staff
--    enter that same number and the code. Nothing about the number is revealed before both match.
--    The phone is then linked to the customer for THIS shop only, where a new, empty card starts.
--    No owner approval is needed: there are no stamps or rewards to hand over.
-- 2. A shop-limited phone may add a shop where the customer has no card yet (a new card is empty).
--    It still cannot open a shop where the customer already has a card: that needs that shop's
--    staff (recovery), the Wallet, or WhatsApp.

ALTER TABLE customer_pairings
 ADD COLUMN purpose text NOT NULL DEFAULT 'recover' CHECK(purpose IN ('recover','join')),
 ADD COLUMN claimed_phone text CHECK(claimed_phone IS NULL OR claimed_phone ~ '^\+[1-9][0-9]{7,14}$'),
 ADD CONSTRAINT join_has_phone CHECK(purpose<>'join' OR claimed_phone IS NOT NULL);

-- Scope rows for shops added later have no pairing.
ALTER TABLE customer_device_merchants ALTER COLUMN pairing_id DROP NOT NULL;

-- The device of this transaction's session, next to its scope (used by customer_join_new_shop).
CREATE OR REPLACE FUNCTION apply_customer_device_scope(session_arg uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d customer_devices;scope text;
BEGIN
 SELECT dv.* INTO d FROM sessions s JOIN customer_devices dv ON dv.id=s.customer_device_id AND dv.customer_id=s.user_id
  WHERE s.id=session_arg AND s.user_id=app_user() AND s.auth_method='device';
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:UNAUTHENTICATED';END IF;
 IF d.trust_level='staff_paired' THEN
  SELECT coalesce(string_agg(merchant_id::text,','),'none') INTO scope FROM customer_device_merchants WHERE device_id=d.id;
 ELSE scope:='*';
 END IF;
 PERFORM set_config('app.customer_scope',scope,true);
 PERFORM set_config('app.customer_device',d.id::text,true);
 RETURN scope;
END $$;

-- A shop-limited phone joins a shop where the customer has no card yet; anything else is refused.
CREATE FUNCTION customer_join_new_shop(mid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE did uuid:=nullif(current_setting('app.customer_device',true),'')::uuid;scope text;
BEGIN
 IF did IS NULL OR NOT EXISTS(SELECT 1 FROM customer_devices WHERE id=did AND customer_id=app_user() AND trust_level='staff_paired' AND revoked_at IS NULL)
  OR EXISTS(SELECT 1 FROM memberships WHERE user_id=app_user() AND merchant_id=mid) THEN
  RAISE EXCEPTION 'NQ:DEVICE_SCOPE_RECOVERY_REQUIRED';
 END IF;
 INSERT INTO customer_device_merchants(device_id,merchant_id,pairing_id) VALUES(did,mid,NULL) ON CONFLICT DO NOTHING;
 scope:=coalesce(nullif(current_setting('app.customer_scope',true),''),'none');
 PERFORM set_config('app.customer_scope',CASE WHEN scope='none' THEN mid::text ELSE scope||','||mid::text END,true);
END $$;
REVOKE ALL ON FUNCTION customer_join_new_shop(uuid) FROM PUBLIC;

-- Exact-text patching, as in 020: the migration fails loudly if a body is not what we expect.
CREATE OR REPLACE FUNCTION pg_temp.patch_function(sig regprocedure,old_text text,new_text text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE def text;n integer;
BEGIN
 def:=pg_get_functiondef(sig);
 n:=(length(def)-length(replace(def,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'patch_function %: expected exactly one match, found %',sig,n;END IF;
 EXECUTE replace(def,old_text,new_text);
END $$;

SELECT pg_temp.patch_function('enroll_customer(uuid,uuid,uuid,text,text,uuid,jsonb)',
 'IF NOT customer_scope_ok(mid) THEN RAISE EXCEPTION ''NQ:DEVICE_SCOPE_RECOVERY_REQUIRED'';END IF;',
 'IF NOT customer_scope_ok(mid) THEN PERFORM customer_join_new_shop(mid);END IF;');

-- Registration on the auth pool (typing the same number on a shop-limited phone).
SELECT pg_temp.patch_function('register_customer_device(text,text,text,text,text,uuid,uuid,uuid,uuid,text,text,text,text,text,uuid)',
 'IF bound.trust_level=''staff_paired'' AND NOT EXISTS(SELECT 1 FROM customer_device_merchants WHERE device_id=bound.id AND merchant_id=mid) THEN RAISE EXCEPTION ''NQ:DEVICE_SCOPE_RECOVERY_REQUIRED'';END IF;',
 'IF bound.trust_level=''staff_paired'' AND NOT EXISTS(SELECT 1 FROM customer_device_merchants WHERE device_id=bound.id AND merchant_id=mid) THEN
   IF EXISTS(SELECT 1 FROM memberships WHERE user_id=bound.customer_id AND merchant_id=mid) THEN RAISE EXCEPTION ''NQ:DEVICE_SCOPE_RECOVERY_REQUIRED'';END IF;
   INSERT INTO customer_device_merchants(device_id,merchant_id,pairing_id) VALUES(bound.id,mid,NULL) ON CONFLICT DO NOTHING;
  END IF;');

-- A join pairing is approved by any active staff member of the shop: nothing of value moves.
SELECT pg_temp.patch_function('consume_customer_pairing(uuid,text,text)',
 '  OR NOT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=p.merchant_id AND s.user_id=p.approved_by AND s.status=''active'' AND u.status=''active'' AND s.role IN (''owner'',''manager''))
  OR (p.requested_role=''cashier'' AND NOT (SELECT cashier_recovery_enabled FROM merchants WHERE id=p.merchant_id)) THEN RETURN NULL;END IF;',
 '  OR (p.purpose=''recover'' AND NOT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=p.merchant_id AND s.user_id=p.approved_by AND s.status=''active'' AND u.status=''active'' AND s.role IN (''owner'',''manager'')))
  OR (p.purpose=''recover'' AND p.requested_role=''cashier'' AND NOT (SELECT cashier_recovery_enabled FROM merchants WHERE id=p.merchant_id)) THEN RETURN NULL;END IF;
 -- A join hands over no card: the customer must still have none at this shop.
 IF p.purpose=''join'' AND EXISTS(SELECT 1 FROM memberships WHERE user_id=p.customer_id AND merchant_id=p.merchant_id) THEN RETURN NULL;END IF;');

-- Customer side: start a join pairing that remembers the number the customer typed.
CREATE FUNCTION start_customer_join(mid uuid,device_arg text,code_arg text,phone_arg text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF phone_arg !~ '^\+[1-9][0-9]{7,14}$' THEN RAISE EXCEPTION 'NQ:VALIDATION_FAILED';END IF;
 result:=start_customer_pairing(mid,device_arg,code_arg);
 IF result->>'status'='waiting' THEN
  UPDATE customer_pairings SET purpose='join',claimed_phone=phone_arg WHERE id=(result->>'id')::uuid;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION start_customer_join(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_customer_join(uuid,text,text,text) TO nuqta_auth;

-- Staff side: the number and the code must both match one waiting join pairing at this shop.
-- Any mismatch looks the same ("invalid"), so staff learn nothing about a number by guessing.
CREATE FUNCTION claim_customer_join(mid uuid,bid uuid,phone_arg text,code_arg text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE role_arg text;p customer_pairings;uid uuid;day_start timestamptz;
BEGIN
 role_arg:=customer_recovery_role(mid,bid);
 IF (SELECT status FROM merchants WHERE id=mid) NOT IN ('active','trial') THEN RAISE EXCEPTION 'NQ:MERCHANT_PAUSED';END IF;
 SELECT * INTO p FROM customer_pairings WHERE merchant_id=mid AND code_hash=code_arg AND status='waiting' AND purpose='join'
  AND claimed_phone=phone_arg AND expires_at>clock_timestamp() FOR UPDATE;
 IF FOUND THEN
  SELECT ci.customer_id INTO uid FROM customer_identities ci JOIN users u ON u.id=ci.customer_id
   WHERE ci.phone_e164=phone_arg AND u.status='active' AND u.global_role='customer';
 END IF;
 IF uid IS NULL THEN
  INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail)
   VALUES(app_user(),mid,'customer.pairing.join_code_rejected',NULL,jsonb_build_object('branchId',bid,'staffId',app_user(),'role',role_arg));
  RETURN jsonb_build_object('invalid',true);
 END IF;
 -- Already a customer here: that card is handed over by the normal recovery, not by a join.
 IF EXISTS(SELECT 1 FROM memberships WHERE user_id=uid AND merchant_id=mid) THEN RETURN jsonb_build_object('hasCard',true);END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-recovery:'||uid::text,0));
 day_start:=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
 IF (SELECT count(*) FROM customer_pairings WHERE customer_id=uid AND claimed_at>=day_start)>=10 THEN
  INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail) VALUES(app_user(),mid,'customer.pairing.limit',uid,jsonb_build_object('branchId',bid,'staffId',app_user()));
  RETURN jsonb_build_object('limited',true);
 END IF;
 UPDATE customer_pairings SET customer_id=uid,branch_id=bid,requested_by=app_user(),requested_role=role_arg,
  claimed_at=clock_timestamp(),expires_at=clock_timestamp()+interval '15 minutes',status='approved',
  approved_by=app_user(),decided_by=app_user(),decided_at=clock_timestamp()
  WHERE id=p.id RETURNING * INTO p;
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail)
  VALUES(app_user(),mid,'customer.pairing.join_approved',uid,
   jsonb_build_object('pairingId',p.id,'branchId',bid,'staffId',app_user(),'role',role_arg));
 RETURN jsonb_build_object('id',p.id,'status',p.status);
END $$;
REVOKE ALL ON FUNCTION claim_customer_join(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_customer_join(uuid,uuid,text,text) TO nuqta_runtime;
