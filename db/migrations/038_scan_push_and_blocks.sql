-- Scan → stamp redesign.
--  * A cashier push for every customer scan, in both modes (request to approve, or stamp added).
--  * Approval is a receipt number typed by the cashier: free text, kept with the stamp, never unique.
--  * Per-merchant customer blocks with a Spam list (attempts, last attempt), enforced in the database.
--  * A redeemed reward can never be undone through a revoke, for any role.
--  * A per customer, per merchant scan rate limit and a 60-second duplicate floor for automatic stamps.
-- Additive: nothing is dropped and no existing row changes. Functions the running release still calls
-- (push_targets_for_stamp_request, enqueue_cashier_push) are left in place for the restart window.

-- 1. Blocks. One open block per (merchant, customer); an unblock closes it and keeps the history.
CREATE TABLE customer_blocks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 user_id uuid NOT NULL REFERENCES users(id),
 origin text NOT NULL CHECK(origin IN ('auto_stamp','request','manual')),
 origin_id uuid,
 blocked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 blocked_by uuid NOT NULL REFERENCES users(id),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 last_attempt_at timestamptz,
 unblocked_at timestamptz,
 unblocked_by uuid REFERENCES users(id),
 CONSTRAINT unblock_complete CHECK((unblocked_at IS NULL)=(unblocked_by IS NULL))
);
CREATE UNIQUE INDEX one_open_customer_block ON customer_blocks(merchant_id,user_id) WHERE unblocked_at IS NULL;
CREATE INDEX customer_spam_list ON customer_blocks(merchant_id,blocked_at DESC) WHERE unblocked_at IS NULL;
ALTER TABLE customer_blocks ENABLE ROW LEVEL SECURITY;
-- Staff of the shop read the list. Every write goes through the functions below.
CREATE POLICY customer_blocks_read ON customer_blocks FOR SELECT TO nuqta_runtime USING(tenant_access(merchant_id));
GRANT SELECT ON customer_blocks TO nuqta_runtime;

