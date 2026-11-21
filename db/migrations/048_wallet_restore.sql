-- The Wallet door (docs/CUSTOMER-IDENTITY-SCENARIOS.md, phase 2).
-- A pass in the customer's Apple or Google Wallet follows their Apple ID / Google account to a new
-- phone. Its "Open your card" link now carries a key (an HMAC the API derives from the card and a
-- generation number), so tapping it on a new phone brings back every card of that customer.
-- The key is never stored. Using it moves the card to the next generation: the pass is updated by
-- the usual change detection (wallet_card_json changes), the old link stops working, and every
-- other device of the customer is told.

CREATE TABLE wallet_restore_keys (
 membership_id uuid PRIMARY KEY REFERENCES memberships(id) ON DELETE CASCADE,
 generation integer NOT NULL DEFAULT 1 CHECK(generation>=1),
 used_at timestamptz
);
ALTER TABLE wallet_restore_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wallet_restore_keys FROM PUBLIC;

-- A device that came back through the Wallet is trusted like the customer's own: all cards.
ALTER TABLE customer_devices DROP CONSTRAINT customer_devices_trust_level_check;
ALTER TABLE customer_devices ADD CONSTRAINT customer_devices_trust_level_check
 CHECK(trust_level IN ('self_registered','staff_paired','otp_verified','wallet_verified'));

-- Other devices are told about a Wallet restore the same way as about a staff pairing.
ALTER TABLE customer_device_notices DROP CONSTRAINT customer_device_notices_kind_check;
ALTER TABLE customer_device_notices ADD CONSTRAINT customer_device_notices_kind_check
 CHECK(kind IN ('device_paired','wallet_restored'));
ALTER TABLE customer_device_notices ALTER COLUMN pairing_id DROP NOT NULL;

