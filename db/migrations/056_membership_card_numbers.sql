-- The number is a credential. Keep it out of the membership table and grant access only through
-- the owner, staff reveal, authentication and Google Wallet functions below.
CREATE TABLE membership_card_numbers (
 membership_id uuid PRIMARY KEY REFERENCES memberships(id) ON DELETE CASCADE,
 card_number text NOT NULL UNIQUE CHECK(card_number ~ '^[0-9]{6}$')
);
ALTER TABLE membership_card_numbers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON membership_card_numbers FROM PUBLIC;

CREATE FUNCTION assign_membership_card_number(member_arg uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE candidate integer;
BEGIN
 FOR attempt IN 1..128 LOOP
  -- A random UUID has 20 uniformly random bits at the start. Reject the unused range.
  candidate:=('x'||left(gen_random_uuid()::text,5))::bit(20)::integer;
  CONTINUE WHEN candidate>=1000000;
  INSERT INTO membership_card_numbers(membership_id,card_number)
   VALUES(member_arg,lpad(candidate::text,6,'0')) ON CONFLICT DO NOTHING;
  IF FOUND OR EXISTS(SELECT 1 FROM membership_card_numbers WHERE membership_id=member_arg) THEN RETURN;END IF;
 END LOOP;
 RAISE EXCEPTION 'Card number allocation failed';
END $$;
REVOKE ALL ON FUNCTION assign_membership_card_number(uuid) FROM PUBLIC;

CREATE FUNCTION number_new_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM assign_membership_card_number(NEW.id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION number_new_membership() FROM PUBLIC;
CREATE TRIGGER number_new_membership AFTER INSERT ON memberships
 FOR EACH ROW EXECUTE FUNCTION number_new_membership();
SELECT assign_membership_card_number(id) FROM memberships ORDER BY id;

CREATE OR REPLACE FUNCTION my_cards() RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT c || jsonb_build_object('logo_mark_position',m.logo_mark_position,
  'logo_mark_bleed',m.logo_mark_bleed,'card_number',n.card_number)
 FROM my_cards_core() c JOIN merchants m ON m.id=(c->>'merchant_id')::uuid
 LEFT JOIN membership_card_numbers n ON n.membership_id=(c->>'id')::uuid AND c->>'status'='active'
 WHERE customer_scope_ok(m.id)
$$;

CREATE FUNCTION reveal_membership_card_number(mid uuid,bid uuid,phone_arg text,member_arg uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE found_customer jsonb; number_value text;
BEGIN
 IF customer_recovery_role(mid,bid)='cashier' AND NOT (SELECT cashier_recovery_enabled FROM merchants WHERE id=mid) THEN
  RAISE EXCEPTION 'NQ:CASHIER_RECOVERY_DISABLED';
 END IF;
 found_customer:=lookup_customer_phone(mid,bid,phone_arg);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(found_customer->'cards') c WHERE c->>'membershipId'=member_arg::text) THEN
  RETURN NULL;
 END IF;
 SELECT card_number INTO number_value FROM membership_card_numbers WHERE membership_id=member_arg;
 IF number_value IS NOT NULL THEN
  INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail)
   VALUES(app_user(),mid,'customer.card_number.revealed',member_arg,jsonb_build_object('branchId',bid));
 END IF;
 RETURN number_value;
END $$;
REVOKE ALL ON FUNCTION reveal_membership_card_number(uuid,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reveal_membership_card_number(uuid,uuid,text,uuid) TO nuqta_runtime;

ALTER TABLE customer_devices DROP CONSTRAINT customer_devices_trust_level_check;
ALTER TABLE customer_devices ADD CONSTRAINT customer_devices_trust_level_check
 CHECK(trust_level IN ('self_registered','staff_paired','otp_verified','wallet_verified','card_number'));
ALTER TABLE customer_device_notices DROP CONSTRAINT customer_device_notices_kind_check;
ALTER TABLE customer_device_notices ADD CONSTRAINT customer_device_notices_kind_check
 CHECK(kind IN ('device_paired','wallet_restored','phone_verified','card_number_login'));

CREATE FUNCTION claim_membership_card_number(number_arg text,device_arg text,agent_arg text,budget_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE member_row memberships; device_row customer_devices; added boolean:=false;
BEGIN
 -- Serialize the shared failed-attempt budget across API processes, even for rotating IPs.
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-card-number-budget',0));
 IF EXISTS(SELECT 1 FROM customer_auth_limits WHERE key_hash=budget_key AND attempts>=30
  AND window_started_at>clock_timestamp()-interval '15 minutes') THEN
  RETURN jsonb_build_object('limited',true);
 END IF;

 SELECT m.* INTO member_row FROM membership_card_numbers n JOIN memberships m ON m.id=n.membership_id
 WHERE n.card_number=number_arg;
 IF FOUND THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('customer-lifecycle:'||member_row.user_id::text,0));
  SELECT m.* INTO member_row FROM membership_card_numbers n JOIN memberships m ON m.id=n.membership_id
  JOIN users u ON u.id=m.user_id
  WHERE n.card_number=number_arg AND m.status='active' AND u.status='active' AND u.global_role='customer';
 END IF;
 IF member_row.id IS NULL THEN
  INSERT INTO customer_auth_limits(key_hash) VALUES(budget_key)
  ON CONFLICT(key_hash) DO UPDATE SET
   attempts=CASE WHEN customer_auth_limits.window_started_at<=clock_timestamp()-interval '15 minutes' THEN 1 ELSE customer_auth_limits.attempts+1 END,
   window_started_at=CASE WHEN customer_auth_limits.window_started_at<=clock_timestamp()-interval '15 minutes' THEN clock_timestamp() ELSE customer_auth_limits.window_started_at END;
  RETURN NULL;
 END IF;

 SELECT * INTO device_row FROM customer_devices WHERE token_hash=device_arg FOR UPDATE;
 IF NOT FOUND THEN
  -- Pre-device email enrollments can have a card before they have a customer identity.
  INSERT INTO customer_identities(customer_id,legacy) VALUES(member_row.user_id,true)
   ON CONFLICT(customer_id) DO NOTHING;
  INSERT INTO customer_devices(customer_id,token_hash,user_agent_family,trust_level)
   VALUES(member_row.user_id,device_arg,agent_arg,'card_number') ON CONFLICT(token_hash) DO NOTHING
   RETURNING * INTO device_row;
  IF NOT FOUND THEN RETURN NULL;END IF;
  INSERT INTO customer_device_merchants(device_id,merchant_id) VALUES(device_row.id,member_row.merchant_id);
  added:=true;
 ELSIF device_row.customer_id<>member_row.user_id OR device_row.trust_level<>'card_number'
  OR device_row.revoked_at IS NOT NULL OR device_row.expires_at<=clock_timestamp()
  OR NOT EXISTS(SELECT 1 FROM customer_device_merchants WHERE device_id=device_row.id AND merchant_id=member_row.merchant_id) THEN
  RETURN NULL;
 END IF;

 IF added THEN
  INSERT INTO customer_device_notices(customer_id,device_id,kind,merchant_id,paired_device_id)
   SELECT member_row.user_id,d.id,'card_number_login',member_row.merchant_id,device_row.id FROM customer_devices d
   WHERE d.customer_id=member_row.user_id AND d.id<>device_row.id AND d.revoked_at IS NULL
    AND d.expires_at>clock_timestamp() AND d.trust_level NOT IN ('staff_paired','card_number');
  INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail)
   VALUES(member_row.user_id,member_row.merchant_id,'customer.card_number.signed_in',
    member_row.id,jsonb_build_object('deviceId',device_row.id));
 END IF;
 RETURN jsonb_build_object('membershipId',member_row.id);
END $$;
REVOKE ALL ON FUNCTION claim_membership_card_number(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_membership_card_number(text,text,text,text) TO nuqta_auth;

-- Reuse the staff-paired scope rules, while allowing a genuine Wallet or WhatsApp proof
-- to unlock the account as before. Enrollment cannot extend a card-number device's scope.
CREATE FUNCTION pg_temp.patch_card_number_function(sig regprocedure, old_text text, new_text text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE def text:=pg_get_functiondef(sig);
BEGIN
 IF (length(def)-length(replace(def,old_text,'')))/length(old_text)<>1 THEN
  RAISE EXCEPTION 'card number migration expected one match in %',sig;
 END IF;
 EXECUTE replace(def,old_text,new_text);
END $$;

SELECT pg_temp.patch_card_number_function('apply_customer_device_scope(uuid)',
 'd.trust_level=''staff_paired''','d.trust_level IN (''staff_paired'',''card_number'')');
SELECT pg_temp.patch_card_number_function('register_customer_device(text,text,text,text,text,uuid,uuid,uuid,uuid,text,text,text,text,text,uuid)',
 'IF bound.trust_level=''staff_paired'' AND NOT EXISTS',
 'IF bound.trust_level=''card_number'' AND NOT EXISTS(SELECT 1 FROM customer_device_merchants WHERE device_id=bound.id AND merchant_id=mid) THEN
   RAISE EXCEPTION ''NQ:DEVICE_SCOPE_RECOVERY_REQUIRED'';
  END IF;
  IF bound.trust_level=''staff_paired'' AND NOT EXISTS');
SELECT pg_temp.patch_card_number_function('my_device_notices(uuid)',
 'me.trust_level<>''staff_paired''','me.trust_level NOT IN (''staff_paired'',''card_number'')');
SELECT pg_temp.patch_card_number_function('my_device_notices(uuid)',
 'n.dismissed_at IS NULL','n.dismissed_at IS NULL AND (me.trust_level<>''card_number'' OR customer_scope_ok(n.merchant_id))');
SELECT pg_temp.patch_card_number_function('resolve_device_notice(uuid,uuid,boolean)',
 'me.trust_level=''staff_paired''','me.trust_level IN (''staff_paired'',''card_number'')');
SELECT pg_temp.patch_card_number_function('consume_wallet_restore(uuid,integer,text,text)',
 'd.trust_level<>''staff_paired''','d.trust_level NOT IN (''staff_paired'',''card_number'')');
SELECT pg_temp.patch_card_number_function('consume_wallet_restore(uuid,integer,text,text)',
 'CASE WHEN trust_level=''staff_paired'' THEN','CASE WHEN trust_level IN (''staff_paired'',''card_number'') THEN');
SELECT pg_temp.patch_card_number_function('customer_whatsapp_account(text,uuid)',
 'd.trust_level<>''staff_paired''','d.trust_level NOT IN (''staff_paired'',''card_number'')');
SELECT pg_temp.patch_card_number_function('finish_customer_whatsapp_proof(text,text,text,text,uuid,text)',
 'OR d.trust_level=''staff_paired'';','OR d.trust_level IN (''staff_paired'',''card_number'');');

-- Google gets the number in the private pass payload and fingerprint. Its public artwork
-- endpoint and Apple pass keep using the unchanged wallet_card_json function.
CREATE FUNCTION google_wallet_card_json(member_arg uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT c || CASE WHEN (c->>'active')::boolean THEN jsonb_build_object('card_number',n.card_number)
  ELSE '{}'::jsonb END
 FROM wallet_card_json(member_arg) c LEFT JOIN membership_card_numbers n ON n.membership_id=member_arg
$$;
REVOKE ALL ON FUNCTION google_wallet_card_json(uuid) FROM PUBLIC;

SELECT pg_temp.patch_card_number_function('google_wallet_issue(uuid,uuid)',
 'card:=wallet_card_json(member_arg)','card:=google_wallet_card_json(member_arg)');
SELECT pg_temp.patch_card_number_function('google_wallet_claim_changes()',
 'wallet_card_json(g.membership_id)','google_wallet_card_json(g.membership_id)');
