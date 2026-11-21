-- The full card → reward → redeem → next card cycle.
--  * A customer's Redeem QR names the reward it is for, so the cashier lands on that reward.
--  * The branch's staff are rung when a card fills and when a reward is redeemed, from every path
--    that earns or redeems (cashier scan, receipt approval, automatic, welcome), because the bell is
--    queued by the reward event itself in the same transaction.
--  * Any card holding a full card's worth of stamps without a reward is completed into rewards,
--    keeping every stamp: the remainder stays on the card for the next cycle.
-- Additive: one nullable column, new functions and one trigger. No existing row changes except the
-- repair below, which only appends (rewards, ledger rows, events) and lowers a balance by exactly the
-- stamps it turned into rewards. The running release ignores all of it during the restart window.

-- 1. Reward-bound Redeem QR.
ALTER TABLE presentation_tokens ADD COLUMN reward_id uuid;
ALTER TABLE presentation_tokens ADD CONSTRAINT presentation_reward_tenant
 FOREIGN KEY(merchant_id,reward_id) REFERENCES reward_grants(merchant_id,id);

-- 2. Cashier pushes for a filled card and a redeemed reward.
CREATE FUNCTION enqueue_reward_push() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE eid uuid; push_kind text:=CASE NEW.event_type WHEN 'earned' THEN 'reward_earned' ELSE 'reward_redeemed' END;
BEGIN
 -- The one-off repair below completes cards that were already full; nobody is standing at a till.
 IF current_setting('nuqta.quiet_reward_push',true)='on' THEN RETURN NEW;END IF;
 INSERT INTO outbox_events(merchant_id,event_type,aggregate_id,payload,dedupe_key)
  VALUES(NEW.merchant_id,'reward.'||NEW.event_type||'.push',NEW.reward_id,
   jsonb_build_object('kind',push_kind,'transactionId',NEW.transaction_id),'reward-push:'||NEW.event_type||':'||NEW.reward_id)
  ON CONFLICT(dedupe_key) DO NOTHING RETURNING id INTO eid;
 IF eid IS NOT NULL THEN
  INSERT INTO background_jobs(merchant_id,outbox_id,kind) VALUES(NEW.merchant_id,eid,'cashier_push') ON CONFLICT(outbox_id,kind) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION enqueue_reward_push() FROM PUBLIC;
CREATE TRIGGER reward_cashier_push AFTER INSERT ON reward_events FOR EACH ROW
 WHEN (NEW.event_type IN ('earned','redeemed')) EXECUTE FUNCTION enqueue_reward_push();

