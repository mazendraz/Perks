ALTER TABLE loyalty_transactions ADD COLUMN sequence bigint GENERATED ALWAYS AS IDENTITY;
CREATE INDEX tx_membership_sequence ON loyalty_transactions(membership_id,sequence DESC);
CREATE TABLE redemption_challenges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,reward_id uuid NOT NULL,membership_id uuid NOT NULL,
 branch_id uuid NOT NULL,staff_id uuid NOT NULL,cashier_user_id uuid NOT NULL REFERENCES users(id),cashier_session_id uuid NOT NULL REFERENCES sessions(id),
 holder_user_id uuid NOT NULL REFERENCES users(id),code_hash text NOT NULL,
 status text NOT NULL DEFAULT 'awaiting_holder' CHECK(status IN ('awaiting_holder','confirmed','declined','cancelled','expired','completed')),
 expires_at timestamptz NOT NULL,confirmed_at timestamptz,completed_transaction_id uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(merchant_id,id),FOREIGN KEY(merchant_id,reward_id) REFERENCES reward_grants(merchant_id,id),
 FOREIGN KEY(merchant_id,membership_id) REFERENCES memberships(merchant_id,id),FOREIGN KEY(merchant_id,branch_id) REFERENCES branches(merchant_id,id),
 FOREIGN KEY(merchant_id,staff_id) REFERENCES staff_memberships(merchant_id,id),FOREIGN KEY(merchant_id,completed_transaction_id) REFERENCES loyalty_transactions(merchant_id,id)
);
CREATE UNIQUE INDEX one_active_redemption_challenge ON redemption_challenges(reward_id) WHERE status IN ('awaiting_holder','confirmed');
CREATE TABLE reward_redemptions (
 reward_id uuid PRIMARY KEY,merchant_id uuid NOT NULL,challenge_id uuid NOT NULL UNIQUE,transaction_id uuid NOT NULL UNIQUE,
 holder_user_id uuid NOT NULL REFERENCES users(id),at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(merchant_id,reward_id) REFERENCES reward_grants(merchant_id,id),FOREIGN KEY(merchant_id,challenge_id) REFERENCES redemption_challenges(merchant_id,id),
 FOREIGN KEY(merchant_id,transaction_id) REFERENCES loyalty_transactions(merchant_id,id)
);
CREATE TRIGGER redemption_immutable BEFORE UPDATE OR DELETE ON reward_redemptions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE correction_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,membership_id uuid NOT NULL,original_transaction_id uuid NOT NULL,
 requested_by uuid NOT NULL REFERENCES users(id),requested_delta integer NOT NULL CHECK(requested_delta<>0 AND abs(requested_delta)<=100),
 reason text NOT NULL CHECK(length(reason)>=4),status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','needs_review','applied','rejected')),
 decided_by uuid REFERENCES users(id),decision_reason text,compensating_transaction_id uuid,result jsonb,created_at timestamptz NOT NULL DEFAULT now(),decided_at timestamptz,
 UNIQUE(merchant_id,id),FOREIGN KEY(merchant_id,original_transaction_id) REFERENCES loyalty_transactions(merchant_id,id),
 FOREIGN KEY(merchant_id,membership_id) REFERENCES memberships(merchant_id,id),FOREIGN KEY(merchant_id,compensating_transaction_id) REFERENCES loyalty_transactions(merchant_id,id)
);
CREATE UNIQUE INDEX one_open_correction ON correction_requests(original_transaction_id) WHERE status IN ('pending','needs_review');
CREATE UNIQUE INDEX one_applied_reversal ON correction_requests(original_transaction_id) WHERE status='applied';
CREATE TABLE correction_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,correction_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),
 action text NOT NULL,reason text NOT NULL,at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(merchant_id,correction_id) REFERENCES correction_requests(merchant_id,id)
);
CREATE TRIGGER correction_event_immutable BEFORE UPDATE OR DELETE ON correction_events FOR EACH ROW EXECUTE FUNCTION immutable_row();
ALTER TABLE redemption_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY challenge_access ON redemption_challenges USING(holder_user_id=app_user() OR tenant_access(merchant_id)) WITH CHECK(holder_user_id=app_user() OR tenant_access(merchant_id));
ALTER TABLE reward_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY redemption_access ON reward_redemptions USING(holder_user_id=app_user() OR tenant_access(merchant_id)) WITH CHECK(tenant_access(merchant_id));
ALTER TABLE correction_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY correction_access ON correction_requests USING(tenant_access(merchant_id)) WITH CHECK(tenant_access(merchant_id));
ALTER TABLE correction_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY correction_event_access ON correction_events USING(tenant_access(merchant_id)) WITH CHECK(tenant_access(merchant_id));
ALTER TABLE reward_events ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE reward_events DROP CONSTRAINT reward_events_event_type_check;
ALTER TABLE reward_events ADD CHECK(event_type IN ('earned','redeemed','voided','expired'));
CREATE FUNCTION sweep_expired_rewards() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE reward reward_grants; event_id uuid; total integer=0; out_id uuid;
BEGIN
 FOR reward IN SELECT * FROM reward_grants r WHERE r.status='available' AND r.expires_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM reward_events e WHERE e.reward_id=r.id AND e.event_type='expired') ORDER BY r.expires_at FOR UPDATE SKIP LOCKED LIMIT 100 LOOP
  INSERT INTO reward_events(merchant_id,reward_id,event_type,actor_id,transaction_id) VALUES(reward.merchant_id,reward.id,'expired',NULL,reward.earned_transaction_id) ON CONFLICT DO NOTHING RETURNING id INTO event_id;
  IF event_id IS NOT NULL THEN
   INSERT INTO outbox_events(merchant_id,event_type,aggregate_id,payload,dedupe_key) VALUES(reward.merchant_id,'reward.expired',reward.id,jsonb_build_object('rewardId',reward.id),'reward-expired:'||reward.id) RETURNING id INTO out_id;
   INSERT INTO background_jobs(merchant_id,outbox_id,kind) VALUES(reward.merchant_id,out_id,'domain_event');total=total+1;
  END IF;
 END LOOP;RETURN total;
END $$;
GRANT SELECT,INSERT,UPDATE ON redemption_challenges,correction_requests TO nuqta_runtime;
GRANT SELECT,INSERT ON reward_redemptions,correction_events TO nuqta_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO nuqta_runtime;
GRANT EXECUTE ON FUNCTION sweep_expired_rewards() TO nuqta_worker;
