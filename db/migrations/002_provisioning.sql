ALTER TABLE merchants ADD COLUMN logo_asset_id uuid;
CREATE TABLE operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES users(id),merchant_id uuid REFERENCES merchants(id),
 scope text NOT NULL,idempotency_key text NOT NULL,request_hash text NOT NULL,status text NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','committed')),
 result jsonb,created_at timestamptz NOT NULL DEFAULT now(),committed_at timestamptz,UNIQUE(actor_id,scope,idempotency_key),UNIQUE(merchant_id,id)
);
CREATE FUNCTION immutable_operation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.status='committed' THEN RAISE EXCEPTION 'immutable operation' USING ERRCODE='42501';END IF;RETURN NEW;END $$;
CREATE TRIGGER committed_operation_immutable BEFORE UPDATE OR DELETE ON operations FOR EACH ROW EXECUTE FUNCTION immutable_operation();
ALTER TABLE operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_operations ON operations USING(actor_id=app_user() OR is_platform_admin()) WITH CHECK(actor_id=app_user());
CREATE TABLE provisioning_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_by uuid NOT NULL REFERENCES users(id),data jsonb NOT NULL DEFAULT '{}',
 revision integer NOT NULL DEFAULT 1,status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','activated')),
 updated_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE provisioning_activations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),draft_id uuid NOT NULL REFERENCES provisioning_drafts(id),draft_revision integer NOT NULL,
 merchant_id uuid NOT NULL REFERENCES merchants(id),result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(draft_id,draft_revision),UNIQUE(merchant_id)
);
CREATE TABLE provisioning_steps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),activation_id uuid NOT NULL REFERENCES provisioning_activations(id),
 step_key text NOT NULL,status text NOT NULL CHECK(status IN ('done','pending','blocked','failed')),resource_ids jsonb NOT NULL DEFAULT '[]',
 UNIQUE(activation_id,step_key)
);
CREATE TABLE feature_entitlements (
 merchant_id uuid PRIMARY KEY REFERENCES merchants(id),plan text NOT NULL CHECK(plan IN ('starter','growth','pro')),
 max_branches integer NOT NULL CHECK(max_branches>0),max_staff integer NOT NULL CHECK(max_staff>0),
 max_programs integer NOT NULL CHECK(max_programs>0),max_customers integer NOT NULL CHECK(max_customers>0),
 revision integer NOT NULL DEFAULT 1,reason text NOT NULL DEFAULT 'Initial manual entitlement',expires_at timestamptz
);
CREATE TABLE programs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants(id),name text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended','draft')),current_version_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(merchant_id,id)
);
CREATE TABLE program_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,program_id uuid NOT NULL,version integer NOT NULL,
 threshold integer NOT NULL CHECK(threshold BETWEEN 2 AND 50),max_per_tx integer NOT NULL CHECK(max_per_tx BETWEEN 1 AND 100),
 reward_title text NOT NULL,reward_terms text NOT NULL,validity_days integer NOT NULL CHECK(validity_days BETWEEN 1 AND 365),
 terms_version text NOT NULL DEFAULT '1',starts_at timestamptz NOT NULL DEFAULT now(),ends_at timestamptz,
 stacking_policy text NOT NULL DEFAULT 'exclusive_purchase' CHECK(stacking_policy='exclusive_purchase'),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(program_id,version),UNIQUE(merchant_id,id),UNIQUE(merchant_id,program_id,id),
 FOREIGN KEY(merchant_id,program_id) REFERENCES programs(merchant_id,id),CHECK(ends_at IS NULL OR ends_at>starts_at)
);
ALTER TABLE programs ADD CONSTRAINT current_version_scope FOREIGN KEY(merchant_id,id,current_version_id) REFERENCES program_versions(merchant_id,program_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE program_branches (
 merchant_id uuid NOT NULL,program_version_id uuid NOT NULL,branch_id uuid NOT NULL,
 PRIMARY KEY(program_version_id,branch_id),
 FOREIGN KEY(merchant_id,program_version_id) REFERENCES program_versions(merchant_id,id),
 FOREIGN KEY(merchant_id,branch_id) REFERENCES branches(merchant_id,id)
);
CREATE TRIGGER published_branch_immutable BEFORE UPDATE OR DELETE ON program_branches FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TRIGGER published_version_immutable BEFORE UPDATE OR DELETE ON program_versions FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants(id),email text NOT NULL,
 role text NOT NULL CHECK(role IN ('owner','manager','cashier')),max_qty integer NOT NULL CHECK(max_qty BETWEEN 1 AND 100),
 branch_ids uuid[] NOT NULL,token_hash text NOT NULL UNIQUE,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked','expired')),
 expires_at timestamptz NOT NULL,accepted_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),revision integer NOT NULL DEFAULT 1,
 UNIQUE(merchant_id,id)
);
CREATE UNIQUE INDEX one_pending_invitation ON invitations(merchant_id,email) WHERE status='pending';
CREATE TABLE outbox_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants(id),event_type text NOT NULL,
 aggregate_id uuid NOT NULL,aggregate_revision integer NOT NULL DEFAULT 1,payload jsonb NOT NULL DEFAULT '{}',
 dedupe_key text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(merchant_id,id)
);
CREATE TABLE background_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,outbox_id uuid NOT NULL,
 kind text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed','blocked','unknown')),
 attempts integer NOT NULL DEFAULT 0,next_run_at timestamptz NOT NULL DEFAULT now(),lease_id uuid,lease_until timestamptz,last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(outbox_id,kind),UNIQUE(merchant_id,id),
 FOREIGN KEY(merchant_id,outbox_id) REFERENCES outbox_events(merchant_id,id)
);
CREATE INDEX jobs_due ON background_jobs(next_run_at) WHERE status IN ('pending','running');
CREATE TABLE job_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,job_id uuid NOT NULL,lease_id uuid NOT NULL,
 outcome text NOT NULL,error_code text,started_at timestamptz NOT NULL,finished_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(merchant_id,job_id) REFERENCES background_jobs(merchant_id,id)
);
CREATE FUNCTION claim_next_job() RETURNS TABLE(job_id uuid,merchant_id uuid,kind text,payload jsonb,aggregate_id uuid,aggregate_revision integer,lease_id uuid,outbox_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE selected background_jobs; lease uuid;
BEGIN
 UPDATE background_jobs SET status='failed',last_error='MAX_ATTEMPTS',lease_until=NULL WHERE status='running' AND lease_until<clock_timestamp() AND attempts>=5;
 SELECT * INTO selected FROM background_jobs j WHERE ((j.status='pending' AND j.next_run_at<=clock_timestamp()) OR (j.status='running' AND j.lease_until<clock_timestamp())) AND j.attempts<5 ORDER BY j.next_run_at,j.id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN;END IF;
 lease=gen_random_uuid();
 UPDATE background_jobs SET status='running',attempts=attempts+1,lease_id=lease,lease_until=clock_timestamp()+interval '60 seconds' WHERE id=selected.id;
 RETURN QUERY SELECT selected.id,selected.merchant_id,selected.kind,e.payload,e.aggregate_id,e.aggregate_revision,lease,e.id FROM outbox_events e WHERE e.id=selected.outbox_id;
END $$;
CREATE TABLE assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants(id),storage_key text NOT NULL UNIQUE,
 mime text NOT NULL CHECK(mime='image/png'),bytes integer NOT NULL CHECK(bytes>0),width integer NOT NULL,height integer NOT NULL,
 sha256 text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(merchant_id,id)
);
ALTER TABLE merchants ADD CONSTRAINT logo_tenant_scope FOREIGN KEY(id,logo_asset_id) REFERENCES assets(merchant_id,id);
CREATE VIEW public_merchant_brands WITH (security_barrier=true) AS SELECT id,slug,name,status,timezone,primary_color,accent_color,surface_color,template,terms,logo_asset_id FROM merchants WHERE status IN ('active','trial');
CREATE FUNCTION public_merchant_details(slug_arg text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('merchant',jsonb_build_object('id',m.id,'slug',m.slug,'name',m.name,'status',m.status,'timezone',m.timezone,'primary_color',m.primary_color,'accent_color',m.accent_color,'surface_color',m.surface_color,'template',m.template,'terms',m.terms,'logo_asset_id',m.logo_asset_id),'branches',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'address',b.address)) FROM branches b WHERE b.merchant_id=m.id AND b.status='active'),'[]'),'programs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'versionId',v.id,'version',v.version,'threshold',v.threshold,'rewardTitle',v.reward_title,'rewardTerms',v.reward_terms,'termsVersion',v.terms_version)) FROM programs p JOIN program_versions v ON v.id=p.current_version_id WHERE p.merchant_id=m.id AND p.status='active' AND (v.ends_at IS NULL OR v.ends_at>now())),'[]')) FROM merchants m WHERE m.slug=slug_arg AND m.status IN ('active','trial')
$$;
CREATE FUNCTION accept_invitation(token_hash_arg text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE inv invitations; account users; sid uuid; bid uuid;
BEGIN
 SELECT * INTO account FROM users WHERE id=app_user() AND status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501';END IF;
 SELECT * INTO inv FROM invitations WHERE token_hash=token_hash_arg FOR UPDATE;
 IF NOT FOUND OR inv.email<>account.email OR inv.expires_at<=clock_timestamp() OR inv.status NOT IN ('pending','accepted') THEN RAISE EXCEPTION 'invalid invitation' USING ERRCODE='42501';END IF;
 IF inv.status='accepted' THEN RETURN jsonb_build_object('merchantId',inv.merchant_id,'alreadyAccepted',true);END IF;
 IF EXISTS(SELECT 1 FROM staff_memberships WHERE merchant_id=inv.merchant_id AND user_id=account.id) THEN RAISE EXCEPTION 'membership exists' USING ERRCODE='23505';END IF;
 INSERT INTO staff_memberships(merchant_id,user_id,email,name,role,max_qty) VALUES(inv.merchant_id,account.id,account.email,account.display_name,inv.role,inv.max_qty) RETURNING id INTO sid;
 FOREACH bid IN ARRAY inv.branch_ids LOOP
  INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES(inv.merchant_id,sid,bid);
 END LOOP;
 UPDATE invitations SET status='accepted',accepted_by=account.id WHERE id=inv.id;
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id) VALUES(account.id,inv.merchant_id,'invitation.accept',inv.id);
 RETURN jsonb_build_object('merchantId',inv.merchant_id,'staffId',sid);