-- Who to ring, read at send time: the staff of the branch where the card filled (the earning
-- transaction's branch) or where the reward was handed over. Same rules as a scan notice: active staff
-- with that branch, signed in on a live session, at a shop that is running; a blocked customer rings
-- nobody. A card that filled and was redeemed or voided before the push went out rings for "full" no more.
CREATE FUNCTION push_targets_for_reward(kind_arg text,reward_arg uuid)
RETURNS TABLE(sub_id uuid,endpoint text,p256dh text,auth text,language text,branch_name text,alias text,title text,cycle_number integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH src AS (
  SELECT g.merchant_id,g.membership_id,g.title,t.branch_id FROM reward_grants g
   JOIN loyalty_transactions t ON t.id=g.earned_transaction_id AND t.merchant_id=g.merchant_id
   WHERE kind_arg='reward_earned' AND g.id=reward_arg AND g.status='available' AND g.earned_at>clock_timestamp()-interval '30 minutes'
  UNION ALL
  SELECT g.merchant_id,g.membership_id,g.title,t.branch_id FROM reward_grants g
   JOIN reward_redemptions rd ON rd.reward_id=g.id
   JOIN loyalty_transactions t ON t.id=rd.transaction_id AND t.merchant_id=g.merchant_id
   WHERE kind_arg='reward_redeemed' AND g.id=reward_arg AND rd.at>clock_timestamp()-interval '30 minutes'
 )
 SELECT p.id,p.endpoint,p.p256dh,p.auth,p.language,b.name,cp.alias,src.title,a.cycle_number
 FROM src
 JOIN memberships ms ON ms.id=src.membership_id AND ms.merchant_id=src.merchant_id
 JOIN loyalty_accounts a ON a.membership_id=ms.id
 JOIN tenant_customer_profiles cp ON cp.id=ms.profile_id AND cp.merchant_id=ms.merchant_id
 JOIN merchants m ON m.id=src.merchant_id AND m.status IN ('active','trial')
 JOIN branches b ON b.merchant_id=src.merchant_id AND b.id=src.branch_id AND b.status='active'
 JOIN staff_memberships s ON s.merchant_id=src.merchant_id AND s.role IN ('owner','manager','cashier') AND s.status='active'
 JOIN staff_branch_grants g ON g.merchant_id=s.merchant_id AND g.staff_id=s.id AND g.branch_id=src.branch_id
 JOIN users u ON u.id=s.user_id AND u.status='active'
 JOIN push_subscriptions p ON p.user_id=u.id
 JOIN sessions se ON se.id=p.session_id AND se.user_id=u.id AND se.revoked_at IS NULL AND se.expires_at>clock_timestamp()
  AND se.credential_version=u.password_version
 WHERE NOT customer_blocked(src.merchant_id,ms.user_id)
 ORDER BY p.id LIMIT 100
$$;
REVOKE ALL ON FUNCTION push_targets_for_reward(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION push_targets_for_reward(text,uuid) TO nuqta_worker;

-- 3. Where a reward can be handed over: a branch it was earned for, or, when every one of those
-- branches has since closed, any open branch of the same shop. Otherwise such a reward could never be
-- redeemed and the card would stay full for good.
CREATE FUNCTION reward_redeemable_at(g reward_grants,branch_arg uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT branch_arg=ANY(g.branch_ids) OR (
  EXISTS(SELECT 1 FROM branches WHERE merchant_id=g.merchant_id AND id=branch_arg AND status='active')
  AND NOT EXISTS(SELECT 1 FROM branches b WHERE b.merchant_id=g.merchant_id AND b.id=ANY(g.branch_ids) AND b.status='active'))
$$;
REVOKE ALL ON FUNCTION reward_redeemable_at(reward_grants,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reward_redeemable_at(reward_grants,uuid) TO nuqta_runtime;

-- 4. Cards holding a full card's worth of stamps with no reward for them. No current path leaves a
-- card like this, but one that did could never move on: the card would sit full with nothing to
-- redeem. Each full card's worth becomes a reward on the card's own program version, attached to the
-- card's latest earning transaction (whose stamps completed it), with the matching ledger consumption,
-- an 'earned' event and an audit row. Stamps beyond the last full card stay on the card. Idempotent:
-- a second run finds nothing. Returns the number of rewards created.
CREATE FUNCTION repair_full_cards() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE acc record; tx loyalty_transactions; n integer; i integer; next_ordinal integer; reward uuid; total integer:=0; branches_list uuid[];
BEGIN
 PERFORM set_config('nuqta.quiet_reward_push','on',true);
 FOR acc IN
  SELECT a.membership_id,a.merchant_id,a.program_version_id,a.balance,v.threshold,v.reward_title,v.reward_terms,v.validity_days,ms.user_id
  FROM loyalty_accounts a JOIN program_versions v ON v.id=a.program_version_id JOIN memberships ms ON ms.id=a.membership_id
  WHERE a.balance>=v.threshold ORDER BY a.membership_id FOR UPDATE OF a
 LOOP
  SELECT * INTO tx FROM loyalty_transactions WHERE membership_id=acc.membership_id AND type='award' AND program_version_id=acc.program_version_id
   ORDER BY sequence DESC LIMIT 1;
  IF NOT FOUND THEN CONTINUE;END IF;
  n:=acc.balance/acc.threshold;
  SELECT coalesce(max(ordinal),0) INTO next_ordinal FROM reward_grants WHERE earned_transaction_id=tx.id;
  SELECT coalesce(array_agg(branch_id),'{}') INTO branches_list FROM program_branches WHERE merchant_id=acc.merchant_id AND program_version_id=acc.program_version_id;
  FOR i IN 1..n LOOP
   INSERT INTO reward_grants(merchant_id,membership_id,program_version_id,earned_transaction_id,ordinal,threshold,title,terms,branch_ids,expires_at)
    VALUES(acc.merchant_id,acc.membership_id,acc.program_version_id,tx.id,next_ordinal+i,acc.threshold,acc.reward_title,acc.reward_terms,branches_list,
     clock_timestamp()+acc.validity_days*interval '1 day') RETURNING id INTO reward;
   INSERT INTO ledger_entries(merchant_id,membership_id,transaction_id,program_version_id,type,amount,reward_id)
    VALUES(acc.merchant_id,acc.membership_id,tx.id,acc.program_version_id,'reward_consumption',-acc.threshold,reward);
   INSERT INTO reward_events(merchant_id,reward_id,event_type,actor_id,transaction_id) VALUES(acc.merchant_id,reward,'earned',NULL,tx.id);
  END LOOP;
  UPDATE loyalty_accounts SET balance=acc.balance-n*acc.threshold,revision=revision+1 WHERE membership_id=acc.membership_id;
  INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail) VALUES(acc.user_id,acc.merchant_id,'reward.repair',acc.membership_id,
   jsonb_build_object('system',true,'rewards',n,'balanceBefore',acc.balance,'balanceAfter',acc.balance-n*acc.threshold,'transactionId',tx.id));
  UPDATE wallet_passes SET fingerprint='' WHERE membership_id=acc.membership_id;
  UPDATE google_wallet_objects SET fingerprint='' WHERE membership_id=acc.membership_id;
  total:=total+n;
 END LOOP;
 PERFORM set_config('nuqta.quiet_reward_push','off',true);
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION repair_full_cards() FROM PUBLIC;
SELECT repair_full_cards();
