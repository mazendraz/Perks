-- Keep canceled/obsolete intents visible, without a permanent false backlog alarm.
-- Only explicit terminal business reasons are excluded; unknown failures fail closed.
CREATE OR REPLACE FUNCTION operational_queue_metrics() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH unfinished AS (
   SELECT status,created_at,
     NOT(status='blocked' AND coalesce(last_error,'') IN
       ('INVITATION_NOT_AVAILABLE','EXPORT_SCOPE_CHANGED','EXPORT_NOT_AVAILABLE')) AS actionable
   FROM background_jobs WHERE status<>'succeeded'
   UNION ALL
   SELECT status,created_at,
     NOT(status='blocked' AND coalesce(last_error,'')='AUTH_MAIL_STALE') AS actionable
   FROM auth_mail_outbox WHERE status<>'sent'
 )
 SELECT jsonb_build_object(
   'length',count(*)::int,
   'actionable',count(*) FILTER(WHERE actionable)::int,
   'pending',count(*) FILTER(WHERE status='pending')::int,
   'running',count(*) FILTER(WHERE status='running')::int,
   'failed',count(*) FILTER(WHERE status='failed')::int,
   'blocked',count(*) FILTER(WHERE status='blocked')::int,
   'unknown',count(*) FILTER(WHERE status='unknown')::int,
   'oldestPendingAgeMs',CASE WHEN count(*) FILTER(WHERE actionable)=0 THEN NULL ELSE
     greatest(0,floor(extract(epoch FROM clock_timestamp()-min(created_at) FILTER(WHERE actionable))*1000)) END
 ) FROM unfinished
$$;
REVOKE ALL ON FUNCTION operational_queue_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION operational_queue_metrics() TO nuqta_auth;
