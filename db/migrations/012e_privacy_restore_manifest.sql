CREATE TABLE privacy_instance_identity(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid());
INSERT INTO privacy_instance_identity(singleton) VALUES(true);
REVOKE ALL ON privacy_instance_identity FROM PUBLIC;

-- Owner-only maintenance primitive shared by interactive deletion and offline restore.
-- Public/runtime/auth/worker callers never receive EXECUTE on this function.
CREATE FUNCTION anonymize_customer_record(uid uuid,deleted_at_arg timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE account users;mid uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-lifecycle:'||uid::text,0));
 PERFORM id FROM stamp_requests WHERE user_id=uid AND status='pending' ORDER BY id FOR UPDATE;
 SELECT * INTO account FROM users WHERE id=uid FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('missing',true);END IF;
 IF account.global_role<>'customer' OR EXISTS(SELECT 1 FROM staff_memberships WHERE user_id=uid) THEN RAISE EXCEPTION 'NQ:WORK_ACCOUNT_REVIEW_REQUIRED';END IF;
 IF account.privacy_deleted_at IS NOT NULL THEN RETURN jsonb_build_object('deleted',true,'alreadyDeleted',true);END IF;
 PERFORM membership_id FROM loyalty_accounts WHERE membership_id IN(SELECT id FROM memberships WHERE user_id=uid) ORDER BY membership_id FOR UPDATE;
 UPDATE users SET display_name='—',email=NULL,auth_subject=NULL,password_hash=NULL,password_version=password_version+1,status='disabled',totp_secret=NULL,last_totp_counter=-1,privacy_deleted_at=deleted_at_arg WHERE id=uid;
 UPDATE customer_identities SET phone_e164=NULL,phone_normalized=NULL,legacy=true WHERE customer_id=uid;
 UPDATE tenant_customer_profiles SET alias='—',contact_email='',contact_phone='' WHERE user_id=uid;
 UPDATE memberships SET status='suspended' WHERE user_id=uid;
 UPDATE customer_devices SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE customer_id=uid;
 UPDATE sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE user_id=uid;
 UPDATE customer_recoveries SET used_at=coalesce(used_at,clock_timestamp()),expires_at=least(expires_at,clock_timestamp()) WHERE customer_id=uid;
 UPDATE presentation_tokens SET expires_at=least(expires_at,clock_timestamp()) WHERE membership_id IN(SELECT id FROM memberships WHERE user_id=uid);
 INSERT INTO stamp_request_events(merchant_id,request_id,actor_id,action) SELECT merchant_id,id,uid,'customer_privacy_cancelled' FROM stamp_requests WHERE user_id=uid AND status='pending';
 UPDATE stamp_requests SET status='cancelled',decided_at=clock_timestamp(),decided_by=uid,reason='customer_privacy_deleted' WHERE user_id=uid AND status='pending';
 UPDATE redemption_challenges SET status='cancelled' WHERE holder_user_id=uid AND status IN('awaiting_holder','confirmed');
 INSERT INTO consent_events(merchant_id,user_id,channel,granted,text_version) SELECT merchant_id,user_id,channel,false,'privacy-delete-v1' FROM consent_current WHERE user_id=uid AND granted;
 UPDATE consent_current SET granted=false,revision=revision+1,updated_at=clock_timestamp() WHERE user_id=uid;
 UPDATE password_reset_tokens SET used_at=coalesce(used_at,clock_timestamp()),expires_at=least(expires_at,clock_timestamp()) WHERE user_id=uid;
 UPDATE auth_mail_outbox SET payload='{}',status='blocked',last_error='AUTH_MAIL_STALE',lease_until=NULL,expires_at=least(expires_at,clock_timestamp()) WHERE user_id=uid AND status<>'sent';
 DELETE FROM auth_challenges WHERE email=account.email;
 DELETE FROM password_login_ip_guards WHERE email=account.email;
 DELETE FROM password_login_guards WHERE email=account.email;
 FOR mid IN SELECT DISTINCT merchant_id FROM tenant_customer_profiles WHERE user_id=uid ORDER BY merchant_id LOOP
   UPDATE customer_exports SET status='revoked',privacy_revoked_at=clock_timestamp(),expires_at=least(expires_at,clock_timestamp()),error_code='CUSTOMER_PRIVACY_DELETED' WHERE merchant_id=mid;
   INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail) VALUES(uid,mid,'customer.privacy.deleted',uid,'{"ledgerPreserved":true}');
 END LOOP;
 RETURN jsonb_build_object('deleted',true,'alreadyDeleted',false);
END $$;
REVOKE ALL ON FUNCTION anonymize_customer_record(uuid,timestamptz) FROM PUBLIC;

CREATE OR REPLACE FUNCTION delete_customer_identity_v1(session_arg uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT customer_session_current(session_arg) THEN RAISE EXCEPTION 'NQ:UNAUTHENTICATED';END IF;
 RETURN anonymize_customer_record(app_user(),clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION delete_customer_identity_v1(uuid) FROM PUBLIC,nuqta_runtime;