-- Same card as 030, plus the generation of its restore key (so a rotation updates the pass).
CREATE OR REPLACE FUNCTION wallet_card_json(member_arg uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT wallet_card_base_json(member_arg)
  || jsonb_build_object('reminder_templates',CASE WHEN manual.at IS NULL OR reminder.at>manual.at THEN reminder.templates END)
  || CASE WHEN manual.at IS NOT NULL AND (reminder.at IS NULL OR manual.at>=reminder.at)
     THEN jsonb_build_object('manual_message',manual.message) ELSE '{}'::jsonb END
  || jsonb_build_object('restore_generation',coalesce((SELECT k.generation FROM wallet_restore_keys k WHERE k.membership_id=member_arg),1))
 FROM (SELECT 1) singleton LEFT JOIN LATERAL(
  SELECT jsonb_build_object('wallet',s.settings->'wallet','walletReady',s.settings->'walletReady') AS templates,r.created_at AS at
  FROM customer_reminders r JOIN customer_reminder_settings s ON s.merchant_id=r.merchant_id
  WHERE r.membership_id=member_arg AND r.channel='apple' AND r.status IN ('processing','accepted') AND reminder_eligible(r.id)
  ORDER BY r.created_at DESC LIMIT 1
 ) reminder ON true LEFT JOIN LATERAL(
  SELECT jsonb_build_object('id',d.id,'ar',wm.body_ar,'en',coalesce(wm.body_en,wm.body_ar)) AS message,d.created_at AS at
  FROM wallet_message_deliveries d JOIN wallet_messages wm ON wm.id=d.message_id
  WHERE d.membership_id=member_arg AND d.channel='apple' AND d.status IN ('processing','accepted') AND wallet_message_eligible(d.id)
  ORDER BY d.created_at DESC LIMIT 1
 ) manual ON true
$$;

-- Called with a key the API has already checked (HMAC). Binds this browser to the card's owner,
-- rotates the key and tells the other devices. Returns NULL when the key is not the current one.
CREATE FUNCTION consume_wallet_restore(member_arg uuid,generation_arg integer,device_arg text,agent_arg text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ms memberships;current_gen integer;d customer_devices;known boolean;added boolean:=false;
BEGIN
 IF device_arg !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'NQ:VALIDATION_FAILED';END IF;
 SELECT m.* INTO ms FROM memberships m JOIN users u ON u.id=m.user_id
  WHERE m.id=member_arg AND m.status='active' AND u.status='active' AND u.global_role='customer';
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM customer_identities WHERE customer_id=ms.user_id) THEN RETURN NULL;END IF;
 SELECT * INTO d FROM customer_devices WHERE token_hash=device_arg FOR UPDATE;
 known:=FOUND;  -- FOUND changes with every later statement.
 -- The everyday case: the customer opens the card from Wallet on the phone that already holds it.
 -- Nothing changes, nothing rotates and nobody is alerted, whatever generation the pass shows.
 IF known AND d.customer_id=ms.user_id AND d.revoked_at IS NULL AND d.expires_at>clock_timestamp()
  AND d.trust_level<>'staff_paired' THEN
  RETURN jsonb_build_object('membershipId',member_arg,'customerId',ms.user_id,'alreadyHere',true);
 END IF;
 INSERT INTO wallet_restore_keys(membership_id) VALUES(member_arg) ON CONFLICT DO NOTHING;
 SELECT generation INTO current_gen FROM wallet_restore_keys WHERE membership_id=member_arg FOR UPDATE;
 IF current_gen<>generation_arg THEN RETURN NULL;END IF;
 IF known AND d.customer_id<>ms.user_id AND d.revoked_at IS NULL AND d.expires_at>clock_timestamp() THEN
  RETURN jsonb_build_object('deviceConflict',true);
 END IF;
 IF known AND d.customer_id<>ms.user_id THEN
  -- A stale link to someone else on this browser: it is replaced by this customer's.
  DELETE FROM customer_device_merchants WHERE device_id=d.id;
  UPDATE customer_devices SET customer_id=ms.user_id,revoked_at=NULL,trust_level='wallet_verified',last_seen_at=clock_timestamp(),
   expires_at=clock_timestamp()+interval '365 days',user_agent_family=agent_arg WHERE id=d.id RETURNING * INTO d;
  added:=true;
 ELSIF known THEN
  -- Revoked, expired or shop-limited: brought back with all of the customer's cards.
  added:=true;
  DELETE FROM customer_device_merchants WHERE device_id=d.id;
  UPDATE customer_devices SET revoked_at=NULL,
   trust_level=CASE WHEN trust_level='staff_paired' THEN 'wallet_verified' ELSE trust_level END,
   last_seen_at=clock_timestamp(),expires_at=clock_timestamp()+interval '365 days',user_agent_family=agent_arg
   WHERE id=d.id RETURNING * INTO d;
 ELSE
  INSERT INTO customer_devices(customer_id,token_hash,user_agent_family,trust_level)
   VALUES(ms.user_id,device_arg,agent_arg,'wallet_verified') RETURNING * INTO d;
  added:=true;
 END IF;
 -- A new phone came in through this pass: the next generation retires the link that was used.
 UPDATE wallet_restore_keys SET generation=generation+1,used_at=clock_timestamp() WHERE membership_id=member_arg;
 IF added THEN
  INSERT INTO customer_device_notices(customer_id,device_id,kind,merchant_id,paired_device_id,pairing_id)
   SELECT ms.user_id,o.id,'wallet_restored',ms.merchant_id,d.id,NULL FROM customer_devices o
   WHERE o.customer_id=ms.user_id AND o.id<>d.id AND o.revoked_at IS NULL AND o.expires_at>clock_timestamp();
 END IF;
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail)
  VALUES(ms.user_id,ms.merchant_id,'customer.wallet.restored',ms.user_id,
   jsonb_build_object('deviceId',d.id,'membershipId',member_arg,'newDevice',added));
 RETURN jsonb_build_object('membershipId',member_arg,'customerId',ms.user_id);
END $$;
REVOKE ALL ON FUNCTION consume_wallet_restore(uuid,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_wallet_restore(uuid,integer,text,text) TO nuqta_auth;

-- The card's owner, so the API takes the customer lifecycle lock before consuming (same order as
-- pairing and privacy deletion).
CREATE FUNCTION wallet_restore_owner(member_arg uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT user_id FROM memberships WHERE id=member_arg
$$;
REVOKE ALL ON FUNCTION wallet_restore_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wallet_restore_owner(uuid) TO nuqta_auth;
