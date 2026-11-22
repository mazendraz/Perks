-- One row per customer per shop with everything the analytics page needs, kept current:
--  * instantly for one customer after any stamp, correction or new card (triggers below), and
--  * for the whole shop once per shop day (the worker), because "late" happens without any event.
-- The segment rules live in ONE place, classify_lifecycle(), used by both paths.
-- Additive: new tables, functions and AFTER triggers. A failure in analytics never blocks a stamp:
-- the triggers swallow their own errors and the daily refresh repairs the row.

-- ── Rules ─────────────────────────────────────────────────────────────────────────────────────
-- visits: distinct visit days; since_days: days since the last one; first_days: days since the first.
-- gap/risk/lost: this customer's rhythm (personal when known, else the shop's).
-- returned_after_lost_days: days since they came back after a gap longer than `lost`, if they did.
CREATE FUNCTION classify_lifecycle(visits integer,since_days integer,first_days integer,gap numeric,
 risk numeric,lost numeric,returned_after_lost_days integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT CASE
  WHEN coalesce(visits,0)=0 THEN 'never'
  WHEN since_days>lost THEN 'lost'
  WHEN returned_after_lost_days IS NOT NULL AND returned_after_lost_days<=30 AND since_days<=risk THEN 'reactivated'
  WHEN visits=1 AND first_days<=greatest(gap,7) THEN 'new'
  WHEN visits=1 THEN 'one_time'
  WHEN since_days<=risk THEN 'regular'
  ELSE 'at_risk'
 END
$$;

-- ── Storage ───────────────────────────────────────────────────────────────────────────────────
CREATE TABLE customer_stats (
 profile_id uuid PRIMARY KEY REFERENCES tenant_customer_profiles(id) ON DELETE CASCADE,
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 joined_at timestamptz NOT NULL,
 origin_branch_id uuid,
 branch_ids uuid[] NOT NULL DEFAULT '{}',
 favorite_branch_id uuid,
 first_visit_on date,
 last_visit_on date,
 last_visit_at timestamptz,
 visits_total integer NOT NULL DEFAULT 0,
 visits_90d integer NOT NULL DEFAULT 0,
 personal_gap_days numeric,
 expected_gap_days numeric NOT NULL,
 at_risk_after_days numeric NOT NULL,
 lost_after_days numeric NOT NULL,
 since_days integer,
 stamps_to_reward integer,
 rewards_earned integer NOT NULL DEFAULT 0,
 rewards_redeemed integer NOT NULL DEFAULT 0,
 has_open_reward boolean NOT NULL DEFAULT false,
 wallet_saved boolean NOT NULL DEFAULT false,
 lifecycle text NOT NULL CHECK(lifecycle IN ('never','new','one_time','regular','at_risk','lost','reactivated')),
 tags text[] NOT NULL DEFAULT '{}',
 lifecycle_since timestamptz NOT NULL DEFAULT clock_timestamp(),
 refreshed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX customer_stats_segment ON customer_stats(merchant_id,lifecycle);
CREATE INDEX customer_stats_last_visit ON customer_stats(merchant_id,last_visit_on DESC);
CREATE INDEX customer_stats_tags ON customer_stats USING gin(tags);

CREATE TABLE customer_segment_changes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 profile_id uuid NOT NULL REFERENCES tenant_customer_profiles(id) ON DELETE CASCADE,
 from_lifecycle text,
 to_lifecycle text NOT NULL,
 at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX segment_changes_merchant ON customer_segment_changes(merchant_id,at DESC);

CREATE TABLE merchant_daily_stats (
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 day date NOT NULL,
 customers integer NOT NULL,
 active_30d integer NOT NULL,
 visits integer NOT NULL,
 new_customers integer NOT NULL,
 lifecycle_counts jsonb NOT NULL,
 PRIMARY KEY(merchant_id,day)
);

-- Per-shop values the single-customer refresh needs without scanning the whole shop.
CREATE TABLE merchant_analytics_state (
 merchant_id uuid PRIMARY KEY REFERENCES merchants(id),
 vip_min_visits integer NOT NULL DEFAULT 5,
 refreshed_day date,
 refreshed_at timestamptz,
 refresh_ms integer
);

-- Owners with full customer scope see every customer; managers see the customers who joined or
-- visited at their branches (the same scope as the customer directory).
ALTER TABLE customer_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_stats_read ON customer_stats FOR SELECT USING(tenant_access(merchant_id) AND (
 owner_full_customer_scope(merchant_id)
 OR branch_access(merchant_id,origin_branch_id)
 OR EXISTS(SELECT 1 FROM unnest(branch_ids) b WHERE branch_access(merchant_id,b))));
ALTER TABLE customer_segment_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY segment_changes_read ON customer_segment_changes FOR SELECT USING(tenant_access(merchant_id));
ALTER TABLE merchant_daily_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY daily_stats_read ON merchant_daily_stats FOR SELECT USING(tenant_access(merchant_id));
ALTER TABLE merchant_analytics_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY analytics_state_read ON merchant_analytics_state FOR SELECT USING(tenant_access(merchant_id));
REVOKE ALL ON customer_stats,customer_segment_changes,merchant_daily_stats,merchant_analytics_state FROM PUBLIC;
GRANT SELECT ON customer_stats,customer_segment_changes,merchant_daily_stats,merchant_analytics_state TO nuqta_runtime;

-- ── Computation ───────────────────────────────────────────────────────────────────────────────
-- The full row for some customers of one shop (all of them when pids is NULL).
-- VIP is the top 5% by visits in 90 days with at least 5; a single-customer refresh uses the
-- shop's last computed cut-off.
CREATE FUNCTION compute_customer_stats(mid uuid,pids uuid[])
RETURNS SETOF customer_stats LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH cad AS (SELECT * FROM merchant_cadence(mid)),
 today AS (SELECT (clock_timestamp() AT TIME ZONE m.timezone)::date AS d FROM merchants m WHERE m.id=mid),
 pm AS MATERIALIZED (
  SELECT cp.id AS profile_id,ms.id AS membership_id,ms.joined_at,ms.origin_branch_id,ms.status,ms.program_id
  FROM tenant_customer_profiles cp JOIN memberships ms ON ms.profile_id=cp.id AND ms.merchant_id=mid
  WHERE cp.merchant_id=mid AND (pids IS NULL OR cp.id=ANY(pids))),
 prof AS (
  SELECT profile_id,min(joined_at) AS joined_at,
   (array_agg(origin_branch_id ORDER BY joined_at))[1] AS origin_branch_id
  FROM pm GROUP BY profile_id),
 days AS (
  SELECT v.profile_id,v.business_date,min(v.first_at) AS first_at,max(v.last_at) AS last_at,
   (array_agg(v.branch_id ORDER BY v.first_at))[1] AS branch_id
  FROM visits_v v
  -- Filters on the view's grouping columns are pushed inside it, so one customer reads one card.
  WHERE v.merchant_id=mid AND (pids IS NULL OR v.profile_id=ANY(pids))
  GROUP BY v.profile_id,v.business_date),
 gaps AS (
  SELECT profile_id,business_date,
   business_date-lag(business_date) OVER (PARTITION BY profile_id ORDER BY business_date) AS gap
  FROM days),
 agg AS (
  SELECT d.profile_id,count(*)::int AS visits_total,
   count(*) FILTER(WHERE d.business_date>(SELECT d FROM today)-90)::int AS visits_90d,
   min(d.business_date) AS first_visit_on,max(d.business_date) AS last_visit_on,max(d.last_at) AS last_visit_at,
   array_agg(DISTINCT d.branch_id) AS branch_ids,
   mode() WITHIN GROUP (ORDER BY d.branch_id) AS favorite_branch_id
  FROM days d GROUP BY d.profile_id),
 gagg AS (
  SELECT g.profile_id,count(g.gap)::int AS gap_count,
   (percentile_cont(0.5) WITHIN GROUP (ORDER BY g.gap) FILTER(WHERE g.gap IS NOT NULL))::numeric AS median_gap,
   max(g.business_date) FILTER(WHERE g.gap>(SELECT lost FROM cad)) AS returned_after_lost_on
  FROM gaps g GROUP BY g.profile_id),
 cards AS (
  SELECT pm.profile_id,
   min(v.threshold-a.balance) FILTER(WHERE pm.status='active' AND pr.status='active' AND v.threshold>a.balance) AS stamps_to_reward
  FROM pm JOIN loyalty_accounts a ON a.membership_id=pm.membership_id
  JOIN program_versions v ON v.id=a.program_version_id
  JOIN programs pr ON pr.id=pm.program_id
  GROUP BY pm.profile_id),
 rewards AS (
  SELECT pm.profile_id,count(g.id)::int AS earned,
   count(g.id) FILTER(WHERE g.status='redeemed')::int AS redeemed,
   bool_or(g.status='available' AND g.expires_at>clock_timestamp()) AS has_open
  FROM pm JOIN reward_grants g ON g.membership_id=pm.membership_id GROUP BY pm.profile_id),
 wallets AS (
  SELECT pm.profile_id,bool_or(w.membership_id IS NOT NULL OR o.membership_id IS NOT NULL) AS saved
  FROM pm LEFT JOIN wallet_passes w ON w.membership_id=pm.membership_id
  LEFT JOIN google_wallet_objects o ON o.membership_id=pm.membership_id
  GROUP BY pm.profile_id),
 vip AS (
  SELECT CASE WHEN pids IS NULL THEN
   greatest(5,coalesce((SELECT percentile_disc(0.95) WITHIN GROUP (ORDER BY visits_90d) FROM agg),5))
   ELSE coalesce((SELECT vip_min_visits FROM merchant_analytics_state WHERE merchant_id=mid),5) END AS min_visits),
 rhythm AS (
  SELECT p.profile_id,
   -- A personal rhythm needs at least three visits; it stays within half and three times the shop's.
   CASE WHEN coalesce(gg.gap_count,0)>=2 THEN
    least(greatest(gg.median_gap,(SELECT gap FROM cad)*0.5,1),(SELECT gap FROM cad)*3) END AS personal
  FROM prof p LEFT JOIN gagg gg ON gg.profile_id=p.profile_id),
 cadence AS (
  SELECT r.profile_id,r.personal,
   coalesce(r.personal,(SELECT gap FROM cad)) AS gap,
   CASE WHEN r.personal IS NULL THEN (SELECT risk FROM cad)
    ELSE least(ceil(r.personal*1.5),(SELECT lost FROM cad)-1) END AS risk,
   CASE WHEN r.personal IS NULL THEN (SELECT lost FROM cad)
    ELSE greatest(r.personal*3,(SELECT lost FROM cad)) END AS lost
  FROM rhythm r)
 SELECT p.profile_id,mid,p.joined_at,p.origin_branch_id,
  coalesce((SELECT array_agg(DISTINCT b) FROM unnest(coalesce(a.branch_ids,'{}')||ARRAY[p.origin_branch_id]) b WHERE b IS NOT NULL),'{}'),
  a.favorite_branch_id,a.first_visit_on,a.last_visit_on,a.last_visit_at,
  coalesce(a.visits_total,0),coalesce(a.visits_90d,0),
  c.personal,c.gap,c.risk,c.lost,
  (SELECT d FROM today)-a.last_visit_on,
  cr.stamps_to_reward,coalesce(rw.earned,0),coalesce(rw.redeemed,0),coalesce(rw.has_open,false),coalesce(w.saved,false),
  classify_lifecycle(coalesce(a.visits_total,0),(SELECT d FROM today)-a.last_visit_on,(SELECT d FROM today)-a.first_visit_on,
   c.gap,c.risk,c.lost,(SELECT d FROM today)-gg.returned_after_lost_on),
  array_remove(ARRAY[
   CASE WHEN cr.stamps_to_reward BETWEEN 1 AND 2 THEN 'near_reward' END,
   CASE WHEN coalesce(rw.has_open,false) THEN 'reward_holder' END,
   CASE WHEN coalesce(a.visits_90d,0)>=(SELECT min_visits FROM vip) THEN 'vip' END],NULL),
  clock_timestamp(),clock_timestamp()
 FROM prof p
 LEFT JOIN agg a ON a.profile_id=p.profile_id
 LEFT JOIN gagg gg ON gg.profile_id=p.profile_id
 LEFT JOIN cadence c ON c.profile_id=p.profile_id
 LEFT JOIN cards cr ON cr.profile_id=p.profile_id
 LEFT JOIN rewards rw ON rw.profile_id=p.profile_id
 LEFT JOIN wallets w ON w.profile_id=p.profile_id
$$;
REVOKE ALL ON FUNCTION compute_customer_stats(uuid,uuid[]) FROM PUBLIC;

-- Writes the computed rows, keeping lifecycle_since and logging segment changes.
CREATE FUNCTION store_customer_stats(mid uuid,pids uuid[]) RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH fresh AS (SELECT * FROM compute_customer_stats(mid,pids)),
 changes AS (
  INSERT INTO customer_segment_changes(merchant_id,profile_id,from_lifecycle,to_lifecycle)
  SELECT f.merchant_id,f.profile_id,s.lifecycle,f.lifecycle FROM fresh f
  LEFT JOIN customer_stats s ON s.profile_id=f.profile_id
  WHERE s.lifecycle IS DISTINCT FROM f.lifecycle),
 stored AS (
  INSERT INTO customer_stats SELECT * FROM fresh
  ON CONFLICT(profile_id) DO UPDATE SET
   joined_at=EXCLUDED.joined_at,origin_branch_id=EXCLUDED.origin_branch_id,branch_ids=EXCLUDED.branch_ids,
   favorite_branch_id=EXCLUDED.favorite_branch_id,first_visit_on=EXCLUDED.first_visit_on,
   last_visit_on=EXCLUDED.last_visit_on,last_visit_at=EXCLUDED.last_visit_at,visits_total=EXCLUDED.visits_total,
   visits_90d=EXCLUDED.visits_90d,personal_gap_days=EXCLUDED.personal_gap_days,
   expected_gap_days=EXCLUDED.expected_gap_days,at_risk_after_days=EXCLUDED.at_risk_after_days,
   lost_after_days=EXCLUDED.lost_after_days,since_days=EXCLUDED.since_days,stamps_to_reward=EXCLUDED.stamps_to_reward,
   rewards_earned=EXCLUDED.rewards_earned,rewards_redeemed=EXCLUDED.rewards_redeemed,
   has_open_reward=EXCLUDED.has_open_reward,wallet_saved=EXCLUDED.wallet_saved,tags=EXCLUDED.tags,
   lifecycle_since=CASE WHEN customer_stats.lifecycle=EXCLUDED.lifecycle THEN customer_stats.lifecycle_since ELSE clock_timestamp() END,
   lifecycle=EXCLUDED.lifecycle,refreshed_at=clock_timestamp()
  RETURNING 1)
 SELECT count(*)::int FROM stored
$$;
REVOKE ALL ON FUNCTION store_customer_stats(uuid,uuid[]) FROM PUBLIC;

-- One customer, right after something happened to them.
CREATE FUNCTION refresh_customer_stats(pid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE mid uuid;
BEGIN
 SELECT merchant_id INTO mid FROM tenant_customer_profiles WHERE id=pid;
 IF mid IS NOT NULL THEN PERFORM store_customer_stats(mid,ARRAY[pid]);END IF;
END $$;
REVOKE ALL ON FUNCTION refresh_customer_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_customer_stats(uuid) TO nuqta_worker;

-- The whole shop, plus today's summary row and the VIP cut-off.
CREATE FUNCTION refresh_merchant_stats(mid uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE started timestamptz:=clock_timestamp(); n integer; today date; vip integer;
BEGIN
 SELECT (clock_timestamp() AT TIME ZONE timezone)::date INTO today FROM merchants WHERE id=mid;
 IF today IS NULL THEN RETURN 0;END IF;
 n:=store_customer_stats(mid,NULL);
 SELECT greatest(5,coalesce(percentile_disc(0.95) WITHIN GROUP (ORDER BY visits_90d),5)) INTO vip
  FROM customer_stats WHERE merchant_id=mid;
 INSERT INTO merchant_daily_stats(merchant_id,day,customers,active_30d,visits,new_customers,lifecycle_counts)
 SELECT mid,today,count(*)::int,
  count(*) FILTER(WHERE last_visit_on>today-30)::int,
  (SELECT count(*)::int FROM visits_v v WHERE v.merchant_id=mid AND v.business_date=today),
  count(*) FILTER(WHERE (joined_at AT TIME ZONE (SELECT timezone FROM merchants WHERE id=mid))::date=today)::int,
  coalesce((SELECT jsonb_object_agg(lifecycle,c) FROM (SELECT lifecycle,count(*) AS c FROM customer_stats WHERE merchant_id=mid GROUP BY lifecycle) x),'{}')
 FROM customer_stats WHERE merchant_id=mid
 ON CONFLICT(merchant_id,day) DO UPDATE SET customers=EXCLUDED.customers,active_30d=EXCLUDED.active_30d,
  visits=EXCLUDED.visits,new_customers=EXCLUDED.new_customers,lifecycle_counts=EXCLUDED.lifecycle_counts;
 INSERT INTO merchant_analytics_state(merchant_id,vip_min_visits,refreshed_day,refreshed_at,refresh_ms)
 VALUES(mid,vip,today,clock_timestamp(),(extract(epoch FROM clock_timestamp()-started)*1000)::int)
 ON CONFLICT(merchant_id) DO UPDATE SET vip_min_visits=EXCLUDED.vip_min_visits,refreshed_day=EXCLUDED.refreshed_day,
  refreshed_at=EXCLUDED.refreshed_at,refresh_ms=EXCLUDED.refresh_ms;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION refresh_merchant_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_merchant_stats(uuid) TO nuqta_worker;

-- Shops whose own calendar day has turned since their last full refresh (never refreshed included).
CREATE FUNCTION analytics_refresh_due(max_rows integer DEFAULT 20) RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT m.id FROM merchants m LEFT JOIN merchant_analytics_state s ON s.merchant_id=m.id
 WHERE m.status IN ('active','trial') AND (s.refreshed_day IS NULL OR s.refreshed_day<(clock_timestamp() AT TIME ZONE m.timezone)::date)
 ORDER BY s.refreshed_day NULLS FIRST LIMIT max_rows
$$;
REVOKE ALL ON FUNCTION analytics_refresh_due(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics_refresh_due(integer) TO nuqta_worker;

-- ── Triggers: never let analytics fail a stamp ────────────────────────────────────────────────
CREATE FUNCTION analytics_touch_membership() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE pid uuid;
BEGIN
 BEGIN
  SELECT profile_id INTO pid FROM memberships WHERE id=NEW.membership_id;
  IF pid IS NOT NULL THEN PERFORM refresh_customer_stats(pid);END IF;
 EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'analytics refresh skipped: %',SQLSTATE;
 END;
 RETURN NULL;
END $$;
CREATE FUNCTION analytics_touch_reward() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE pid uuid;
BEGIN
 BEGIN
  SELECT ms.profile_id INTO pid FROM reward_grants g JOIN memberships ms ON ms.id=g.membership_id WHERE g.id=NEW.reward_id;
  IF pid IS NOT NULL THEN PERFORM refresh_customer_stats(pid);END IF;
 EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'analytics refresh skipped: %',SQLSTATE;
 END;
 RETURN NULL;
END $$;
CREATE FUNCTION analytics_touch_new_membership() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 BEGIN
  PERFORM refresh_customer_stats(NEW.profile_id);
 EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'analytics refresh skipped: %',SQLSTATE;
 END;
 RETURN NULL;
END $$;
-- Deferred to commit: the card balance, rewards and account rows are written later in the same
-- transaction as the stamp or enrolment, and the row must reflect all of them.
CREATE CONSTRAINT TRIGGER analytics_after_transaction AFTER INSERT ON loyalty_transactions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION analytics_touch_membership();
CREATE CONSTRAINT TRIGGER analytics_after_reward_event AFTER INSERT ON reward_events
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION analytics_touch_reward();
CREATE CONSTRAINT TRIGGER analytics_after_membership AFTER INSERT ON memberships
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION analytics_touch_new_membership();
