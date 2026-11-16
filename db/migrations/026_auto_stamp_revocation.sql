-- Staff can take back a stamp nobody approved (automatic or welcome) and owners/managers can reset a card.
-- Nothing is deleted: a revoke is a compensating correction of one automatic stamp, a reset is one
-- 'reset' ledger row that brings the balance to zero. Redeemed rewards always stay in the history.

-- How long a cashier may revoke an automatic stamp at their own branch. Owners and managers get 7 days.
ALTER TABLE stamp_collection_settings ADD COLUMN revoke_window_minutes integer NOT NULL DEFAULT 30
 CHECK(revoke_window_minutes BETWEEN 5 AND 1440);

-- A card that abused automatic collection can be sent back to the cashier. Cashier stamps still work.
ALTER TABLE memberships ADD COLUMN auto_collect_blocked_at timestamptz,
 ADD COLUMN auto_collect_blocked_by uuid REFERENCES users(id),
 ADD CONSTRAINT auto_collect_block_complete CHECK(auto_collect_blocked_at IS NOT NULL OR auto_collect_blocked_by IS NULL);

-- Corrections now come in three kinds. A reset belongs to the card, not to one transaction.
ALTER TABLE correction_requests ADD COLUMN kind text NOT NULL DEFAULT 'manual' CHECK(kind IN ('manual','revoke','reset'));
ALTER TABLE correction_requests ALTER COLUMN original_transaction_id DROP NOT NULL;
ALTER TABLE correction_requests DROP CONSTRAINT correction_requests_requested_delta_check;
ALTER TABLE correction_requests ADD CONSTRAINT correction_delta_by_kind CHECK(
 (kind='manual' AND requested_delta<>0 AND abs(requested_delta)<=100)
 OR (kind='revoke' AND requested_delta<0 AND abs(requested_delta)<=100)
 OR (kind='reset' AND requested_delta<=0));
ALTER TABLE correction_requests ADD CONSTRAINT correction_original_by_kind CHECK((kind='reset')=(original_transaction_id IS NULL));

-- Transaction and ledger shapes for the two new corrections.
ALTER TABLE loyalty_transactions DROP CONSTRAINT loyalty_transactions_source_check;
ALTER TABLE loyalty_transactions ADD CONSTRAINT loyalty_transactions_source_check
 CHECK(source IN ('scan','request','correction','redemption','auto','welcome','revoke','reset'));
