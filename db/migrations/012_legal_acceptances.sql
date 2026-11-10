-- Old receipts remain intact. A locale-specific version/hash identifies the exact notice.
CREATE UNIQUE INDEX customer_privacy_receipt_version ON customer_privacy_acceptances(customer_id,version,text_hash);
CREATE FUNCTION accept_customer_legal(session_arg uuid,version_arg text,text_arg text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE device uuid;
BEGIN
 SELECT s.customer_device_id INTO device FROM sessions s JOIN users u ON u.id=s.user_id
 WHERE s.id=session_arg AND s.user_id=app_user() AND s.auth_method='device'
 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND u.status='active'
 AND customer_device_active(s.customer_device_id,s.user_id);
 IF device IS NULL THEN RAISE EXCEPTION 'NQ:UNAUTHENTICATED';END IF;
 INSERT INTO customer_privacy_acceptances(customer_id,device_id,version,text_hash,terms_text)
 VALUES(app_user(),device,version_arg,encode(sha256(convert_to(text_arg,'UTF8')),'hex'),text_arg)
 ON CONFLICT(customer_id,version,text_hash) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION accept_customer_legal(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_customer_legal(uuid,text,text) TO nuqta_runtime;
