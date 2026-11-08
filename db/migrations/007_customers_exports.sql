CREATE FUNCTION customer_directory(mid uuid,bid uuid,segment_arg text,profile_arg uuid DEFAULT NULL,limit_arg integer DEFAULT 50,offset_arg integer DEFAULT 0) RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE staff staff_memberships;
BEGIN
 SELECT s.* INTO staff FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.status='active' AND s.role IN ('owner','manager') AND u.status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF bid IS NOT NULL AND NOT branch_access(mid,bid) THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF segment_arg NOT IN ('all','active','inactive','never_active') OR limit_arg NOT BETWEEN 1 AND 10000 OR offset_arg<0 THEN RAISE EXCEPTION 'NQ:INVALID_QUERY';END IF;
 RETURN QUERY WITH scoped AS (
 SELECT cp.id,cp.alias,cp.contact_email,cp.created_at,
  (SELECT max(t.at) FROM loyalty_transactions t JOIN memberships ms ON ms.id=t.membership_id WHERE ms.profile_id=cp.id AND t.type='award' AND branch_access(mid,t.branch_id) AND (bid IS NULL OR t.branch_id=bid)) AS last_purchase_at,
  (SELECT count(DISTINCT t.purchase_id)::int FROM loyalty_transactions t JOIN memberships ms ON ms.id=t.membership_id WHERE ms.profile_id=cp.id AND t.type='award' AND branch_access(mid,t.branch_id) AND (bid IS NULL OR t.branch_id=bid)) AS visits,
  (SELECT coalesce(sum(t.quantity),0)::int FROM loyalty_transactions t JOIN memberships ms ON ms.id=t.membership_id WHERE ms.profile_id=cp.id AND t.type IN ('award','correction') AND branch_access(mid,t.branch_id) AND (bid IS NULL OR t.branch_id=bid)) AS net_stamps
 FROM tenant_customer_profiles cp WHERE cp.merchant_id=mid AND (profile_arg IS NULL OR cp.id=profile_arg) AND (staff.role='owner' AND bid IS NULL OR EXISTS(SELECT 1 FROM memberships ms WHERE ms.profile_id=cp.id AND ((branch_access(mid,ms.origin_branch_id) AND (bid IS NULL OR ms.origin_branch_id=bid)) OR EXISTS(SELECT 1 FROM loyalty_transactions t WHERE t.membership_id=ms.id AND branch_access(mid,t.branch_id) AND (bid IS NULL OR t.branch_id=bid)))))
 ), labelled AS (SELECT *,CASE WHEN last_purchase_at IS NULL THEN 'never_active' WHEN last_purchase_at>=now()-interval '30 days' THEN 'active' ELSE 'inactive' END AS segment FROM scoped)
 SELECT to_jsonb(labelled) FROM labelled WHERE segment_arg='all' OR segment=segment_arg ORDER BY created_at DESC,id LIMIT limit_arg OFFSET offset_arg;
END $$;
GRANT EXECUTE ON FUNCTION customer_directory(uuid,uuid,text,uuid,integer,integer) TO nuqta_runtime;
CREATE TABLE customer_exports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants(id),requested_by uuid NOT NULL REFERENCES users(id),branch_id uuid,
 segment text NOT NULL CHECK(segment IN ('all','active','inactive','never_active')),status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','ready','failed','revoked')),
 storage_key text,row_count integer,error_code text,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour',
 FOREIGN KEY(merchant_id,branch_id) REFERENCES branches(merchant_id,id)
);
ALTER TABLE customer_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_customer_exports ON customer_exports USING(requested_by=app_user() AND tenant_access(merchant_id)) WITH CHECK(requested_by=app_user() AND tenant_access(merchant_id));
CREATE POLICY worker_customer_exports ON customer_exports USING(current_user='nuqta_worker' AND merchant_id::text=current_setting('app.worker_tenant',true)) WITH CHECK(current_user='nuqta_worker' AND merchant_id::text=current_setting('app.worker_tenant',true));
GRANT SELECT,INSERT ON customer_exports TO nuqta_runtime;
GRANT SELECT,UPDATE ON customer_exports TO nuqta_worker;
CREATE FUNCTION prepare_customer_export(export_arg uuid,lease_arg uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ex customer_exports;rows_arg jsonb;
BEGIN
 IF session_user<>'nuqta_worker' THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 SELECT * INTO ex FROM customer_exports WHERE id=export_arg;
 IF NOT FOUND OR ex.expires_at<=clock_timestamp() OR ex.status='revoked' THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF NOT EXISTS(SELECT 1 FROM background_jobs j JOIN outbox_events e ON e.id=j.outbox_id WHERE j.lease_id=lease_arg AND j.status='running' AND j.lease_until>clock_timestamp() AND j.merchant_id=ex.merchant_id AND e.payload->>'exportId'=ex.id::text) THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF NOT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.user_id=ex.requested_by AND s.merchant_id=ex.merchant_id AND s.role='owner' AND s.status='active' AND u.status='active') THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF ex.status='ready' THEN RETURN jsonb_build_object('existingStorageKey',ex.storage_key);END IF;
 PERFORM set_config('app.user_id',ex.requested_by::text,true);
 SELECT coalesce(jsonb_agg(r),'[]') INTO rows_arg FROM customer_directory(ex.merchant_id,ex.branch_id,ex.segment,NULL,10000,0) r;
 RETURN jsonb_build_object('exportId',ex.id,'merchantId',ex.merchant_id,'rows',rows_arg,'snapshotAt',clock_timestamp());
END $$;
GRANT EXECUTE ON FUNCTION prepare_customer_export(uuid,uuid) TO nuqta_worker;
