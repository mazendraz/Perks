-- Redeem by request: no QR, no scan.
--  * The customer taps Redeem; that writes a redeem request (a redemption_challenges row in the new
--    'requested' state) with a 2-digit match number, valid for 10 minutes. One open request per reward.
--  * The branch's staff are rung with the customer's first name, the reward and the match number. A
--    cashier confirms (the reward is consumed, a new card starts) or rejects (the reward stays).
-- Additive: two states, one column, relaxed NOT NULLs (an open request has no cashier yet), checks that
-- keep the cashier-started rows exactly as complete as before, one index and three functions. The
-- running release never writes 'requested' rows and keeps working during the restart window.

ALTER TABLE redemption_challenges DROP CONSTRAINT redemption_challenges_status_check;
ALTER TABLE redemption_challenges ADD CONSTRAINT redemption_challenges_status_check
 CHECK(status IN ('requested','awaiting_holder','confirmed','declined','rejected','cancelled','expired','completed'));
ALTER TABLE redemption_challenges
 ALTER COLUMN branch_id DROP NOT NULL,
 ALTER COLUMN staff_id DROP NOT NULL,
 ALTER COLUMN cashier_user_id DROP NOT NULL,
 ADD COLUMN match_number smallint CHECK(match_number BETWEEN 10 AND 99),
 ADD COLUMN decided_at timestamptz;
-- A cashier-started challenge (no match number) still names its branch, staff and cashier; a request
-- names them once a cashier decided it.
ALTER TABLE redemption_challenges ADD CONSTRAINT challenge_staff_present CHECK(
 (match_number IS NULL AND branch_id IS NOT NULL AND staff_id IS NOT NULL AND cashier_user_id IS NOT NULL)
 OR (match_number IS NOT NULL AND (status NOT IN ('completed','rejected')
  OR (branch_id IS NOT NULL AND staff_id IS NOT NULL AND cashier_user_id IS NOT NULL AND decided_at IS NOT NULL))));
-- One open redemption per reward, whichever way it started.
CREATE UNIQUE INDEX one_open_redeem_request ON redemption_challenges(reward_id)
 WHERE status IN ('requested','awaiting_holder','confirmed');
CREATE INDEX open_redeem_requests ON redemption_challenges(merchant_id,created_at) WHERE status='requested';

-- The customer's phone hears about its request only once a cashier decided it (the decision names the
-- branch). An open request has no branch yet and nothing to tell the holder that they do not know.
CREATE OR REPLACE FUNCTION notify_redemption_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.branch_id IS NULL THEN RETURN NEW;END IF;
 PERFORM pg_notify('nuqta_customer_activity',jsonb_build_object(
  'kind','challenge','id',NEW.id,'membershipId',NEW.membership_id,
  'merchantId',NEW.merchant_id,'branchId',NEW.branch_id,'userId',NEW.holder_user_id)::text);
 RETURN NEW;
END $$;

-- Queued by the customer's own session in the transaction that wrote the request, so a request that
-- rolls back rings nobody and one request rings once.
CREATE FUNCTION enqueue_redeem_request_push(request_arg uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ch redemption_challenges; eid uuid;
BEGIN
 SELECT * INTO ch FROM redemption_challenges WHERE id=request_arg AND holder_user_id=app_user() AND status='requested';
 IF NOT FOUND OR NOT customer_scope_ok(ch.merchant_id) THEN RETURN;END IF;
 INSERT INTO outbox_events(merchant_id,event_type,aggregate_id,payload,dedupe_key)
  VALUES(ch.merchant_id,'reward.request.push',ch.id,jsonb_build_object('kind','reward_request'),'reward-request-push:'||ch.id)
  ON CONFLICT(dedupe_key) DO NOTHING RETURNING id INTO eid;
 IF eid IS NULL THEN RETURN;END IF;
 INSERT INTO background_jobs(merchant_id,outbox_id,kind) VALUES(ch.merchant_id,eid,'cashier_push') ON CONFLICT(outbox_id,kind) DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION enqueue_redeem_request_push(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enqueue_redeem_request_push(uuid) TO nuqta_runtime;

-- Who to ring, read at send time: active staff, signed in on a live session, of the branch the
-- customer came through, or of every open branch where the reward can be handed over when that is not
-- known. Nobody once the request was decided, timed out or the customer was blocked.
CREATE FUNCTION push_targets_for_redeem_request(request_arg uuid)
RETURNS TABLE(sub_id uuid,endpoint text,p256dh text,auth text,language text,branch_name text,alias text,title text,match_number integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT DISTINCT ON (p.id) p.id,p.endpoint,p.p256dh,p.auth,p.language,b.name,cp.alias,g.title,ch.match_number::integer
 FROM redemption_challenges ch
 JOIN reward_grants g ON g.id=ch.reward_id AND g.merchant_id=ch.merchant_id AND g.status='available'
 JOIN memberships ms ON ms.id=ch.membership_id AND ms.merchant_id=ch.merchant_id
 JOIN tenant_customer_profiles cp ON cp.id=ms.profile_id AND cp.merchant_id=ms.merchant_id
 JOIN merchants m ON m.id=ch.merchant_id AND m.status IN ('active','trial')
 JOIN branches b ON b.merchant_id=ch.merchant_id AND b.status='active'
  AND (ch.branch_id IS NULL OR b.id=ch.branch_id) AND reward_redeemable_at(g,b.id)
 JOIN staff_memberships s ON s.merchant_id=ch.merchant_id AND s.role IN ('owner','manager','cashier') AND s.status='active'
 JOIN staff_branch_grants sg ON sg.merchant_id=s.merchant_id AND sg.staff_id=s.id AND sg.branch_id=b.id
 JOIN users u ON u.id=s.user_id AND u.status='active'
 JOIN push_subscriptions p ON p.user_id=u.id
 JOIN sessions se ON se.id=p.session_id AND se.user_id=u.id AND se.revoked_at IS NULL AND se.expires_at>clock_timestamp()
  AND se.credential_version=u.password_version
 WHERE ch.id=request_arg AND ch.status='requested' AND ch.match_number IS NOT NULL AND ch.expires_at>clock_timestamp()
  AND NOT customer_blocked(ch.merchant_id,ch.holder_user_id)
 ORDER BY p.id LIMIT 100
$$;
REVOKE ALL ON FUNCTION push_targets_for_redeem_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION push_targets_for_redeem_request(uuid) TO nuqta_worker;
