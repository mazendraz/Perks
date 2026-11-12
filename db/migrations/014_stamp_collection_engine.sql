-- One stamp collection engine with independent per-merchant switches.
-- Defaults keep today's behaviour: every stamp needs a cashier and nothing asks for location.
CREATE TABLE stamp_collection_settings (
 merchant_id uuid PRIMARY KEY REFERENCES merchants(id),
 require_location boolean NOT NULL DEFAULT false,
 require_cashier boolean NOT NULL DEFAULT true,
 max_accuracy_m integer NOT NULL DEFAULT 100 CHECK(max_accuracy_m BETWEEN 20 AND 500),
 -- How many times a customer may collect, separate from how many stamps one collection gives.
 collections_per_day integer CHECK(collections_per_day BETWEEN 1 AND 50),
 stamps_per_day integer CHECK(stamps_per_day BETWEEN 1 AND 200),
 limit_window text NOT NULL DEFAULT 'local_day' CHECK(limit_window IN ('local_day','rolling_24h')),
 cooldown_minutes integer NOT NULL DEFAULT 0 CHECK(cooldown_minutes BETWEEN 0 AND 1440),
 default_stamps integer NOT NULL DEFAULT 1 CHECK(default_stamps BETWEEN 1 AND 10),
 allow_multiple boolean NOT NULL DEFAULT true,
 max_stamps_per_collection integer NOT NULL DEFAULT 100 CHECK(max_stamps_per_collection BETWEEN 1 AND 100),
 welcome_stamps integer NOT NULL DEFAULT 0 CHECK(welcome_stamps BETWEEN 0 AND 10),
 -- Circuit breaker for stamps nobody approves: past this many per branch per hour, a cashier is needed.
 auto_branch_hourly_cap integer NOT NULL DEFAULT 60 CHECK(auto_branch_hourly_cap BETWEEN 1 AND 1000),
 -- Neither location nor cashier: a shared sticker link is enough, so the owner must accept that knowingly.
 open_collection_acknowledged boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_by uuid REFERENCES users(id),
 CONSTRAINT open_collection_needs_acknowledgement CHECK(require_cashier OR require_location OR open_collection_acknowledged),
 CONSTRAINT automatic_needs_daily_limit CHECK(require_cashier OR collections_per_day IS NOT NULL),
 CONSTRAINT automatic_stamps_stay_small CHECK(require_cashier OR default_stamps<=3),
 CONSTRAINT default_within_maximum CHECK(default_stamps<=max_stamps_per_collection)
);
INSERT INTO stamp_collection_settings(merchant_id) SELECT id FROM merchants;
CREATE FUNCTION default_collection_settings() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN INSERT INTO stamp_collection_settings(merchant_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;RETURN NEW;END $$;
REVOKE ALL ON FUNCTION default_collection_settings() FROM PUBLIC;
CREATE TRIGGER merchant_collection_settings AFTER INSERT ON merchants FOR EACH ROW EXECUTE FUNCTION default_collection_settings();
ALTER TABLE stamp_collection_settings ENABLE ROW LEVEL SECURITY;
-- Staff may read their shop's rules; only the platform team changes them.
CREATE POLICY collection_settings_read ON stamp_collection_settings FOR SELECT USING(tenant_access(merchant_id));
CREATE POLICY collection_settings_write ON stamp_collection_settings FOR UPDATE USING(is_platform_admin()) WITH CHECK(is_platform_admin());
GRANT SELECT,UPDATE ON stamp_collection_settings TO nuqta_runtime;

-- Branch position for server-side distance checks.
ALTER TABLE branches ADD COLUMN latitude double precision,ADD COLUMN longitude double precision,
 ADD COLUMN geofence_radius_m integer NOT NULL DEFAULT 75 CHECK(geofence_radius_m BETWEEN 20 AND 1000),
 ADD CONSTRAINT branch_position_complete CHECK((latitude IS NULL)=(longitude IS NULL)),
 ADD CONSTRAINT branch_position_valid CHECK(latitude IS NULL OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180));
