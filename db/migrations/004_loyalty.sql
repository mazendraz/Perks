CREATE TABLE purchase_references (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants(id),branch_id uuid NOT NULL,
 namespace text NOT NULL DEFAULT 'manual' CHECK(namespace='manual'),business_date date NOT NULL,reference text NOT NULL,normalized_reference text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(merchant_id,namespace,branch_id,business_date,normalized_reference),UNIQUE(merchant_id,id),
 FOREIGN KEY(merchant_id,branch_id) REFERENCES branches(merchant_id,id)
);
CREATE TABLE loyalty_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),public_reference text NOT NULL UNIQUE,merchant_id uuid NOT NULL,membership_id uuid NOT NULL,
 program_version_id uuid NOT NULL,branch_id uuid NOT NULL,staff_id uuid NOT NULL,operation_id uuid NOT NULL UNIQUE,purchase_id uuid,
 type text NOT NULL CHECK(type IN ('award','redeem','correction')),quantity integer NOT NULL,
 source text NOT NULL CHECK(source IN ('scan','request','correction','redemption')),original_transaction_id uuid,
 at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(merchant_id,id),
 FOREIGN KEY(merchant_id,membership_id,program_version_id) REFERENCES memberships(merchant_id,id,program_version_id),
 FOREIGN KEY(merchant_id,branch_id) REFERENCES branches(merchant_id,id),FOREIGN KEY(merchant_id,staff_id) REFERENCES staff_memberships(merchant_id,id),
 FOREIGN KEY(merchant_id,operation_id) REFERENCES operations(merchant_id,id),FOREIGN KEY(merchant_id,purchase_id) REFERENCES purchase_references(merchant_id,id),
 FOREIGN KEY(merchant_id,original_transaction_id) REFERENCES loyalty_transactions(merchant_id,id),
 CHECK(type<>'award' OR (quantity>0 AND purchase_id IS NOT NULL)),CHECK(type<>'redeem' OR quantity=0),CHECK(type<>'correction' OR original_transaction_id IS NOT NULL)
);
CREATE INDEX tx_merchant_at ON loyalty_transactions(merchant_id,at DESC,id);
CREATE INDEX tx_membership_at ON loyalty_transactions(membership_id,at DESC,id);
CREATE INDEX tx_branch_at ON loyalty_transactions(merchant_id,branch_id,at DESC);
CREATE TRIGGER transaction_immutable BEFORE UPDATE OR DELETE ON loyalty_transactions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE purchase_allocations (
 merchant_id uuid NOT NULL,purchase_id uuid NOT NULL,membership_id uuid NOT NULL,transaction_id uuid NOT NULL,
 PRIMARY KEY(merchant_id,purchase_id),UNIQUE(transaction_id),
 FOREIGN KEY(merchant_id,purchase_id) REFERENCES purchase_references(merchant_id,id),FOREIGN KEY(merchant_id,membership_id) REFERENCES memberships(merchant_id,id),
 FOREIGN KEY(merchant_id,transaction_id) REFERENCES loyalty_transactions(merchant_id,id)
);
CREATE TRIGGER allocation_immutable BEFORE UPDATE OR DELETE ON purchase_allocations FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE reward_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,membership_id uuid NOT NULL,program_version_id uuid NOT NULL,
 earned_transaction_id uuid NOT NULL,ordinal integer NOT NULL CHECK(ordinal>0),threshold integer NOT NULL CHECK(threshold>0),
 title text NOT NULL,terms text NOT NULL,branch_ids uuid[] NOT NULL,status text NOT NULL DEFAULT 'available' CHECK(status IN ('available','redeemed','voided')),
 earned_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,redeemed_at timestamptz,
 UNIQUE(earned_transaction_id,ordinal),UNIQUE(merchant_id,id),
 FOREIGN KEY(merchant_id,membership_id,program_version_id) REFERENCES memberships(merchant_id,id,program_version_id),
 FOREIGN KEY(merchant_id,earned_transaction_id) REFERENCES loyalty_transactions(merchant_id,id),CHECK(expires_at>earned_at)
);
CREATE INDEX available_reward_expiry ON reward_grants(merchant_id,expires_at) WHERE status='available';
CREATE INDEX reward_membership ON reward_grants(membership_id,earned_at DESC);
CREATE FUNCTION immutable_reward_terms() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(NEW.merchant_id,NEW.membership_id,NEW.program_version_id,NEW.earned_transaction_id,NEW.ordinal,NEW.threshold,NEW.title,NEW.terms,NEW.branch_ids,NEW.earned_at,NEW.expires_at) IS DISTINCT FROM ROW(OLD.merchant_id,OLD.membership_id,OLD.program_version_id,OLD.earned_transaction_id,OLD.ordinal,OLD.threshold,OLD.title,OLD.terms,OLD.branch_ids,OLD.earned_at,OLD.expires_at) THEN RAISE EXCEPTION 'immutable reward terms' USING ERRCODE='42501';END IF;
 IF OLD.status IN ('redeemed','voided') AND NEW.status<>OLD.status THEN RAISE EXCEPTION 'final reward state' USING ERRCODE='42501';END IF;
 RETURN NEW;END $$;
