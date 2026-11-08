CREATE FUNCTION is_platform_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM users WHERE id=app_user() AND status='active' AND global_role IN ('platform_admin','platform_support'))
$$;
CREATE TABLE support_tickets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants(id),created_by uuid NOT NULL REFERENCES users(id),
 subject text NOT NULL,category text NOT NULL CHECK(category IN ('loyalty','access','materials','billing','other')),status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','waiting','resolved')),
 revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(merchant_id,id)
);
CREATE FUNCTION ticket_access(ticket_arg uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT is_platform_staff() OR EXISTS(SELECT 1 FROM support_tickets t JOIN staff_memberships s ON s.merchant_id=t.merchant_id JOIN users u ON u.id=s.user_id WHERE t.id=ticket_arg AND s.user_id=app_user() AND s.role='owner' AND s.status='active' AND u.status='active')
$$;
CREATE TABLE support_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,ticket_id uuid NOT NULL,author_id uuid NOT NULL REFERENCES users(id),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(merchant_id,ticket_id) REFERENCES support_tickets(merchant_id,id)
);
CREATE TRIGGER support_messages_immutable BEFORE UPDATE OR DELETE ON support_messages FOR EACH ROW EXECUTE FUNCTION immutable_row();
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY ticket_scope ON support_tickets USING(ticket_access(id)) WITH CHECK(is_platform_staff() OR EXISTS(SELECT 1 FROM staff_memberships s WHERE s.merchant_id=support_tickets.merchant_id AND s.user_id=app_user() AND s.status='active' AND s.role='owner'));
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_message_scope ON support_messages USING(ticket_access(ticket_id)) WITH CHECK(ticket_access(ticket_id) AND author_id=app_user());
GRANT SELECT,INSERT,UPDATE ON support_tickets TO nuqta_runtime;
GRANT SELECT,INSERT ON support_messages TO nuqta_runtime;
GRANT EXECUTE ON FUNCTION is_platform_staff(),ticket_access(uuid) TO nuqta_runtime;
CREATE FUNCTION platform_health() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE value jsonb;
BEGIN
 IF NOT is_platform_staff() THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 SELECT jsonb_build_object('at',clock_timestamp(),'merchants',(SELECT count(*) FROM merchants),'branches',(SELECT count(*) FROM branches),'staff',(SELECT count(*) FROM staff_memberships WHERE status='active'),'memberships',(SELECT count(*) FROM memberships),'transactions',(SELECT count(*) FROM loyalty_transactions),
 'balanceDrift',(SELECT count(*) FROM loyalty_accounts a WHERE a.balance<>(SELECT coalesce(sum(e.amount),0) FROM ledger_entries e WHERE e.membership_id=a.membership_id)),
 'oldestPendingSeconds',(SELECT extract(epoch FROM clock_timestamp()-min(created_at)) FROM background_jobs WHERE status='pending'),
 'jobs',(SELECT coalesce(jsonb_object_agg(status,n),'{}') FROM(SELECT status,count(*) AS n FROM background_jobs GROUP BY status) s),
 'merchantsHealth',(SELECT coalesce(jsonb_agg(x),'[]') FROM(SELECT m.id,m.name,m.status,(SELECT count(*) FROM memberships ms WHERE ms.merchant_id=m.id) AS memberships,(SELECT count(*) FROM background_jobs j WHERE j.merchant_id=m.id AND j.status IN ('blocked','unknown','failed')) AS attention_jobs FROM merchants m ORDER BY m.created_at DESC LIMIT 100) x)) INTO value;
 RETURN value;
END $$;
GRANT EXECUTE ON FUNCTION platform_health() TO nuqta_runtime;
CREATE FUNCTION platform_jobs() RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT is_platform_staff() THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 RETURN QUERY SELECT jsonb_build_object('id',j.id,'merchant_id',j.merchant_id,'merchant_name',m.name,'kind',j.kind,'status',j.status,'attempts',j.attempts,'last_error',j.last_error,'lease_until',j.lease_until,'event_type',e.event_type,'aggregate_id',e.aggregate_id,'created_at',j.created_at,'attempt_log',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'outcome',a.outcome,'error_code',a.error_code,'started_at',a.started_at,'finished_at',a.finished_at)),'[]') FROM job_attempts a WHERE a.job_id=j.id)) FROM background_jobs j JOIN merchants m ON m.id=j.merchant_id JOIN outbox_events e ON e.id=j.outbox_id ORDER BY j.created_at DESC LIMIT 100;
END $$;
GRANT EXECUTE ON FUNCTION platform_jobs() TO nuqta_runtime;
GRANT SELECT ON schema_migrations TO nuqta_runtime;
CREATE POLICY support_audit_insert ON audit_events FOR INSERT WITH CHECK(actor_id=app_user() AND is_platform_staff() AND action LIKE 'support.%' AND EXISTS(SELECT 1 FROM support_tickets t WHERE t.id=target_id AND t.merchant_id=audit_events.merchant_id));