CREATE FUNCTION set_branch_position(mid uuid,bid uuid,lat double precision,lng double precision,radius integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT is_platform_admin() THEN RAISE EXCEPTION 'NQ:FORBIDDEN';END IF;
 UPDATE branches SET latitude=lat,longitude=lng,geofence_radius_m=radius WHERE merchant_id=mid AND id=bid;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 -- Location cannot stay required while an active branch has no position to compare with.
 IF lat IS NULL AND EXISTS(SELECT 1 FROM stamp_collection_settings WHERE merchant_id=mid AND require_location) THEN RAISE EXCEPTION 'NQ:BRANCH_POSITION_REQUIRED';END IF;
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail) VALUES(app_user(),mid,'branch.position.update',bid,jsonb_build_object('set',lat IS NOT NULL,'radius',radius));
END $$;
REVOKE ALL ON FUNCTION set_branch_position(uuid,uuid,double precision,double precision,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_branch_position(uuid,uuid,double precision,double precision,integer) TO nuqta_runtime;

-- Every location decision is recorded as distance and accuracy only; the customer's coordinates are never stored.
CREATE TABLE stamp_collection_checks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,membership_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES users(id),branch_id uuid NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('awarded','pending','location_required','location_inaccurate','outside_zone','limit_reached','cooldown','busy')),
 distance_m integer,accuracy_m integer,at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(merchant_id,membership_id) REFERENCES memberships(merchant_id,id),FOREIGN KEY(merchant_id,branch_id) REFERENCES branches(merchant_id,id)
);
CREATE INDEX collection_checks_branch ON stamp_collection_checks(merchant_id,branch_id,at DESC);
CREATE INDEX collection_checks_member ON stamp_collection_checks(membership_id,at DESC);
CREATE TRIGGER collection_checks_immutable BEFORE UPDATE OR DELETE ON stamp_collection_checks FOR EACH ROW EXECUTE FUNCTION immutable_row();
ALTER TABLE stamp_collection_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY collection_check_access ON stamp_collection_checks USING(user_id=app_user() OR branch_access(merchant_id,branch_id)) WITH CHECK(user_id=app_user());
GRANT SELECT,INSERT ON stamp_collection_checks TO nuqta_runtime;

-- Stamps without a cashier have no staff member and no receipt.
ALTER TABLE loyalty_transactions ALTER COLUMN staff_id DROP NOT NULL;
ALTER TABLE loyalty_transactions DROP CONSTRAINT loyalty_transactions_source_check;
ALTER TABLE loyalty_transactions ADD CONSTRAINT loyalty_transactions_source_check CHECK(source IN ('scan','request','correction','redemption','auto','welcome'));
ALTER TABLE loyalty_transactions DROP CONSTRAINT loyalty_transactions_check;
ALTER TABLE loyalty_transactions ADD CONSTRAINT loyalty_transactions_check CHECK(type<>'award' OR (quantity>0 AND (purchase_id IS NOT NULL OR source IN ('auto','welcome'))));
ALTER TABLE loyalty_transactions ADD CONSTRAINT staff_required_unless_automatic CHECK(staff_id IS NOT NULL OR (type='award' AND source IN ('auto','welcome')));
-- The welcome stamp can exist once per membership, whatever calls for it.
CREATE UNIQUE INDEX one_welcome_per_membership ON loyalty_transactions(membership_id) WHERE source='welcome';
CREATE INDEX collections_by_member ON loyalty_transactions(membership_id,at DESC) WHERE type='award' AND source IN ('scan','request','auto');

