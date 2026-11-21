-- Existing numbers were entered without proof. Only numbers confirmed on a full-access
-- device can subsequently authorize WhatsApp recovery on a new one.
ALTER TABLE customer_identities ADD COLUMN phone_verified_at timestamptz;

CREATE FUNCTION clear_customer_phone_verification() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.phone_e164 IS DISTINCT FROM OLD.phone_e164 THEN NEW.phone_verified_at:=NULL;END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER clear_customer_phone_verification BEFORE UPDATE OF phone_e164 ON customer_identities
 FOR EACH ROW EXECUTE FUNCTION clear_customer_phone_verification();
REVOKE ALL ON FUNCTION clear_customer_phone_verification() FROM PUBLIC;

CREATE TABLE customer_whatsapp_proofs (
 device_hash text PRIMARY KEY CHECK(device_hash ~ '^[a-f0-9]{64}$'),
 code_hash text NOT NULL UNIQUE CHECK(code_hash ~ '^[a-f0-9]{64}$'),
 phone_hash text NOT NULL CHECK(phone_hash ~ '^[a-f0-9]{64}$'),
 account_id uuid REFERENCES customer_identities(customer_id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '10 minutes'),
 confirmed_at timestamptz,
 completed_at timestamptz
);
CREATE INDEX customer_whatsapp_proofs_expiry ON customer_whatsapp_proofs(expires_at);
ALTER TABLE customer_whatsapp_proofs ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_whatsapp_proofs ON customer_whatsapp_proofs TO nuqta_auth USING(true);
REVOKE ALL ON customer_whatsapp_proofs FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON customer_whatsapp_proofs TO nuqta_auth;

ALTER TABLE customer_device_notices DROP CONSTRAINT customer_device_notices_kind_check;
ALTER TABLE customer_device_notices ADD CONSTRAINT customer_device_notices_kind_check
 CHECK(kind IN ('device_paired','wallet_restored','phone_verified'));
ALTER TABLE customer_device_notices ALTER COLUMN merchant_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION my_device_notices(session_arg uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'kind',n.kind,'merchantName',m.name,'createdAt',n.created_at,
   'deviceFamily',pd.user_agent_family,'deviceActive',pd.revoked_at IS NULL,
   'canRemove',me.trust_level<>'staff_paired' AND pd.revoked_at IS NULL) ORDER BY n.created_at DESC),'[]'::jsonb)
 FROM sessions s JOIN customer_devices me ON me.id=s.customer_device_id AND me.customer_id=s.user_id
 JOIN customer_device_notices n ON n.device_id=me.id AND n.dismissed_at IS NULL
 JOIN customer_devices pd ON pd.id=n.paired_device_id LEFT JOIN merchants m ON m.id=n.merchant_id
 WHERE s.id=session_arg AND s.user_id=app_user() AND s.auth_method='device'
$$;