CREATE FUNCTION customer_blocked(mid uuid,uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM customer_blocks WHERE merchant_id=mid AND user_id=uid AND unblocked_at IS NULL)
$$;
REVOKE ALL ON FUNCTION customer_blocked(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION customer_blocked(uuid,uuid) TO nuqta_runtime,nuqta_worker;

-- The customer's own scan at a shop that blocked them: count it on the open block. True when blocked.
CREATE FUNCTION note_blocked_attempt(mid uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE customer_blocks SET attempts=attempts+1,last_attempt_at=clock_timestamp()
  WHERE merchant_id=mid AND user_id=app_user() AND unblocked_at IS NULL AND customer_scope_ok(mid);
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION note_blocked_attempt(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION note_blocked_attempt(uuid) TO nuqta_runtime;

-- Any active staff member of the shop (cashier, manager, owner) blocks the customer behind a card.
-- A pending request from that customer is closed so nobody approves it afterwards. Audited.
CREATE FUNCTION block_customer(member_arg uuid,origin_arg text,origin_id_arg uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ms memberships; staff staff_memberships; block uuid; closed integer; created boolean;
BEGIN
 SELECT * INTO ms FROM memberships WHERE id=member_arg;
 IF NOT FOUND OR NOT tenant_access(ms.merchant_id) THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 staff:=acting_staff(ms.merchant_id);
 IF staff.id IS NULL THEN RAISE EXCEPTION 'NQ:FORBIDDEN';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-block:'||ms.merchant_id::text||':'||ms.user_id::text,0));
 INSERT INTO customer_blocks(merchant_id,user_id,origin,origin_id,blocked_by)
  VALUES(ms.merchant_id,ms.user_id,coalesce(origin_arg,'manual'),origin_id_arg,app_user())
  ON CONFLICT DO NOTHING RETURNING id INTO block;
 WITH r AS (
  UPDATE stamp_requests SET status='rejected',reason='BLOCKED',decided_by=app_user(),decided_at=clock_timestamp()
  WHERE merchant_id=ms.merchant_id AND user_id=ms.user_id AND status='pending' RETURNING id
 ), e AS (
  INSERT INTO stamp_request_events(merchant_id,request_id,actor_id,action) SELECT ms.merchant_id,id,app_user(),'rejected' FROM r RETURNING 1
 ) SELECT count(*) INTO closed FROM e;
 created:=block IS NOT NULL;
 IF created THEN
  INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail) VALUES(app_user(),ms.merchant_id,'customer.block',ms.user_id,
   jsonb_build_object('blockId',block,'staffId',staff.id,'role',staff.role,'membershipId',ms.id,'origin',coalesce(origin_arg,'manual'),
    'originId',origin_id_arg,'closedRequests',closed));
 ELSE
  SELECT id INTO block FROM customer_blocks WHERE merchant_id=ms.merchant_id AND user_id=ms.user_id AND unblocked_at IS NULL;
 END IF;
 RETURN jsonb_build_object('blockId',block,'blocked',true,'changed',created);
END $$;
REVOKE ALL ON FUNCTION block_customer(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION block_customer(uuid,text,uuid) TO nuqta_runtime;

CREATE FUNCTION unblock_customer(block_arg uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE b customer_blocks; staff staff_memberships;
BEGIN
 SELECT * INTO b FROM customer_blocks WHERE id=block_arg FOR UPDATE;
 IF NOT FOUND OR NOT tenant_access(b.merchant_id) THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 staff:=acting_staff(b.merchant_id);
 IF staff.id IS NULL THEN RAISE EXCEPTION 'NQ:FORBIDDEN';END IF;
 IF b.unblocked_at IS NOT NULL THEN RETURN jsonb_build_object('blockId',b.id,'blocked',false,'changed',false);END IF;
 UPDATE customer_blocks SET unblocked_at=clock_timestamp(),unblocked_by=app_user() WHERE id=b.id;
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail) VALUES(app_user(),b.merchant_id,'customer.unblock',b.user_id,
  jsonb_build_object('blockId',b.id,'staffId',staff.id,'role',staff.role,'attempts',b.attempts));
 RETURN jsonb_build_object('blockId',b.id,'blocked',false,'changed',true);
END $$;
REVOKE ALL ON FUNCTION unblock_customer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unblock_customer(uuid) TO nuqta_runtime;

-- 2. The receipt number typed on approval. Stored as typed (trimmed); duplicates are allowed and only
-- warned about, so an approved request no longer needs a purchase_references row (that one is unique).
ALTER TABLE stamp_requests ADD COLUMN receipt_note text CHECK(receipt_note IS NULL OR length(receipt_note) BETWEEN 1 AND 120);
ALTER TABLE loyalty_transactions ADD COLUMN receipt_note text CHECK(receipt_note IS NULL OR length(receipt_note) BETWEEN 1 AND 120);
ALTER TABLE loyalty_transactions DROP CONSTRAINT loyalty_transactions_check;
ALTER TABLE loyalty_transactions ADD CONSTRAINT loyalty_transactions_check CHECK(type<>'award' OR (quantity>0 AND
 (purchase_id IS NOT NULL OR source IN ('auto','welcome') OR (source='request' AND receipt_note IS NOT NULL))));
-- "This receipt was already used" looks receipts up by shop, case and spacing aside.
CREATE INDEX receipt_note_lookup ON loyalty_transactions(merchant_id,lower(receipt_note)) WHERE receipt_note IS NOT NULL;

-- 3. New outcomes in the scan log.
ALTER TABLE stamp_collection_checks DROP CONSTRAINT stamp_collection_checks_outcome_check;
ALTER TABLE stamp_collection_checks ADD CONSTRAINT stamp_collection_checks_outcome_check
 CHECK(outcome IN ('awarded','pending','location_required','location_inaccurate','outside_zone','limit_reached','cooldown','busy','blocked',
  'spam_blocked','rate_limited','duplicate'));

-- 4. Scan rate limit per customer per merchant: 6 scans in 10 minutes, 30 in 24 hours. Each allowed scan
-- is counted before anything else happens; the advisory lock makes parallel taps queue, so they cannot
-- all read the same count. A refused scan is not counted, so waiting is enough to get back in.
CREATE TABLE scan_attempts (
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 user_id uuid NOT NULL REFERENCES users(id),
 at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX scan_attempts_window ON scan_attempts(merchant_id,user_id,at);
ALTER TABLE scan_attempts ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION scan_attempt_allowed(mid uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE me uuid:=app_user(); recent integer; daily integer;
BEGIN
 IF me IS NULL THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('scan-rate:'||mid::text||':'||me::text,0));
 DELETE FROM scan_attempts WHERE merchant_id=mid AND user_id=me AND at<=clock_timestamp()-interval '24 hours';
 SELECT count(*) FILTER (WHERE at>clock_timestamp()-interval '10 minutes'),count(*) INTO recent,daily
  FROM scan_attempts WHERE merchant_id=mid AND user_id=me;
 IF recent>=6 OR daily>=30 THEN RETURN false;END IF;
 INSERT INTO scan_attempts(merchant_id,user_id) VALUES(mid,me);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION scan_attempt_allowed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scan_attempt_allowed(uuid) TO nuqta_runtime;

-- 5. Enforcement inside the stamp functions, not only in the API.
CREATE OR REPLACE FUNCTION pg_temp.patch_function(sig regprocedure,old_text text,new_text text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE def text;n integer;
BEGIN
 def:=pg_get_functiondef(sig);
 n:=(length(def)-length(replace(def,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'patch_function %: expected exactly one match, found %',sig,n;END IF;
 EXECUTE replace(def,old_text,new_text);
END $$;
-- Automatic stamp, under the card lock: a blocked customer gets nothing, and one card never gets two
-- scan stamps within 60 seconds (a double tap or a replay with a fresh key).
SELECT pg_temp.patch_function('collect_stamp_automatically(uuid,uuid,uuid)',
 'PERFORM 1 FROM loyalty_accounts WHERE membership_id=ms.id FOR UPDATE;',
 'PERFORM 1 FROM loyalty_accounts WHERE membership_id=ms.id FOR UPDATE;
 IF customer_blocked(ms.merchant_id,ms.user_id) THEN RETURN jsonb_build_object(''eligible'',false,''reason'',''spam_blocked'');END IF;
 IF EXISTS(SELECT 1 FROM loyalty_transactions WHERE membership_id=ms.id AND type=''award'' AND source IN (''auto'',''request'',''scan'')
  AND at>clock_timestamp()-interval ''60 seconds'') THEN RETURN jsonb_build_object(''eligible'',false,''reason'',''duplicate'');END IF;');
-- Revoke: refused for every role once the stamp counted toward a reward that was redeemed, that is a
-- reward completed by this stamp's own transaction or by a later one on the same card.
SELECT pg_temp.patch_function('revoke_auto_stamp(uuid,uuid,text)',
 'IF staff.role=''cashier'' AND EXISTS(SELECT 1 FROM reward_grants WHERE earned_transaction_id=t.id AND status=''redeemed'')',
 'IF EXISTS(SELECT 1 FROM reward_grants g JOIN loyalty_transactions e ON e.id=g.earned_transaction_id
   WHERE g.membership_id=t.membership_id AND g.status=''redeemed'' AND e.sequence>=t.sequence)');

-- 6. Push in both modes. Owners can now register a phone and are rung too (D5).
CREATE OR REPLACE FUNCTION push_staff_eligible(uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id
  WHERE s.user_id=uid AND s.role IN ('owner','manager','cashier') AND s.status='active' AND u.status='active')
$$;
-- Queued by the customer's own session in the transaction that wrote the automatic stamp, so a stamp
-- that rolls back never rings a phone and one stamp rings at most once.
CREATE FUNCTION enqueue_auto_stamp_push(tx_arg uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t loyalty_transactions; eid uuid;
BEGIN
 SELECT lt.* INTO t FROM loyalty_transactions lt JOIN memberships ms ON ms.id=lt.membership_id AND ms.merchant_id=lt.merchant_id
  WHERE lt.id=tx_arg AND lt.type='award' AND lt.source='auto' AND ms.user_id=app_user();
 IF NOT FOUND OR NOT customer_scope_ok(t.merchant_id) THEN RETURN; END IF;
 INSERT INTO outbox_events(merchant_id,event_type,aggregate_id,payload,dedupe_key)
  VALUES(t.merchant_id,'auto_stamp.created',t.id,jsonb_build_object('branchId',t.branch_id,'kind','auto_stamp'),'auto-stamp-push:'||t.id)
  ON CONFLICT(dedupe_key) DO NOTHING RETURNING id INTO eid;
 IF eid IS NULL THEN RETURN; END IF;
 INSERT INTO background_jobs(merchant_id,outbox_id,kind) VALUES(t.merchant_id,eid,'cashier_push') ON CONFLICT(outbox_id,kind) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION enqueue_auto_stamp_push(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enqueue_auto_stamp_push(uuid) TO nuqta_runtime;

-- Who to ring for a request or an automatic stamp, read at send time. Adds the customer's name so the
-- notice can show the first name (D4); the worker trims it. A blocked customer rings nobody.
CREATE FUNCTION push_targets_for_scan(kind_arg text,id_arg uuid)
RETURNS TABLE(sub_id uuid,endpoint text,p256dh text,auth text,language text,branch_name text,alias text,quantity integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH src AS (
  SELECT r.merchant_id,r.branch_id,r.user_id,r.membership_id,NULL::integer AS quantity FROM stamp_requests r
   WHERE kind_arg='request' AND r.id=id_arg AND r.status='pending' AND r.expires_at>clock_timestamp()
  UNION ALL
  SELECT t.merchant_id,t.branch_id,ms.user_id,t.membership_id,t.quantity FROM loyalty_transactions t
   JOIN memberships ms ON ms.id=t.membership_id AND ms.merchant_id=t.merchant_id
   WHERE kind_arg='auto_stamp' AND t.id=id_arg AND t.type='award' AND t.source='auto' AND t.at>clock_timestamp()-interval '30 minutes'
 )
 SELECT p.id,p.endpoint,p.p256dh,p.auth,p.language,b.name,cp.alias,src.quantity
 FROM src
 JOIN memberships ms ON ms.id=src.membership_id AND ms.merchant_id=src.merchant_id
 JOIN tenant_customer_profiles cp ON cp.id=ms.profile_id AND cp.merchant_id=ms.merchant_id
 JOIN merchants m ON m.id=src.merchant_id AND m.status IN ('active','trial')
 JOIN branches b ON b.merchant_id=src.merchant_id AND b.id=src.branch_id AND b.status='active'
 JOIN staff_memberships s ON s.merchant_id=src.merchant_id AND s.role IN ('owner','manager','cashier') AND s.status='active'
 JOIN staff_branch_grants g ON g.merchant_id=s.merchant_id AND g.staff_id=s.id AND g.branch_id=src.branch_id
 JOIN users u ON u.id=s.user_id AND u.status='active'
 JOIN push_subscriptions p ON p.user_id=u.id
 JOIN sessions se ON se.id=p.session_id AND se.user_id=u.id AND se.revoked_at IS NULL AND se.expires_at>clock_timestamp()
  AND se.credential_version=u.password_version
 WHERE NOT customer_blocked(src.merchant_id,src.user_id)
 ORDER BY p.id LIMIT 100
$$;
REVOKE ALL ON FUNCTION push_targets_for_scan(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION push_targets_for_scan(text,uuid) TO nuqta_worker;
