CREATE TABLE customer_experience_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,membership_id uuid NOT NULL,branch_id uuid NOT NULL,
 operation_id uuid NOT NULL UNIQUE REFERENCES operations(id),elapsed_ms integer NOT NULL CHECK(elapsed_ms BETWEEN 0 AND 600000),
 event_type text NOT NULL DEFAULT 'card_open' CHECK(event_type='card_open'),at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(merchant_id,membership_id) REFERENCES memberships(merchant_id,id),FOREIGN KEY(merchant_id,branch_id) REFERENCES branches(merchant_id,id)
);
CREATE INDEX experience_branch_at ON customer_experience_events(merchant_id,branch_id,at);
ALTER TABLE customer_experience_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY experience_access ON customer_experience_events
 USING(branch_access(merchant_id,branch_id) OR EXISTS(SELECT 1 FROM memberships m WHERE m.id=customer_experience_events.membership_id AND m.user_id=app_user()))
 WITH CHECK(EXISTS(SELECT 1 FROM memberships m WHERE m.id=customer_experience_events.membership_id AND m.merchant_id=customer_experience_events.merchant_id AND m.user_id=app_user()));
GRANT SELECT,INSERT ON customer_experience_events TO nuqta_runtime;
