CREATE OR REPLACE FUNCTION owner_full_customer_scope(mid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.status='active' AND s.role='owner' AND u.status='active') AND NOT EXISTS(SELECT 1 FROM branches b WHERE b.merchant_id=mid AND NOT branch_access(mid,b.id))
$$;
CREATE FUNCTION customer_scope_fingerprint(mid uuid,bid uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.status='active' AND s.role='owner' AND u.status='active') AND (bid IS NULL OR EXISTS(SELECT 1 FROM branches b WHERE b.merchant_id=mid AND b.id=bid AND branch_access(mid,b.id))) THEN encode(sha256(convert_to((SELECT coalesce(string_agg(b.id::text,',' ORDER BY b.id),'') FROM branches b WHERE b.merchant_id=mid AND branch_access(mid,b.id) AND (bid IS NULL OR b.id=bid))||CASE WHEN bid IS NULL AND owner_full_customer_scope(mid) THEN '|all-profiles' ELSE '|attributed' END,'UTF8')),'hex') END
$$;
GRANT EXECUTE ON FUNCTION customer_scope_fingerprint(uuid,uuid) TO nuqta_runtime;
ALTER TABLE customer_exports ADD COLUMN scope_fingerprint text;
-- Old artifacts have no reliable historical authorization scope. Revoke their links;
-- no customer, membership, purchase or ledger rows are changed.
UPDATE customer_exports SET status='revoked',error_code='SCOPE_POLICY_UPGRADED' WHERE scope_fingerprint IS NULL;
CREATE OR REPLACE FUNCTION prepare_customer_export(export_arg uuid,lease_arg uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ex customer_exports;rows_arg jsonb;
BEGIN
 IF session_user<>'nuqta_worker' THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 SELECT * INTO ex FROM customer_exports WHERE id=export_arg;
 IF NOT FOUND OR ex.expires_at<=clock_timestamp() OR ex.status='revoked' THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF NOT EXISTS(SELECT 1 FROM background_jobs j JOIN outbox_events e ON e.id=j.outbox_id WHERE j.lease_id=lease_arg AND j.status='running' AND j.lease_until>clock_timestamp() AND j.merchant_id=ex.merchant_id AND e.payload->>'exportId'=ex.id::text) THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF NOT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.user_id=ex.requested_by AND s.merchant_id=ex.merchant_id AND s.role='owner' AND s.status='active' AND u.status='active') THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 PERFORM set_config('app.user_id',ex.requested_by::text,true);
 IF ex.scope_fingerprint IS NULL OR ex.scope_fingerprint IS DISTINCT FROM customer_scope_fingerprint(ex.merchant_id,ex.branch_id) THEN RAISE EXCEPTION 'NQ:EXPORT_SCOPE_CHANGED';END IF;
 IF ex.status='ready' THEN RETURN jsonb_build_object('existingStorageKey',ex.storage_key);END IF;
 PERFORM set_config('app.user_id',ex.requested_by::text,true);
 SELECT coalesce(jsonb_agg(r),'[]') INTO rows_arg FROM search_customer_directory(ex.merchant_id,ex.branch_id,ex.segment,ex.search_query,10000,0) r;
 RETURN jsonb_build_object('exportId',ex.id,'merchantId',ex.merchant_id,'rows',rows_arg,'snapshotAt',clock_timestamp());
END $$;
GRANT EXECUTE ON FUNCTION prepare_customer_export(uuid,uuid) TO nuqta_worker;