CREATE TRIGGER reward_terms_immutable BEFORE UPDATE ON reward_grants FOR EACH ROW EXECUTE FUNCTION immutable_reward_terms();
CREATE TABLE ledger_entries (
 id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 merchant_id uuid NOT NULL,membership_id uuid NOT NULL,transaction_id uuid NOT NULL,program_version_id uuid NOT NULL,
 type text NOT NULL CHECK(type IN ('earn','reward_consumption','compensation')),amount integer NOT NULL CHECK(amount<>0),reward_id uuid,compensates_entry_id uuid,
 at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(merchant_id,membership_id,program_version_id) REFERENCES memberships(merchant_id,id,program_version_id),
 FOREIGN KEY(merchant_id,transaction_id) REFERENCES loyalty_transactions(merchant_id,id),FOREIGN KEY(merchant_id,reward_id) REFERENCES reward_grants(merchant_id,id),
 FOREIGN KEY(compensates_entry_id) REFERENCES ledger_entries(id),UNIQUE(compensates_entry_id),
 CHECK((type='earn' AND amount>0 AND reward_id IS NULL AND compensates_entry_id IS NULL) OR (type='reward_consumption' AND amount<0 AND reward_id IS NOT NULL AND compensates_entry_id IS NULL) OR (type='compensation' AND compensates_entry_id IS NOT NULL))
);
CREATE INDEX ledger_account_sequence ON ledger_entries(membership_id,sequence);
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE reward_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,reward_id uuid NOT NULL,event_type text NOT NULL CHECK(event_type IN ('earned','redeemed','voided')),
 actor_id uuid NOT NULL REFERENCES users(id),transaction_id uuid NOT NULL,at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(reward_id,event_type),
 FOREIGN KEY(merchant_id,reward_id) REFERENCES reward_grants(merchant_id,id),FOREIGN KEY(merchant_id,transaction_id) REFERENCES loyalty_transactions(merchant_id,id)
);
CREATE TRIGGER reward_event_immutable BEFORE UPDATE OR DELETE ON reward_events FOR EACH ROW EXECUTE FUNCTION immutable_row();
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['purchase_references','purchase_allocations'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('CREATE POLICY tenant_records ON %I USING(tenant_access(merchant_id)) WITH CHECK(tenant_access(merchant_id))',t);
END LOOP;FOREACH t IN ARRAY ARRAY['loyalty_transactions','reward_grants','ledger_entries'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('CREATE POLICY member_records ON %I USING(member_access(membership_id)) WITH CHECK(tenant_access(merchant_id))',t);
END LOOP;END $$;
ALTER TABLE reward_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY reward_event_records ON reward_events USING(tenant_access(merchant_id) OR EXISTS(SELECT 1 FROM reward_grants r WHERE r.id=reward_events.reward_id AND member_access(r.membership_id))) WITH CHECK(tenant_access(merchant_id));
GRANT SELECT,INSERT ON purchase_references,purchase_allocations,loyalty_transactions,ledger_entries,reward_events TO nuqta_runtime;
GRANT SELECT,INSERT,UPDATE ON reward_grants TO nuqta_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO nuqta_runtime;
