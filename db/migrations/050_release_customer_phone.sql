-- "Release a number" for the platform team (docs/CUSTOMER-IDENTITY-SCENARIOS.md, scenario D1).
-- Someone registered with a number that is not theirs. The real owner proves it by messaging Perks
-- support on WhatsApp from that number; an admin then frees the number so its owner can register.
-- The other person keeps their cards on their own phone but loses the number: it no longer
-- identifies them, and shops stop seeing it as their contact (WhatsApp would reach the owner).

CREATE FUNCTION release_customer_phone(phone_arg text,reason_arg text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE uid uuid;shops integer;
BEGIN
 IF NOT is_platform_admin() THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF phone_arg !~ '^\+[1-9][0-9]{7,14}$' OR length(trim(coalesce(reason_arg,''))) NOT BETWEEN 10 AND 500 THEN
  RAISE EXCEPTION 'NQ:VALIDATION_FAILED';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-phone:'||phone_arg,0));
 SELECT customer_id INTO uid FROM customer_identities WHERE phone_e164=phone_arg FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('released',false);END IF;
 -- No number any more: marked like a privacy deletion (legacy is only a "no phone" marker).
 UPDATE customer_identities SET phone_e164=NULL,phone_normalized=NULL,legacy=true WHERE customer_id=uid;
 -- Shops stop messaging this card on that number, and no consent to it survives.
 UPDATE tenant_customer_profiles SET contact_phone='' WHERE user_id=uid AND contact_phone=phone_arg;
 GET DIAGNOSTICS shops=ROW_COUNT;
 UPDATE consent_current SET granted=false,revision=revision+1,updated_at=clock_timestamp()
  WHERE user_id=uid AND channel='whatsapp' AND granted;
 -- Open pairings for that number cannot complete any more.
 UPDATE customer_pairings SET status='cancelled'
  WHERE (customer_id=uid OR claimed_phone=phone_arg) AND status IN ('waiting','awaiting_approval','approved');
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail)
  VALUES(app_user(),NULL,'customer.phone.released',uid,
   jsonb_build_object('phone',mask_customer_phone(phone_arg),'reason',trim(reason_arg),'shops',shops));
 RETURN jsonb_build_object('released',true,'shops',shops);
END $$;
REVOKE ALL ON FUNCTION release_customer_phone(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION release_customer_phone(text,text) TO nuqta_runtime;
