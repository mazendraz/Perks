-- Keep per-lease artifact names, now using a single opaque UUID in the FileStore key.
ALTER TABLE customer_exports ADD CONSTRAINT customer_exports_tenant_id UNIQUE(merchant_id,id);
CREATE TABLE customer_export_artifacts (
 storage_key text PRIMARY KEY,merchant_id uuid NOT NULL,export_id uuid NOT NULL,lease_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(merchant_id,export_id) REFERENCES customer_exports(merchant_id,id),
 CHECK(storage_key=merchant_id::text||'/'||lease_id::text||'.csv')
);
CREATE TRIGGER export_artifact_immutable BEFORE UPDATE OR DELETE ON customer_export_artifacts FOR EACH ROW EXECUTE FUNCTION immutable_row();
ALTER TABLE customer_export_artifacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_export_artifacts FROM PUBLIC;
CREATE POLICY worker_export_artifact ON customer_export_artifacts USING(current_user='nuqta_worker' AND merchant_id::text=current_setting('app.worker_tenant',true)) WITH CHECK(current_user='nuqta_worker' AND merchant_id::text=current_setting('app.worker_tenant',true));
GRANT SELECT,INSERT ON customer_export_artifacts TO nuqta_worker;
-- The old canonical name itself proves the immutable export and lease identity.
INSERT INTO customer_export_artifacts(storage_key,merchant_id,export_id,lease_id)
 SELECT ex.merchant_id::text||'/'||parts[3]||'.csv',ex.merchant_id,ex.id,parts[3]::uuid FROM customer_exports ex
 CROSS JOIN LATERAL regexp_match(ex.storage_key,'^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[.]csv$') AS parsed(parts)
 WHERE parts[1]=ex.merchant_id::text AND parts[2]=ex.id::text;
CREATE OR REPLACE FUNCTION export_artifact_deletable(key_arg text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE parts text[];
BEGIN
 IF session_user<>'nuqta_worker' THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 parts=regexp_match(key_arg,'^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[.]csv$');
 IF parts IS NULL THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM background_jobs j WHERE j.merchant_id=parts[1]::uuid AND j.kind='customer_export' AND j.lease_id=parts[2]::uuid AND j.status='running' AND j.lease_until>clock_timestamp()) THEN RETURN false;END IF;
 RETURN NOT EXISTS(SELECT 1 FROM customer_exports WHERE storage_key=key_arg AND status='ready' AND expires_at>clock_timestamp());
END $$;
CREATE FUNCTION customer_export_storage_valid(mid uuid,export_arg uuid,key_arg text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE parts text[];
BEGIN
 parts=regexp_match(key_arg,'^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[.]csv$');
 IF parts IS NULL OR parts[1]<>mid::text THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM customer_exports ex JOIN customer_export_artifacts a ON a.merchant_id=ex.merchant_id AND a.export_id=ex.id WHERE ex.id=export_arg AND ex.merchant_id=mid AND ex.requested_by=app_user() AND tenant_access(mid) AND ex.storage_key=key_arg AND a.storage_key=key_arg AND a.lease_id=parts[2]::uuid);
END $$;
REVOKE ALL ON FUNCTION export_artifact_deletable(text),customer_export_storage_valid(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION export_artifact_deletable(text) TO nuqta_worker;
GRANT EXECUTE ON FUNCTION customer_export_storage_valid(uuid,uuid,text) TO nuqta_runtime;
