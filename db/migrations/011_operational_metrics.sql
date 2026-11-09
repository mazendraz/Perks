-- Global health contains aggregates only. No runtime/worker access to auth mail.
CREATE FUNCTION operational_queue_metrics() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH unfinished AS (
   SELECT status,created_at FROM background_jobs WHERE status<>'succeeded'
   UNION ALL
   SELECT status,created_at FROM auth_mail_outbox WHERE status<>'sent'
 )
 SELECT jsonb_build_object(
   'length',count(*)::int,
   'pending',count(*) FILTER(WHERE status='pending')::int,
   'running',count(*) FILTER(WHERE status='running')::int,
   'failed',count(*) FILTER(WHERE status='failed')::int,
   'blocked',count(*) FILTER(WHERE status='blocked')::int,
   'unknown',count(*) FILTER(WHERE status='unknown')::int,
   'oldestPendingAgeMs',CASE WHEN count(*)=0 THEN NULL ELSE
     greatest(0,floor(extract(epoch FROM clock_timestamp()-min(created_at))*1000)) END
 ) FROM unfinished
$$;
REVOKE ALL ON FUNCTION operational_queue_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operational_queue_metrics() TO nuqta_auth;
