-- The cashier ping is queued by the customer's own session; like every customer-trusting
-- SECURITY DEFINER function it must also respect that session's device scope.
CREATE OR REPLACE FUNCTION enqueue_cashier_push(request_arg uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r stamp_requests; eid uuid;
BEGIN
 SELECT * INTO r FROM stamp_requests WHERE id=request_arg AND user_id=app_user() AND status='pending';
 IF NOT FOUND OR NOT customer_scope_ok(r.merchant_id) THEN RETURN; END IF;
 INSERT INTO outbox_events(merchant_id,event_type,aggregate_id,payload,dedupe_key)
  VALUES(r.merchant_id,'stamp_request.created',r.id,jsonb_build_object('branchId',r.branch_id),'stamp-request-push:'||r.id)
  ON CONFLICT(dedupe_key) DO NOTHING RETURNING id INTO eid;
 IF eid IS NULL THEN SELECT id INTO eid FROM outbox_events WHERE dedupe_key='stamp-request-push:'||r.id; END IF;
 INSERT INTO background_jobs(merchant_id,outbox_id,kind) VALUES(r.merchant_id,eid,'cashier_push') ON CONFLICT(outbox_id,kind) DO NOTHING;
END $$;