-- Shared rule check for every collection path. Called with the loyalty account already locked.
CREATE FUNCTION collection_eligibility(member_arg uuid,quantity_arg integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ms memberships; s stamp_collection_settings; zone text; since timestamptz; until timestamptz; done integer; given integer; last_at timestamptz; oldest timestamptz;
BEGIN
 SELECT * INTO ms FROM memberships WHERE id=member_arg;
 IF NOT FOUND OR NOT (ms.user_id=app_user() OR tenant_access(ms.merchant_id)) THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 SELECT * INTO s FROM stamp_collection_settings WHERE merchant_id=ms.merchant_id;
 SELECT timezone INTO zone FROM merchants WHERE id=ms.merchant_id;
 IF s.limit_window='rolling_24h' THEN since:=clock_timestamp()-interval '24 hours';
 ELSE since:=date_trunc('day',clock_timestamp() AT TIME ZONE zone) AT TIME ZONE zone;until:=since+interval '1 day';
 END IF;
 SELECT count(*),coalesce(sum(quantity),0),max(at),min(at) INTO done,given,last_at,oldest FROM loyalty_transactions
  WHERE membership_id=member_arg AND type='award' AND source IN ('scan','request','auto') AND at>=since;
 IF s.limit_window='rolling_24h' THEN until:=oldest+interval '24 hours';END IF;
 IF s.collections_per_day IS NOT NULL AND done>=s.collections_per_day THEN
  RETURN jsonb_build_object('eligible',false,'reason','limit_reached','nextAt',until);
 END IF;
 IF s.stamps_per_day IS NOT NULL AND given+quantity_arg>s.stamps_per_day THEN
  RETURN jsonb_build_object('eligible',false,'reason','limit_reached','nextAt',until,'stampsLeft',greatest(0,s.stamps_per_day-given));
 END IF;
 IF s.cooldown_minutes>0 AND last_at IS NOT NULL AND last_at+s.cooldown_minutes*interval '1 minute'>clock_timestamp() THEN
  RETURN jsonb_build_object('eligible',false,'reason','cooldown','nextAt',last_at+s.cooldown_minutes*interval '1 minute');
 END IF;
 RETURN jsonb_build_object('eligible',true);
END $$;
REVOKE ALL ON FUNCTION collection_eligibility(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collection_eligibility(uuid,integer) TO nuqta_runtime;

-- Writes one earned-stamp transaction with its ledger rows and any completed rewards.
CREATE FUNCTION post_automatic_stamps(ms memberships,branch_arg uuid,quantity_arg integer,operation_arg uuid,source_arg text,actor_arg uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE account loyalty_accounts; ver program_versions; tx uuid:=gen_random_uuid(); reference text; total integer; rewards integer; after integer; i integer; reward uuid; branches_list uuid[]; granted jsonb:='[]'::jsonb; new_revision integer;
BEGIN
 SELECT * INTO account FROM loyalty_accounts WHERE membership_id=ms.id AND merchant_id=ms.merchant_id FOR UPDATE;
 SELECT * INTO ver FROM program_versions WHERE id=account.program_version_id;
 reference:='TX-'||upper(substr(tx::text,1,8))||'-'||upper(substr(tx::text,10,4));
 INSERT INTO loyalty_transactions(id,public_reference,merchant_id,membership_id,program_version_id,branch_id,operation_id,type,quantity,source)
  VALUES(tx,reference,ms.merchant_id,ms.id,account.program_version_id,branch_arg,operation_arg,'award',quantity_arg,source_arg);
 INSERT INTO ledger_entries(merchant_id,membership_id,transaction_id,program_version_id,type,amount)
  VALUES(ms.merchant_id,ms.id,tx,account.program_version_id,'earn',quantity_arg);
 total:=account.balance+quantity_arg;rewards:=total/ver.threshold;after:=total%ver.threshold;
 SELECT coalesce(array_agg(branch_id),'{}') INTO branches_list FROM program_branches WHERE merchant_id=ms.merchant_id AND program_version_id=account.program_version_id;
 FOR i IN 1..rewards LOOP
  INSERT INTO reward_grants(merchant_id,membership_id,program_version_id,earned_transaction_id,ordinal,threshold,title,terms,branch_ids,expires_at)
   VALUES(ms.merchant_id,ms.id,account.program_version_id,tx,i,ver.threshold,ver.reward_title,ver.reward_terms,branches_list,clock_timestamp()+ver.validity_days*interval '1 day') RETURNING id INTO reward;
  INSERT INTO ledger_entries(merchant_id,membership_id,transaction_id,program_version_id,type,amount,reward_id)
   VALUES(ms.merchant_id,ms.id,tx,account.program_version_id,'reward_consumption',-ver.threshold,reward);
  INSERT INTO reward_events(merchant_id,reward_id,event_type,actor_id,transaction_id) VALUES(ms.merchant_id,reward,'earned',actor_arg,tx);
  granted:=granted||jsonb_build_object('id',reward,'title',ver.reward_title);
 END LOOP;
 UPDATE loyalty_accounts SET balance=after,revision=revision+1,last_purchase_at=clock_timestamp() WHERE membership_id=ms.id RETURNING revision INTO new_revision;
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail) VALUES(actor_arg,ms.merchant_id,'loyalty.award',tx,
  jsonb_build_object('membershipId',ms.id,'branchId',branch_arg,'quantity',quantity_arg,'source',source_arg));
 RETURN jsonb_build_object('transactionId',tx,'reference',reference,'membershipId',ms.id,'quantity',quantity_arg,'balanceAfter',after,
  'accountRevision',new_revision,'rewardGrants',granted,'source',source_arg);
END $$;
REVOKE ALL ON FUNCTION post_automatic_stamps(memberships,uuid,integer,uuid,text,uuid) FROM PUBLIC;

-- A customer's own automatic collection. The API has already verified the sticker and, when required, the location;
-- this function still refuses when the shop requires a cashier, and re-checks every limit under the account lock.
CREATE FUNCTION collect_stamp_automatically(member_arg uuid,branch_arg uuid,operation_arg uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ms memberships; s stamp_collection_settings; ver program_versions; verdict jsonb; recent integer;
BEGIN
 SELECT * INTO ms FROM memberships WHERE id=member_arg AND user_id=app_user() AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF NOT EXISTS(SELECT 1 FROM operations WHERE id=operation_arg AND actor_id=app_user() AND merchant_id=ms.merchant_id AND status='processing') THEN RAISE EXCEPTION 'NQ:FORBIDDEN';END IF;
 SELECT * INTO s FROM stamp_collection_settings WHERE merchant_id=ms.merchant_id FOR SHARE;
 IF s.require_cashier THEN RAISE EXCEPTION 'NQ:CASHIER_REQUIRED';END IF;
 IF NOT merchant_earning_allowed(ms.merchant_id) THEN RAISE EXCEPTION 'NQ:EARNING_PAUSED';END IF;
 PERFORM 1 FROM loyalty_accounts WHERE membership_id=ms.id FOR UPDATE;
 SELECT v.* INTO ver FROM program_versions v JOIN programs p ON p.id=ms.program_id WHERE v.id=ms.program_version_id AND p.status='active';
 IF NOT FOUND OR ver.starts_at>clock_timestamp() OR (ver.ends_at IS NOT NULL AND ver.ends_at<=clock_timestamp()) THEN RAISE EXCEPTION 'NQ:PROGRAM_INACTIVE';END IF;
 IF NOT EXISTS(SELECT 1 FROM program_branches pb JOIN branches b ON b.id=pb.branch_id AND b.merchant_id=pb.merchant_id
  WHERE pb.merchant_id=ms.merchant_id AND pb.program_version_id=ms.program_version_id AND pb.branch_id=branch_arg AND b.status='active') THEN RAISE EXCEPTION 'NQ:PROGRAM_BRANCH_UNAUTHORIZED';END IF;
 verdict:=collection_eligibility(ms.id,s.default_stamps);
 IF NOT (verdict->>'eligible')::boolean THEN RETURN verdict;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('auto-branch:'||branch_arg::text,0));
 SELECT count(*) INTO recent FROM loyalty_transactions WHERE merchant_id=ms.merchant_id AND branch_id=branch_arg AND source='auto' AND at>clock_timestamp()-interval '1 hour';
 IF recent>=s.auto_branch_hourly_cap THEN RETURN jsonb_build_object('eligible',false,'reason','busy');END IF;
 RETURN jsonb_build_object('eligible',true)||post_automatic_stamps(ms,branch_arg,least(s.default_stamps,ver.max_per_tx),operation_arg,'auto',app_user());
END $$;
REVOKE ALL ON FUNCTION collect_stamp_automatically(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collect_stamp_automatically(uuid,uuid,uuid) TO nuqta_runtime;

-- Welcome stamps arrive with the new loyalty account, so every enrolment path gets them exactly once.
CREATE FUNCTION grant_welcome_stamps() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ms memberships; s stamp_collection_settings; op uuid; branch uuid;
BEGIN
 SELECT * INTO ms FROM memberships WHERE id=NEW.membership_id;
 SELECT * INTO s FROM stamp_collection_settings WHERE merchant_id=NEW.merchant_id;
 IF NOT FOUND OR s.welcome_stamps=0 THEN RETURN NEW;END IF;
 branch:=coalesce(ms.origin_branch_id,(SELECT pb.branch_id FROM program_branches pb WHERE pb.merchant_id=NEW.merchant_id AND pb.program_version_id=NEW.program_version_id ORDER BY pb.branch_id LIMIT 1));
 IF branch IS NULL THEN RETURN NEW;END IF;
 INSERT INTO operations(actor_id,merchant_id,scope,idempotency_key,request_hash) VALUES(ms.user_id,NEW.merchant_id,'stamp.welcome','welcome:'||ms.id::text,encode(sha256(convert_to(ms.id::text,'UTF8')),'hex')) RETURNING id INTO op;
 UPDATE operations SET status='committed',committed_at=clock_timestamp(),
  result=post_automatic_stamps(ms,branch,s.welcome_stamps,op,'welcome',ms.user_id) WHERE id=op;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION grant_welcome_stamps() FROM PUBLIC;
CREATE TRIGGER welcome_stamps AFTER INSERT ON loyalty_accounts FOR EACH ROW EXECUTE FUNCTION grant_welcome_stamps();

-- What the API needs to judge a customer's own collection attempt. The branch position stays server-side.
CREATE FUNCTION collection_context(member_arg uuid,branch_arg uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ms memberships; s stamp_collection_settings; b branches;
BEGIN
 SELECT * INTO ms FROM memberships WHERE id=member_arg AND user_id=app_user() AND status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 SELECT * INTO s FROM stamp_collection_settings WHERE merchant_id=ms.merchant_id;
 SELECT * INTO b FROM branches WHERE merchant_id=ms.merchant_id AND id=branch_arg AND status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:BRANCH_UNAUTHORIZED';END IF;
 RETURN jsonb_build_object('merchantId',ms.merchant_id,'requireLocation',s.require_location,'requireCashier',s.require_cashier,
  'maxAccuracy',s.max_accuracy_m,'defaultStamps',s.default_stamps,'latitude',b.latitude,'longitude',b.longitude,'radius',b.geofence_radius_m,
  'eligibility',collection_eligibility(ms.id,s.default_stamps));
END $$;
REVOKE ALL ON FUNCTION collection_context(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION collection_context(uuid,uuid) TO nuqta_runtime;
