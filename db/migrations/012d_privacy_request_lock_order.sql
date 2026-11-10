-- Match cashier approval's request-before-account order during deletion.
ALTER FUNCTION delete_customer_identity(uuid) RENAME TO delete_customer_identity_v1;
REVOKE ALL ON FUNCTION delete_customer_identity_v1(uuid) FROM PUBLIC,nuqta_runtime;
CREATE FUNCTION delete_customer_identity(session_arg uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-lifecycle:'||app_user()::text,0));
 IF NOT customer_session_current(session_arg) THEN RAISE EXCEPTION 'NQ:UNAUTHENTICATED';END IF;
 PERFORM id FROM stamp_requests WHERE user_id=app_user() AND status='pending' ORDER BY id FOR UPDATE;
 RETURN delete_customer_identity_v1(session_arg);
END $$;
REVOKE ALL ON FUNCTION delete_customer_identity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_customer_identity(uuid) TO nuqta_runtime;