CREATE FUNCTION customer_whatsapp_account(device_arg text,session_arg uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',i.customer_id,'phone',mask_customer_phone(i.phone_e164),'verified',i.phone_verified_at IS NOT NULL)
 FROM customer_devices d JOIN sessions s ON s.customer_device_id=d.id AND s.user_id=d.customer_id
 JOIN customer_identities i ON i.customer_id=d.customer_id
 WHERE d.token_hash=device_arg AND d.trust_level<>'staff_paired' AND s.id=session_arg
   AND customer_session_current(session_arg)
$$;
REVOKE ALL ON FUNCTION customer_whatsapp_account(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION customer_whatsapp_account(text,uuid) TO nuqta_auth;

CREATE FUNCTION finish_customer_whatsapp_proof(device_arg text,code_arg text,phone_hash_arg text,
 phone_arg text,session_arg uuid,agent_arg text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE proof customer_whatsapp_proofs;identity_row customer_identities;d customer_devices;uid uuid;is_new boolean;
BEGIN
 SELECT * INTO proof FROM customer_whatsapp_proofs WHERE device_hash=device_arg AND code_hash=code_arg
  AND phone_hash=phone_hash_arg AND expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RETURN 'expired';END IF;
 IF proof.confirmed_at IS NULL THEN RETURN 'waiting';END IF;
 IF proof.account_id IS NOT NULL THEN
  uid:=proof.account_id;
 ELSE
  SELECT customer_id INTO uid FROM customer_identities WHERE phone_e164=phone_arg AND phone_verified_at IS NOT NULL;
  IF NOT FOUND THEN RETURN 'unavailable';END IF;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-lifecycle:'||uid::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('device-register:'||device_arg,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-phone:'||phone_arg,0));
 SELECT i.* INTO identity_row FROM customer_identities i JOIN users u ON u.id=i.customer_id
  WHERE i.customer_id=uid AND u.status='active' AND u.global_role='customer' FOR UPDATE OF i;
 IF NOT FOUND THEN RETURN 'unavailable';END IF;
 IF proof.account_id IS NOT NULL THEN
  IF (customer_whatsapp_account(device_arg,session_arg)->>'id')::uuid IS DISTINCT FROM uid THEN RETURN 'scope';END IF;
  IF proof.completed_at IS NOT NULL THEN
   IF identity_row.phone_e164=phone_arg AND identity_row.phone_verified_at IS NOT NULL THEN RETURN 'updated';END IF;
   RETURN 'expired';
  END IF;
  IF EXISTS(SELECT 1 FROM customer_identities WHERE phone_e164=phone_arg AND customer_id<>uid) THEN RETURN 'in_use';END IF;
  IF identity_row.phone_e164 IS DISTINCT FROM phone_arg THEN
   UPDATE customer_identities SET phone_e164=phone_arg,phone_normalized=phone_arg,legacy=false WHERE customer_id=uid;
   WITH changed AS (
    UPDATE tenant_customer_profiles SET contact_phone=phone_arg
     WHERE user_id=uid AND contact_phone=identity_row.phone_e164 RETURNING merchant_id
   ), revoked AS (
    UPDATE consent_current SET granted=false,revision=revision+1,updated_at=clock_timestamp()
     WHERE user_id=uid AND merchant_id IN (SELECT merchant_id FROM changed) AND channel IN ('whatsapp','sms') AND granted
     RETURNING merchant_id,channel
   ) INSERT INTO consent_events(merchant_id,user_id,channel,granted)
      SELECT merchant_id,uid,channel,false FROM revoked;
   UPDATE customer_pairings SET status='cancelled' WHERE (customer_id=uid OR claimed_phone=identity_row.phone_e164)
    AND status IN ('waiting','awaiting_approval','approved');
  END IF;
  UPDATE customer_identities SET phone_verified_at=clock_timestamp() WHERE customer_id=uid;
  UPDATE customer_whatsapp_proofs SET completed_at=clock_timestamp() WHERE device_hash=device_arg;
  INSERT INTO audit_events(actor_id,action,target_id,detail) VALUES(uid,
   CASE WHEN identity_row.phone_e164=phone_arg THEN 'customer.phone.verified' ELSE 'customer.phone.changed' END,
   uid,jsonb_build_object('channel','whatsapp'));
  RETURN 'updated';
 END IF;
 IF identity_row.phone_e164 IS DISTINCT FROM phone_arg OR identity_row.phone_verified_at IS NULL
  OR identity_row.phone_verified_at>proof.confirmed_at THEN RETURN 'unavailable';END IF;
 SELECT * INTO d FROM customer_devices WHERE token_hash=device_arg FOR UPDATE;
 IF proof.completed_at IS NOT NULL THEN
  IF d.customer_id=uid AND d.revoked_at IS NULL AND d.expires_at>clock_timestamp() AND d.trust_level='otp_verified'
   THEN RETURN 'restored';END IF;
  RETURN 'expired';
 END IF;
 IF d.customer_id IS NOT NULL AND d.customer_id<>uid THEN RETURN 'conflict';END IF;
 is_new:=d.id IS NULL OR d.revoked_at IS NOT NULL OR d.expires_at<=clock_timestamp() OR d.trust_level='staff_paired';
 IF d.id IS NULL THEN
  INSERT INTO customer_devices(customer_id,token_hash,user_agent_family,trust_level)
   VALUES(uid,device_arg,agent_arg,'otp_verified') RETURNING * INTO d;
 ELSE
  DELETE FROM customer_device_merchants WHERE device_id=d.id;
  UPDATE customer_devices SET trust_level='otp_verified',revoked_at=NULL,expires_at=clock_timestamp()+interval '365 days',
   last_seen_at=clock_timestamp(),user_agent_family=agent_arg WHERE id=d.id;
 END IF;
 IF is_new THEN
  INSERT INTO customer_device_notices(customer_id,device_id,kind,paired_device_id)
   SELECT uid,o.id,'phone_verified',d.id FROM customer_devices o
   WHERE o.customer_id=uid AND o.id<>d.id AND o.revoked_at IS NULL AND o.expires_at>clock_timestamp();
 END IF;
 INSERT INTO audit_events(actor_id,action,target_id,detail)
  VALUES(uid,'customer.whatsapp.restored',uid,jsonb_build_object('deviceId',d.id,'newDevice',is_new));
 UPDATE customer_whatsapp_proofs SET completed_at=clock_timestamp() WHERE device_hash=device_arg;
 RETURN 'restored';
END $$;
REVOKE ALL ON FUNCTION finish_customer_whatsapp_proof(text,text,text,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finish_customer_whatsapp_proof(text,text,text,text,uuid,text) TO nuqta_auth;
