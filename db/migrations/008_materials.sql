ALTER TABLE branches ADD COLUMN revision integer NOT NULL DEFAULT 1;
CREATE TABLE placements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,branch_id uuid NOT NULL,public_code text NOT NULL UNIQUE,
 label text NOT NULL,kind text NOT NULL CHECK(kind IN ('stand','sticker','nfc')),status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','ready','shipped','installed','verified','revoked')),
 replaced_by uuid,revision integer NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(merchant_id,id),FOREIGN KEY(merchant_id,branch_id) REFERENCES branches(merchant_id,id),FOREIGN KEY(merchant_id,replaced_by) REFERENCES placements(merchant_id,id)
);
CREATE TABLE placement_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,placement_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),action text NOT NULL,
 reason text NOT NULL,device_description text,verification_method text CHECK(verification_method IS NULL OR verification_method='operator_attestation'),at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(merchant_id,placement_id) REFERENCES placements(merchant_id,id)
);
CREATE TRIGGER placement_events_immutable BEFORE UPDATE OR DELETE ON placement_events FOR EACH ROW EXECUTE FUNCTION immutable_row();
ALTER TABLE placements ENABLE ROW LEVEL SECURITY;
CREATE POLICY placement_scope ON placements USING(branch_access(merchant_id,branch_id)) WITH CHECK(branch_access(merchant_id,branch_id));
ALTER TABLE placement_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY placement_event_scope ON placement_events USING(EXISTS(SELECT 1 FROM placements p WHERE p.id=placement_id AND p.merchant_id=placement_events.merchant_id)) WITH CHECK(actor_id=app_user() AND EXISTS(SELECT 1 FROM placements p WHERE p.id=placement_id AND p.merchant_id=placement_events.merchant_id));
GRANT SELECT,INSERT,UPDATE ON placements TO nuqta_runtime;
GRANT SELECT,INSERT ON placement_events TO nuqta_runtime;
CREATE FUNCTION resolve_placement(code_arg text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN p.status='revoked' THEN jsonb_build_object('status','revoked') WHEN m.status NOT IN ('active','trial') OR b.status<>'active' THEN jsonb_build_object('status','unavailable') ELSE jsonb_build_object('status','active','slug',m.slug,'merchantName',m.name,'branchId',b.id,'branchName',b.name,'placementId',p.id) END FROM placements p JOIN merchants m ON m.id=p.merchant_id JOIN branches b ON b.id=p.branch_id WHERE p.public_code=code_arg
$$;
GRANT EXECUTE ON FUNCTION resolve_placement(text) TO nuqta_runtime;
CREATE FUNCTION published_logo(mid uuid,asset_arg uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT a.storage_key FROM assets a JOIN merchants m ON m.id=a.merchant_id AND m.logo_asset_id=a.id WHERE m.id=mid AND a.id=asset_arg AND m.status IN ('active','trial')
$$;
GRANT EXECUTE ON FUNCTION published_logo(uuid,uuid) TO nuqta_runtime;