END $$;
ALTER TABLE provisioning_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY drafts_admin ON provisioning_drafts USING(is_platform_admin()) WITH CHECK(is_platform_admin());
ALTER TABLE provisioning_activations ENABLE ROW LEVEL SECURITY;
CREATE POLICY activations_admin ON provisioning_activations USING(is_platform_admin()) WITH CHECK(is_platform_admin());
ALTER TABLE provisioning_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY steps_admin ON provisioning_steps USING(is_platform_admin()) WITH CHECK(is_platform_admin());
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['feature_entitlements','programs','program_versions','program_branches','invitations','outbox_events','background_jobs','job_attempts','assets'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY scoped_rows ON %I USING(tenant_access(merchant_id)) WITH CHECK(tenant_access(merchant_id))',t);
 END LOOP;
END $$;
CREATE POLICY worker_jobs ON background_jobs USING(current_user='nuqta_worker' AND merchant_id::text=current_setting('app.worker_tenant',true)) WITH CHECK(current_user='nuqta_worker' AND merchant_id::text=current_setting('app.worker_tenant',true));
CREATE POLICY worker_attempts ON job_attempts USING(current_user='nuqta_worker' AND merchant_id::text=current_setting('app.worker_tenant',true)) WITH CHECK(current_user='nuqta_worker' AND merchant_id::text=current_setting('app.worker_tenant',true));
ALTER POLICY merchant_access ON merchants USING(tenant_access(id)) WITH CHECK(tenant_access(id));
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON operations TO nuqta_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON provisioning_drafts,provisioning_activations,provisioning_steps,feature_entitlements,programs,invitations,background_jobs,assets TO nuqta_runtime;
GRANT SELECT,INSERT ON program_versions,program_branches,outbox_events,job_attempts TO nuqta_runtime;
GRANT SELECT ON public_merchant_brands TO nuqta_runtime;
GRANT EXECUTE ON FUNCTION public_merchant_details(text),accept_invitation(text) TO nuqta_runtime;
GRANT USAGE ON SCHEMA public TO nuqta_worker;
GRANT EXECUTE ON FUNCTION claim_next_job() TO nuqta_worker;
GRANT SELECT,UPDATE ON background_jobs TO nuqta_worker;
GRANT SELECT,INSERT ON job_attempts TO nuqta_worker;
