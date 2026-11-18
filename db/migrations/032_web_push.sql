-- Web Push for cashier devices (phase 1): a new customer stamp request rings the phones of the
-- cashiers and managers who hold a grant on that branch.
--
-- A device row is bound to the SESSION that registered it. Signing out (or the session expiring or
-- being revoked) therefore silences the phone even if the browser never got to tell us, and the
-- row is deleted outright on logout so the push endpoint is not kept for a signed-out person.
-- Nothing here touches stamps, the ledger or awards.
CREATE TABLE push_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id),
 session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 endpoint text NOT NULL UNIQUE CHECK(endpoint ~ '^https://' AND length(endpoint)<=1000),
 p256dh text NOT NULL CHECK(p256dh ~ '^[A-Za-z0-9_-]{80,120}$'),
 auth text NOT NULL CHECK(auth ~ '^[A-Za-z0-9_-]{16,32}$'),
 language text NOT NULL DEFAULT 'ar' CHECK(language IN ('ar','en')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_push_at timestamptz,
 fail_count integer NOT NULL DEFAULT 0 CHECK(fail_count>=0)
);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX push_subscriptions_session ON push_subscriptions(session_id);

-- Row level security: a signed-in person sees and removes only their own devices. Writing a device,
-- and everything the worker does, goes through the SECURITY DEFINER functions below, so neither
-- the runtime role nor the worker role can insert, update or read other people's endpoints.
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY push_own_select ON push_subscriptions FOR SELECT TO nuqta_runtime USING(user_id=app_user());
CREATE POLICY push_own_delete ON push_subscriptions FOR DELETE TO nuqta_runtime USING(user_id=app_user());
GRANT SELECT,DELETE ON push_subscriptions TO nuqta_runtime;

-- Only cashiers and managers can be notified. Owners are deliberately not (decided for phase 1).
CREATE FUNCTION push_staff_eligible(uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id
  WHERE s.user_id=uid AND s.role IN ('cashier','manager') AND s.status='active' AND u.status='active')
$$;
REVOKE ALL ON FUNCTION push_staff_eligible(uuid) FROM PUBLIC;

-- Register (or take over) this browser's subscription for the calling session. The same browser
-- signed in as somebody else moves the device to that person. At most 10 devices per person; the
-- least recently refreshed ones are dropped.
CREATE FUNCTION push_register(endpoint_arg text,p256dh_arg text,auth_arg text,language_arg text,session_arg uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE me uuid:=app_user(); sub uuid;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 IF NOT EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=session_arg AND s.user_id=me
   AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.credential_version=u.password_version AND u.status='active')
  THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 IF NOT push_staff_eligible(me) THEN RAISE EXCEPTION 'NQ:FORBIDDEN'; END IF;
 INSERT INTO push_subscriptions(user_id,session_id,endpoint,p256dh,auth,language)
  VALUES(me,session_arg,endpoint_arg,p256dh_arg,auth_arg,CASE WHEN language_arg='en' THEN 'en' ELSE 'ar' END)
  ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,session_id=EXCLUDED.session_id,p256dh=EXCLUDED.p256dh,
   auth=EXCLUDED.auth,language=EXCLUDED.language,updated_at=clock_timestamp(),fail_count=0
  RETURNING id INTO sub;
 DELETE FROM push_subscriptions WHERE id IN (
  SELECT id FROM push_subscriptions WHERE user_id=me ORDER BY updated_at DESC,id OFFSET 10);
 RETURN sub;