-- Unnamed table checks are found by their definition; exactly one must match each.
CREATE OR REPLACE FUNCTION pg_temp.drop_check(tbl regclass,pattern text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE names text[];
BEGIN
 SELECT array_agg(conname) INTO names FROM pg_constraint WHERE conrelid=tbl AND contype='c' AND pg_get_constraintdef(oid) LIKE pattern;
 IF coalesce(array_length(names,1),0)<>1 THEN RAISE EXCEPTION 'drop_check %: expected one constraint matching %, found %',tbl,pattern,names;END IF;
 EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',tbl,names[1]);
END $$;
SELECT pg_temp.drop_check('loyalty_transactions','%type <> ''correction''::text%original_transaction_id IS NOT NULL%');
SELECT pg_temp.drop_check('ledger_entries','%reward_consumption%compensation%compensates_entry_id IS NOT NULL%');
ALTER TABLE loyalty_transactions ADD CONSTRAINT correction_has_original
 CHECK(type<>'correction' OR original_transaction_id IS NOT NULL OR source='reset');
ALTER TABLE loyalty_transactions ADD CONSTRAINT revoke_and_reset_are_corrections
 CHECK(source NOT IN ('revoke','reset') OR type='correction');
ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_type_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_type_check CHECK(type IN ('earn','reward_consumption','compensation','reset'));
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entry_shape CHECK(
 (type='earn' AND amount>0 AND reward_id IS NULL AND compensates_entry_id IS NULL)
 OR (type='reward_consumption' AND amount<0 AND reward_id IS NOT NULL AND compensates_entry_id IS NULL)
 OR (type='compensation' AND compensates_entry_id IS NOT NULL)
 OR (type='reset' AND amount<0 AND reward_id IS NULL AND compensates_entry_id IS NULL));

ALTER TABLE stamp_collection_checks DROP CONSTRAINT stamp_collection_checks_outcome_check;
ALTER TABLE stamp_collection_checks ADD CONSTRAINT stamp_collection_checks_outcome_check
 CHECK(outcome IN ('awarded','pending','location_required','location_inaccurate','outside_zone','limit_reached','cooldown','busy','blocked'));

-- The caller's active staff row at a merchant, or nothing.
CREATE FUNCTION acting_staff(mid uuid) RETURNS staff_memberships LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT s.* FROM staff_memberships s JOIN users u ON u.id=s.user_id
 WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.status='active' AND u.status='active'
$$;
REVOKE ALL ON FUNCTION acting_staff(uuid) FROM PUBLIC;

-- Installed Apple/Google passes are pushed on the next worker pass, whatever the visible change.
CREATE FUNCTION invalidate_wallet_cards(member_arg uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 UPDATE wallet_passes SET fingerprint='' WHERE membership_id=member_arg;
 UPDATE google_wallet_objects SET fingerprint='' WHERE membership_id=member_arg;
$$;
REVOKE ALL ON FUNCTION invalidate_wallet_cards(uuid) FROM PUBLIC;

-- Voids a set of available rewards and closes any redemption waiting on them.
CREATE FUNCTION void_rewards(mid uuid,reward_ids uuid[],tx_arg uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 UPDATE reward_grants SET status='voided' WHERE merchant_id=mid AND id=ANY(reward_ids) AND status='available';
 INSERT INTO reward_events(merchant_id,reward_id,event_type,actor_id,transaction_id)
  SELECT mid,r,'voided',app_user(),tx_arg FROM unnest(reward_ids) r;
 UPDATE redemption_challenges SET status='cancelled' WHERE merchant_id=mid AND reward_id=ANY(reward_ids) AND status IN ('awaiting_holder','confirmed');
$$;
REVOKE ALL ON FUNCTION void_rewards(uuid,uuid[],uuid) FROM PUBLIC;

-- Takes back one automatic or welcome stamp. Cashiers: own branch, within the shop's window, never
-- once its reward was redeemed. Owners/managers: their branches, within 7 days; a redeemed reward
-- stays redeemed and only the stamp itself comes off the balance.
CREATE FUNCTION revoke_auto_stamp(tx_arg uuid,operation_arg uuid,reason_arg text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t loyalty_transactions; staff staff_memberships; s stamp_collection_settings; account loyalty_accounts;
 voiding uuid[]; delta integer; new_balance integer; new_revision integer; ctx uuid:=gen_random_uuid(); corr uuid:=gen_random_uuid();
 reference text; result jsonb;
BEGIN
 SELECT * INTO t FROM loyalty_transactions WHERE id=tx_arg;
 IF NOT FOUND OR NOT tenant_access(t.merchant_id) THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 staff:=acting_staff(t.merchant_id);
 IF staff.id IS NULL THEN RAISE EXCEPTION 'NQ:FORBIDDEN';END IF;
 IF length(btrim(coalesce(reason_arg,'')))<4 THEN RAISE EXCEPTION 'NQ:REASON_REQUIRED';END IF;
 IF t.type<>'award' OR t.source NOT IN ('auto','welcome') THEN RAISE EXCEPTION 'NQ:NOT_AUTOMATIC_STAMP';END IF;
 IF NOT branch_access(t.merchant_id,t.branch_id) THEN RAISE EXCEPTION 'NQ:BRANCH_UNAUTHORIZED';END IF;
 IF NOT EXISTS(SELECT 1 FROM operations WHERE id=operation_arg AND actor_id=app_user() AND merchant_id=t.merchant_id AND status='processing') THEN RAISE EXCEPTION 'NQ:FORBIDDEN';END IF;
 SELECT * INTO account FROM loyalty_accounts WHERE membership_id=t.membership_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM correction_requests WHERE original_transaction_id=t.id AND status='applied') THEN RAISE EXCEPTION 'NQ:ALREADY_REVERSED';END IF;
 SELECT * INTO s FROM stamp_collection_settings WHERE merchant_id=t.merchant_id;
 IF clock_timestamp()>t.at+CASE WHEN staff.role='cashier' THEN s.revoke_window_minutes*interval '1 minute' ELSE interval '7 days' END
  THEN RAISE EXCEPTION 'NQ:REVOKE_WINDOW_CLOSED';END IF;
 -- A reset after this stamp already took it away.
 IF EXISTS(SELECT 1 FROM loyalty_transactions r WHERE r.membership_id=t.membership_id AND r.source='reset' AND r.sequence>t.sequence)
  THEN RAISE EXCEPTION 'NQ:CARD_RESET_SINCE';END IF;
 PERFORM 1 FROM reward_grants WHERE earned_transaction_id=t.id FOR UPDATE;
 IF staff.role='cashier' AND EXISTS(SELECT 1 FROM reward_grants WHERE earned_transaction_id=t.id AND status='redeemed')
  THEN RAISE EXCEPTION 'NQ:REWARD_ALREADY_REDEEMED';END IF;
 SELECT coalesce(array_agg(id ORDER BY ordinal),'{}') INTO voiding FROM reward_grants WHERE earned_transaction_id=t.id AND status='available';
 -- The stamp's own ledger rows come back, plus the consumption of each reward that is voided now.
 SELECT coalesce(sum(-e.amount),0) INTO delta FROM ledger_entries e
  WHERE e.transaction_id=t.id AND (e.type='earn' OR (e.type='reward_consumption' AND e.reward_id=ANY(voiding)))
  AND NOT EXISTS(SELECT 1 FROM ledger_entries c WHERE c.compensates_entry_id=e.id);
 new_balance:=account.balance+delta;
 IF new_balance<0 THEN RAISE EXCEPTION 'NQ:BALANCE_TOO_LOW';END IF;
 reference:='TX-'||upper(substr(ctx::text,1,8))||'-'||upper(substr(ctx::text,10,4));
 INSERT INTO loyalty_transactions(id,public_reference,merchant_id,membership_id,program_version_id,branch_id,staff_id,operation_id,type,quantity,source,original_transaction_id)
  VALUES(ctx,reference,t.merchant_id,t.membership_id,t.program_version_id,t.branch_id,staff.id,operation_arg,'correction',-t.quantity,'revoke',t.id);
 INSERT INTO ledger_entries(merchant_id,membership_id,transaction_id,program_version_id,type,amount,reward_id,compensates_entry_id)
  SELECT e.merchant_id,e.membership_id,ctx,e.program_version_id,'compensation',-e.amount,e.reward_id,e.id FROM ledger_entries e
  WHERE e.transaction_id=t.id AND (e.type='earn' OR (e.type='reward_consumption' AND e.reward_id=ANY(voiding)))
  AND NOT EXISTS(SELECT 1 FROM ledger_entries c WHERE c.compensates_entry_id=e.id) ORDER BY e.sequence;
 PERFORM void_rewards(t.merchant_id,voiding,ctx);
 UPDATE loyalty_accounts SET balance=new_balance,revision=revision+1 WHERE membership_id=t.membership_id RETURNING revision INTO new_revision;
 -- A manual correction still waiting on this stamp is now moot.
 WITH closed AS (
  UPDATE correction_requests SET status='rejected',decided_by=app_user(),decision_reason='SUPERSEDED_BY_REVOKE',decided_at=clock_timestamp()
  WHERE original_transaction_id=t.id AND status IN ('pending','needs_review') RETURNING id,merchant_id
 ) INSERT INTO correction_events(merchant_id,correction_id,actor_id,action,reason) SELECT merchant_id,id,app_user(),'superseded','SUPERSEDED_BY_REVOKE' FROM closed;
 result:=jsonb_build_object('status','applied','correctionId',corr,'originalTransactionId',t.id,'transactionId',ctx,'reference',reference,
  'membershipId',t.membership_id,'quantity',t.quantity,'balanceAfter',new_balance,'accountRevision',new_revision,'voidedRewards',to_jsonb(voiding));
 INSERT INTO correction_requests(id,merchant_id,membership_id,original_transaction_id,requested_by,requested_delta,reason,status,decided_by,decision_reason,compensating_transaction_id,result,decided_at,kind)
  VALUES(corr,t.merchant_id,t.membership_id,t.id,app_user(),-t.quantity,btrim(reason_arg),'applied',app_user(),btrim(reason_arg),ctx,result,clock_timestamp(),'revoke');
 INSERT INTO correction_events(merchant_id,correction_id,actor_id,action,reason) VALUES(t.merchant_id,corr,app_user(),'revoke',btrim(reason_arg));
 PERFORM invalidate_wallet_cards(t.membership_id);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION revoke_auto_stamp(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_auto_stamp(uuid,uuid,text) TO nuqta_runtime;

-- Owner/manager only: sets the balance to zero, voids rewards not yet redeemed, keeps all history.
CREATE FUNCTION reset_card(member_arg uuid,operation_arg uuid,reason_arg text,expected_revision integer,block_arg boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ms memberships; staff staff_memberships; account loyalty_accounts; voiding uuid[]; branch uuid; new_revision integer;
 ctx uuid:=gen_random_uuid(); corr uuid:=gen_random_uuid(); reference text; result jsonb; blocked_at timestamptz;
BEGIN
 SELECT * INTO ms FROM memberships WHERE id=member_arg;
 IF NOT FOUND OR NOT tenant_access(ms.merchant_id) THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 staff:=acting_staff(ms.merchant_id);
 IF staff.id IS NULL OR staff.role NOT IN ('owner','manager') THEN RAISE EXCEPTION 'NQ:FORBIDDEN';END IF;
 IF length(btrim(coalesce(reason_arg,'')))<4 THEN RAISE EXCEPTION 'NQ:REASON_REQUIRED';END IF;
 IF NOT EXISTS(SELECT 1 FROM operations WHERE id=operation_arg AND actor_id=app_user() AND merchant_id=ms.merchant_id AND status='processing') THEN RAISE EXCEPTION 'NQ:FORBIDDEN';END IF;
 SELECT * INTO account FROM loyalty_accounts WHERE membership_id=ms.id FOR UPDATE;
 IF account.revision<>expected_revision THEN RAISE EXCEPTION 'NQ:REVISION_CONFLICT';END IF;
 PERFORM 1 FROM reward_grants WHERE membership_id=ms.id AND status='available' FOR UPDATE;
 SELECT coalesce(array_agg(id ORDER BY earned_at),'{}') INTO voiding FROM reward_grants WHERE membership_id=ms.id AND status='available';
 branch:=coalesce(ms.origin_branch_id,
  (SELECT t.branch_id FROM loyalty_transactions t WHERE t.membership_id=ms.id ORDER BY t.sequence DESC LIMIT 1),
  (SELECT pb.branch_id FROM program_branches pb WHERE pb.merchant_id=ms.merchant_id AND pb.program_version_id=ms.program_version_id ORDER BY pb.branch_id LIMIT 1));
 IF branch IS NULL THEN RAISE EXCEPTION 'NQ:BRANCH_UNAUTHORIZED';END IF;
 reference:='TX-'||upper(substr(ctx::text,1,8))||'-'||upper(substr(ctx::text,10,4));
 INSERT INTO loyalty_transactions(id,public_reference,merchant_id,membership_id,program_version_id,branch_id,staff_id,operation_id,type,quantity,source)
  VALUES(ctx,reference,ms.merchant_id,ms.id,ms.program_version_id,branch,staff.id,operation_arg,'correction',-account.balance,'reset');
 IF account.balance>0 THEN
  INSERT INTO ledger_entries(merchant_id,membership_id,transaction_id,program_version_id,type,amount)
   VALUES(ms.merchant_id,ms.id,ctx,ms.program_version_id,'reset',-account.balance);
 END IF;
 PERFORM void_rewards(ms.merchant_id,voiding,ctx);
 UPDATE loyalty_accounts SET balance=0,revision=revision+1 WHERE membership_id=ms.id RETURNING revision INTO new_revision;
 IF block_arg THEN
  UPDATE memberships SET auto_collect_blocked_at=coalesce(auto_collect_blocked_at,clock_timestamp()),
   auto_collect_blocked_by=coalesce(auto_collect_blocked_by,app_user()) WHERE id=ms.id RETURNING auto_collect_blocked_at INTO blocked_at;
 ELSE blocked_at:=ms.auto_collect_blocked_at;
 END IF;
 result:=jsonb_build_object('status','applied','correctionId',corr,'transactionId',ctx,'reference',reference,'membershipId',ms.id,
  'previousBalance',account.balance,'balanceAfter',0,'accountRevision',new_revision,'voidedRewards',to_jsonb(voiding),
  'autoCollectBlocked',blocked_at IS NOT NULL);
 INSERT INTO correction_requests(id,merchant_id,membership_id,original_transaction_id,requested_by,requested_delta,reason,status,decided_by,decision_reason,compensating_transaction_id,result,decided_at,kind)
  VALUES(corr,ms.merchant_id,ms.id,NULL,app_user(),-account.balance,btrim(reason_arg),'applied',app_user(),btrim(reason_arg),ctx,result,clock_timestamp(),'reset');
 INSERT INTO correction_events(merchant_id,correction_id,actor_id,action,reason) VALUES(ms.merchant_id,corr,app_user(),'reset',btrim(reason_arg));
 PERFORM invalidate_wallet_cards(ms.id);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION reset_card(uuid,uuid,text,integer,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reset_card(uuid,uuid,text,integer,boolean) TO nuqta_runtime;

-- Owner/manager only: stop (or allow again) automatic collection for one card.
CREATE FUNCTION set_auto_collect_block(member_arg uuid,blocked_arg boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ms memberships; staff staff_memberships; was_blocked boolean;
BEGIN
 SELECT * INTO ms FROM memberships WHERE id=member_arg FOR UPDATE;
 IF NOT FOUND OR NOT tenant_access(ms.merchant_id) THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 staff:=acting_staff(ms.merchant_id);
 IF staff.id IS NULL OR staff.role NOT IN ('owner','manager') THEN RAISE EXCEPTION 'NQ:FORBIDDEN';END IF;
 was_blocked:=ms.auto_collect_blocked_at IS NOT NULL;
 UPDATE memberships SET auto_collect_blocked_at=CASE WHEN blocked_arg THEN coalesce(auto_collect_blocked_at,clock_timestamp()) END,
  auto_collect_blocked_by=CASE WHEN blocked_arg THEN coalesce(auto_collect_blocked_by,app_user()) END
  WHERE id=ms.id RETURNING * INTO ms;
 RETURN jsonb_build_object('membershipId',ms.id,'autoCollectBlocked',ms.auto_collect_blocked_at IS NOT NULL,
  'blockedAt',ms.auto_collect_blocked_at,'changed',was_blocked<>blocked_arg);
END $$;
REVOKE ALL ON FUNCTION set_auto_collect_block(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_auto_collect_block(uuid,boolean) TO nuqta_runtime;

-- A blocked card never collects on its own; the API turns this into the usual "ask the cashier".
CREATE OR REPLACE FUNCTION pg_temp.patch_function(sig regprocedure,old_text text,new_text text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE def text;n integer;
BEGIN
 def:=pg_get_functiondef(sig);
 n:=(length(def)-length(replace(def,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'patch_function %: expected exactly one match, found %',sig,n;END IF;
 EXECUTE replace(def,old_text,new_text);
END $$;
SELECT pg_temp.patch_function('collect_stamp_automatically(uuid,uuid,uuid)',
 'IF s.require_cashier THEN RAISE EXCEPTION ''NQ:CASHIER_REQUIRED'';END IF;',
 'IF s.require_cashier THEN RAISE EXCEPTION ''NQ:CASHIER_REQUIRED'';END IF;
 IF ms.auto_collect_blocked_at IS NOT NULL THEN RETURN jsonb_build_object(''eligible'',false,''reason'',''blocked'');END IF;');
SELECT pg_temp.patch_function('collection_context(uuid,uuid)',
 '''eligibility'',collection_eligibility(ms.id,s.default_stamps));',
 '''autoBlocked'',ms.auto_collect_blocked_at IS NOT NULL,''eligibility'',collection_eligibility(ms.id,s.default_stamps));');
