-- The worker may inspect only the liveness of a canonical artifact key.
-- Files are removed under the same transaction advisory lock used during publication.
CREATE FUNCTION export_artifact_deletable(key_arg text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE parts text[]; ex customer_exports;
BEGIN
 IF session_user<>'nuqta_worker' THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 parts=regexp_match(key_arg,'^([0-9a-f-]{36})/([0-9a-f-]{36})-([0-9a-f-]{36})[.]csv$');
 IF parts IS NULL THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM background_jobs j JOIN outbox_events o ON o.id=j.outbox_id WHERE j.merchant_id=parts[1]::uuid AND o.payload->>'exportId'=parts[2] AND j.lease_id=parts[3]::uuid AND j.status='running' AND j.lease_until>clock_timestamp()) THEN RETURN false;END IF;
 SELECT * INTO ex FROM customer_exports WHERE storage_key=key_arg AND status='ready' AND expires_at>clock_timestamp();
 IF FOUND THEN RETURN false;END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION export_artifact_deletable(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION export_artifact_deletable(text) TO nuqta_worker;
