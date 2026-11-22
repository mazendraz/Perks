-- The daily analytics pass backs off from a shop that keeps failing (fixes 043).
-- Before this, a shop whose refresh always failed or timed out stayed first in the due list
-- (oldest refreshed_day first), so every minute the worker spent its whole budget on it and the
-- other shops were never refreshed.

ALTER TABLE merchant_analytics_state
 ADD COLUMN failures integer NOT NULL DEFAULT 0,
 ADD COLUMN retry_after timestamptz;

-- 5, 10, 20 ... minutes, at most 6 hours between attempts.
CREATE FUNCTION analytics_refresh_failed(mid uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 INSERT INTO merchant_analytics_state(merchant_id,failures,retry_after)
 VALUES(mid,1,clock_timestamp()+interval '5 minutes')
 ON CONFLICT(merchant_id) DO UPDATE SET
  failures=merchant_analytics_state.failures+1,
  retry_after=clock_timestamp()+least(interval '5 minutes'*power(2,least(merchant_analytics_state.failures,10)),interval '6 hours')
$$;
REVOKE ALL ON FUNCTION analytics_refresh_failed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics_refresh_failed(uuid) TO nuqta_worker;

CREATE FUNCTION analytics_refresh_succeeded(mid uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 UPDATE merchant_analytics_state SET failures=0,retry_after=NULL WHERE merchant_id=mid AND (failures<>0 OR retry_after IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION analytics_refresh_succeeded(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analytics_refresh_succeeded(uuid) TO nuqta_worker;

CREATE OR REPLACE FUNCTION analytics_refresh_due(max_rows integer DEFAULT 20) RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT m.id FROM merchants m LEFT JOIN merchant_analytics_state s ON s.merchant_id=m.id
 WHERE m.status IN ('active','trial') AND (s.refreshed_day IS NULL OR s.refreshed_day<(clock_timestamp() AT TIME ZONE m.timezone)::date)
   AND (s.retry_after IS NULL OR s.retry_after<=clock_timestamp())
 ORDER BY s.refreshed_day NULLS FIRST LIMIT max_rows
$$;
