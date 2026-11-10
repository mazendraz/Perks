ALTER TABLE users ADD COLUMN privacy_deleted_at timestamptz;
ALTER TABLE customer_exports ADD COLUMN privacy_revoked_at timestamptz;

CREATE FUNCTION customer_session_current(session_arg uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
 WHERE s.id=session_arg AND s.user_id=app_user() AND s.auth_method='device'
 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
 AND s.credential_version=u.password_version AND u.status='active' AND u.privacy_deleted_at IS NULL
 AND customer_device_active(s.customer_device_id,s.user_id))
$$;
REVOKE ALL ON FUNCTION customer_session_current(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION customer_session_current(uuid) TO nuqta_runtime,nuqta_auth;

CREATE FUNCTION delete_customer_identity(session_arg uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE account users;mid uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-lifecycle:'||app_user()::text,0));
 IF NOT customer_session_current(session_arg) THEN RAISE EXCEPTION 'NQ:UNAUTHENTICATED';END IF;
 SELECT * INTO account FROM users WHERE id=app_user() FOR UPDATE;
 IF account.global_role<>'customer' OR EXISTS(SELECT 1 FROM staff_memberships WHERE user_id=account.id)
 THEN RAISE EXCEPTION 'NQ:WORK_ACCOUNT_REVIEW_REQUIRED';END IF;
 PERFORM membership_id FROM loyalty_accounts WHERE membership_id IN(SELECT id FROM memberships WHERE user_id=account.id)
 ORDER BY membership_id FOR UPDATE;
 UPDATE users SET display_name='—',email=NULL,auth_subject=NULL,password_hash=NULL,
 password_version=password_version+1,status='disabled',totp_secret=NULL,last_totp_counter=-1,
 privacy_deleted_at=clock_timestamp() WHERE id=account.id;
 UPDATE customer_identities SET phone_e164=NULL,phone_normalized=NULL,legacy=true WHERE customer_id=account.id;
 UPDATE tenant_customer_profiles SET alias='—',contact_email='',contact_phone='' WHERE user_id=account.id;
 UPDATE memberships SET status='suspended' WHERE user_id=account.id;
 UPDATE customer_devices SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE customer_id=account.id;
 UPDATE sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE user_id=account.id;
 UPDATE customer_recoveries SET used_at=coalesce(used_at,clock_timestamp()),expires_at=least(expires_at,clock_timestamp()) WHERE customer_id=account.id;
 UPDATE presentation_tokens SET expires_at=least(expires_at,clock_timestamp()) WHERE membership_id IN(SELECT id FROM memberships WHERE user_id=account.id);
 INSERT INTO stamp_request_events(merchant_id,request_id,actor_id,action)
 SELECT merchant_id,id,account.id,'customer_privacy_cancelled' FROM stamp_requests WHERE user_id=account.id AND status='pending';
 UPDATE stamp_requests SET status='cancelled',decided_at=clock_timestamp(),decided_by=account.id,reason='customer_privacy_deleted'
 WHERE user_id=account.id AND status='pending';
 UPDATE redemption_challenges SET status='cancelled' WHERE holder_user_id=account.id AND status IN('awaiting_holder','confirmed');
 INSERT INTO consent_events(merchant_id,user_id,channel,granted,text_version)
 SELECT merchant_id,user_id,channel,false,'privacy-delete-v1' FROM consent_current WHERE user_id=account.id AND granted;
 UPDATE consent_current SET granted=false,revision=revision+1,updated_at=clock_timestamp() WHERE user_id=account.id;
 UPDATE password_reset_tokens SET used_at=coalesce(used_at,clock_timestamp()),expires_at=least(expires_at,clock_timestamp()) WHERE user_id=account.id;
 UPDATE auth_mail_outbox SET payload='{}',status='blocked',last_error='AUTH_MAIL_STALE',lease_until=NULL,
 expires_at=least(expires_at,clock_timestamp()) WHERE user_id=account.id AND status<>'sent';
 DELETE FROM auth_challenges WHERE email=account.email;
 DELETE FROM password_login_ip_guards WHERE email=account.email;
 DELETE FROM password_login_guards WHERE email=account.email;
 FOR mid IN SELECT DISTINCT merchant_id FROM tenant_customer_profiles WHERE user_id=account.id ORDER BY merchant_id LOOP
   UPDATE customer_exports SET status='revoked',privacy_revoked_at=clock_timestamp(),
   expires_at=least(expires_at,clock_timestamp()),error_code='CUSTOMER_PRIVACY_DELETED' WHERE merchant_id=mid;
   INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail)
   VALUES(account.id,mid,'customer.privacy.deleted',account.id,'{"ledgerPreserved":true}');
 END LOOP;
 RETURN jsonb_build_object('deleted',true);
END $$;
REVOKE ALL ON FUNCTION delete_customer_identity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_customer_identity(uuid) TO nuqta_runtime;

CREATE INDEX privacy_export_lease ON background_jobs(merchant_id,lease_id) WHERE kind='customer_export';
CREATE FUNCTION export_privacy_purge_required(key_arg text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE parts text[];
BEGIN
 IF session_user<>'nuqta_worker' THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 parts=regexp_match(key_arg,'^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[.]csv$');
 IF parts IS NULL THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM customer_exports WHERE merchant_id=parts[1]::uuid AND storage_key=key_arg AND privacy_revoked_at IS NOT NULL)
 OR EXISTS(SELECT 1 FROM background_jobs j JOIN outbox_events o ON o.id=j.outbox_id
 JOIN customer_exports ex ON ex.id::text=o.payload->>'exportId' AND ex.merchant_id=j.merchant_id
 WHERE j.merchant_id=parts[1]::uuid AND j.lease_id=parts[2]::uuid AND j.kind='customer_export' AND ex.privacy_revoked_at IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION export_privacy_purge_required(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION export_privacy_purge_required(text) TO nuqta_worker;

CREATE OR REPLACE FUNCTION merchant_contact_readiness(mid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT is_platform_admin() THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 RETURN jsonb_build_object('missing_phones',(SELECT count(*)::int FROM tenant_customer_profiles cp JOIN users u ON u.id=cp.user_id WHERE cp.merchant_id=mid AND cp.contact_phone='' AND u.privacy_deleted_at IS NULL),
 'whatsapp_ready',(SELECT count(*)::int FROM tenant_customer_profiles cp JOIN users u ON u.id=cp.user_id JOIN consent_current c ON c.merchant_id=cp.merchant_id AND c.user_id=cp.user_id AND c.channel='whatsapp' AND c.granted WHERE cp.merchant_id=mid AND cp.contact_phone<>'' AND u.privacy_deleted_at IS NULL));
END $$;