END $$;
REVOKE ALL ON FUNCTION push_register(text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION push_register(text,text,text,text,uuid) TO nuqta_runtime;

-- Signing out removes the devices that session registered. Called by the auth role at logout.
CREATE FUNCTION push_unlink_session(session_arg uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE removed integer;
BEGIN
 DELETE FROM push_subscriptions WHERE session_id=session_arg;
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN removed;
END $$;
REVOKE ALL ON FUNCTION push_unlink_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION push_unlink_session(uuid) TO nuqta_auth;

-- The customer's own request enqueues the notification inside the same transaction that created it.
-- emitOutbox() cannot be used from a customer: outbox_events/background_jobs are staff-scoped by row
-- level security, so this narrow function writes the same two rows for exactly one case.
CREATE FUNCTION enqueue_cashier_push(request_arg uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r stamp_requests; eid uuid;
BEGIN
 SELECT * INTO r FROM stamp_requests WHERE id=request_arg AND user_id=app_user() AND status='pending';
 IF NOT FOUND THEN RETURN; END IF;
 INSERT INTO outbox_events(merchant_id,event_type,aggregate_id,payload,dedupe_key)
  VALUES(r.merchant_id,'stamp_request.created',r.id,jsonb_build_object('branchId',r.branch_id),'stamp-request-push:'||r.id)
  ON CONFLICT(dedupe_key) DO NOTHING RETURNING id INTO eid;
 IF eid IS NULL THEN SELECT id INTO eid FROM outbox_events WHERE dedupe_key='stamp-request-push:'||r.id; END IF;
 INSERT INTO background_jobs(merchant_id,outbox_id,kind) VALUES(r.merchant_id,eid,'cashier_push') ON CONFLICT(outbox_id,kind) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION enqueue_cashier_push(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enqueue_cashier_push(uuid) TO nuqta_runtime;

-- Who to ring for one stamp request. Evaluated at send time, not at request time, so a request that
-- was decided/expired meanwhile, a disabled or locked staff member, a removed branch grant, a
-- suspended business or a signed-out session all stop the notification. Returns only what is needed
-- to deliver: the device and the branch name (the notification text carries nothing else).
CREATE FUNCTION push_targets_for_stamp_request(request_arg uuid) RETURNS TABLE(sub_id uuid,endpoint text,p256dh text,auth text,language text,branch_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p.id,p.endpoint,p.p256dh,p.auth,p.language,b.name
 FROM stamp_requests r
 JOIN merchants m ON m.id=r.merchant_id AND m.status IN ('active','trial')
 JOIN branches b ON b.merchant_id=r.merchant_id AND b.id=r.branch_id AND b.status='active'
 JOIN staff_memberships s ON s.merchant_id=r.merchant_id AND s.role IN ('cashier','manager') AND s.status='active'
 JOIN staff_branch_grants g ON g.merchant_id=s.merchant_id AND g.staff_id=s.id AND g.branch_id=r.branch_id
 JOIN users u ON u.id=s.user_id AND u.status='active'
 JOIN push_subscriptions p ON p.user_id=u.id
 JOIN sessions se ON se.id=p.session_id AND se.user_id=u.id AND se.revoked_at IS NULL AND se.expires_at>clock_timestamp()
  AND se.credential_version=u.password_version
 WHERE r.id=request_arg AND r.status='pending' AND r.expires_at>clock_timestamp()
 ORDER BY p.id LIMIT 100
$$;
REVOKE ALL ON FUNCTION push_targets_for_stamp_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION push_targets_for_stamp_request(uuid) TO nuqta_worker;

-- Delivery outcome: success clears the failure count; a clean "gone" (404/410) forgets the device;
-- anything else counts, and ten failures in a row forget it too.
CREATE FUNCTION push_record_result(sub_arg uuid,delivered boolean,gone boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF gone THEN DELETE FROM push_subscriptions WHERE id=sub_arg;
 ELSIF delivered THEN UPDATE push_subscriptions SET last_push_at=clock_timestamp(),fail_count=0 WHERE id=sub_arg;
 ELSE
  UPDATE push_subscriptions SET fail_count=fail_count+1 WHERE id=sub_arg;
  DELETE FROM push_subscriptions WHERE id=sub_arg AND fail_count>=10;
 END IF;
END $$;
REVOKE ALL ON FUNCTION push_record_result(uuid,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION push_record_result(uuid,boolean,boolean) TO nuqta_worker;
