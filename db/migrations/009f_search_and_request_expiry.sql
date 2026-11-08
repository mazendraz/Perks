CREATE FUNCTION search_customer_directory(mid uuid,bid uuid,segment_arg text,query_arg text,limit_arg integer,offset_arg integer) RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF length(query_arg)>80 OR limit_arg NOT BETWEEN 1 AND 10000 OR offset_arg<0 THEN RAISE EXCEPTION 'NQ:INVALID_QUERY';END IF;
 RETURN QUERY SELECT customer FROM customer_directory(mid,bid,segment_arg,NULL,10000,0) AS r(customer) WHERE query_arg='' OR strpos(lower((customer->>'alias')||' '||(customer->>'contact_email')),lower(query_arg))>0 ORDER BY customer->>'created_at' DESC,customer->>'id' LIMIT limit_arg OFFSET offset_arg;
END $$;
GRANT EXECUTE ON FUNCTION search_customer_directory(uuid,uuid,text,text,integer,integer) TO nuqta_runtime;
ALTER TABLE customer_exports ADD COLUMN search_query text NOT NULL DEFAULT '';
ALTER TABLE saved_segments ADD COLUMN search_query text NOT NULL DEFAULT '';
CREATE OR REPLACE FUNCTION prepare_customer_export(export_arg uuid,lease_arg uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ex customer_exports;rows_arg jsonb;
BEGIN
 IF session_user<>'nuqta_worker' THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 SELECT * INTO ex FROM customer_exports WHERE id=export_arg;
 IF NOT FOUND OR ex.expires_at<=clock_timestamp() OR ex.status='revoked' THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF NOT EXISTS(SELECT 1 FROM background_jobs j JOIN outbox_events e ON e.id=j.outbox_id WHERE j.lease_id=lease_arg AND j.status='running' AND j.lease_until>clock_timestamp() AND j.merchant_id=ex.merchant_id AND e.payload->>'exportId'=ex.id::text) THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF NOT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.user_id=ex.requested_by AND s.merchant_id=ex.merchant_id AND s.role='owner' AND s.status='active' AND u.status='active') THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF ex.status='ready' THEN RETURN jsonb_build_object('existingStorageKey',ex.storage_key);END IF;
 PERFORM set_config('app.user_id',ex.requested_by::text,true);
 SELECT coalesce(jsonb_agg(r),'[]') INTO rows_arg FROM search_customer_directory(ex.merchant_id,ex.branch_id,ex.segment,ex.search_query,10000,0) r;
 RETURN jsonb_build_object('exportId',ex.id,'merchantId',ex.merchant_id,'rows',rows_arg,'snapshotAt',clock_timestamp());
END $$;
GRANT EXECUTE ON FUNCTION prepare_customer_export(uuid,uuid) TO nuqta_worker;

ALTER TABLE stamp_request_events ALTER COLUMN actor_id DROP NOT NULL;
CREATE FUNCTION record_request_expiration() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF OLD.status='pending' AND NEW.status='expired' THEN
  IF NEW.expires_at>clock_timestamp() THEN RAISE EXCEPTION 'NQ:REQUEST_NOT_EXPIRED';END IF;
  INSERT INTO stamp_request_events(merchant_id,request_id,actor_id,action) VALUES(NEW.merchant_id,NEW.id,NULL,'expired');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER request_expiration_event AFTER UPDATE OF status ON stamp_requests FOR EACH ROW EXECUTE FUNCTION record_request_expiration();
CREATE FUNCTION sweep_expired_requests() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer;
BEGIN
 IF session_user<>'nuqta_worker' THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 UPDATE stamp_requests SET status='expired',decided_at=clock_timestamp() WHERE status='pending' AND expires_at<=clock_timestamp();GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION sweep_expired_requests() TO nuqta_worker;
