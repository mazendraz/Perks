CREATE TABLE stamp_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,membership_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES users(id),branch_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled','expired')),
 code_hash text NOT NULL,code_nonce uuid NOT NULL DEFAULT gen_random_uuid(),failed_matches integer NOT NULL DEFAULT 0 CHECK(failed_matches BETWEEN 0 AND 5),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',created_at timestamptz NOT NULL DEFAULT clock_timestamp(),decided_at timestamptz,
 decided_by uuid REFERENCES users(id),reason text,transaction_id uuid UNIQUE REFERENCES loyalty_transactions(id),result jsonb,
 FOREIGN KEY(merchant_id,membership_id) REFERENCES memberships(merchant_id,id),FOREIGN KEY(merchant_id,branch_id) REFERENCES branches(merchant_id,id)
);
CREATE UNIQUE INDEX one_pending_request_per_member ON stamp_requests(membership_id) WHERE status='pending';
CREATE INDEX branch_request_queue ON stamp_requests(merchant_id,branch_id,status,created_at);
CREATE TABLE stamp_request_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,request_id uuid NOT NULL REFERENCES stamp_requests(id),actor_id uuid NOT NULL REFERENCES users(id),
 action text NOT NULL,at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER request_events_immutable BEFORE UPDATE OR DELETE ON stamp_request_events FOR EACH ROW EXECUTE FUNCTION immutable_row();
ALTER TABLE stamp_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY request_access ON stamp_requests USING(user_id=app_user() OR branch_access(merchant_id,branch_id)) WITH CHECK(user_id=app_user() OR branch_access(merchant_id,branch_id));
ALTER TABLE stamp_request_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY request_event_access ON stamp_request_events USING(EXISTS(SELECT 1 FROM stamp_requests r WHERE r.id=request_id AND r.merchant_id=stamp_request_events.merchant_id)) WITH CHECK(actor_id=app_user() AND EXISTS(SELECT 1 FROM stamp_requests r WHERE r.id=request_id AND r.merchant_id=stamp_request_events.merchant_id));
GRANT SELECT,INSERT,UPDATE ON stamp_requests TO nuqta_runtime;
GRANT SELECT,INSERT ON stamp_request_events TO nuqta_runtime;
