CREATE FUNCTION owner_full_customer_scope(mid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.status='active' AND s.role='owner' AND u.status='active') AND NOT EXISTS(SELECT 1 FROM branches b WHERE b.merchant_id=mid AND b.status='active' AND NOT branch_access(mid,b.id))
$$;
GRANT EXECUTE ON FUNCTION owner_full_customer_scope(uuid) TO nuqta_runtime;
CREATE OR REPLACE FUNCTION customer_directory(mid uuid,bid uuid,segment_arg text,profile_arg uuid DEFAULT NULL,limit_arg integer DEFAULT 50,offset_arg integer DEFAULT 0) RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE staff staff_memberships;
BEGIN
 SELECT s.* INTO staff FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.status='active' AND s.role IN ('owner','manager') AND u.status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF bid IS NOT NULL AND NOT branch_access(mid,bid) THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF segment_arg NOT IN ('all','active','inactive','never_active') OR limit_arg NOT BETWEEN 1 AND 10000 OR offset_arg<0 THEN RAISE EXCEPTION 'NQ:INVALID_QUERY';END IF;
 RETURN QUERY WITH scoped AS (
 SELECT cp.id,cp.alias,cp.contact_email,cp.created_at,
  (SELECT max(t.at) FROM loyalty_transactions t JOIN memberships ms ON ms.id=t.membership_id WHERE ms.profile_id=cp.id AND t.type='award' AND branch_access(mid,t.branch_id) AND (bid IS NULL OR t.branch_id=bid)) AS last_purchase_at,
  (SELECT count(DISTINCT t.purchase_id)::int FROM loyalty_transactions t JOIN memberships ms ON ms.id=t.membership_id WHERE ms.profile_id=cp.id AND t.type='award' AND branch_access(mid,t.branch_id) AND (bid IS NULL OR t.branch_id=bid)) AS visits,
  (SELECT coalesce(sum(t.quantity),0)::int FROM loyalty_transactions t JOIN memberships ms ON ms.id=t.membership_id WHERE ms.profile_id=cp.id AND t.type IN ('award','correction') AND branch_access(mid,t.branch_id) AND (bid IS NULL OR t.branch_id=bid)) AS net_stamps
 FROM tenant_customer_profiles cp WHERE cp.merchant_id=mid AND (profile_arg IS NULL OR cp.id=profile_arg) AND (owner_full_customer_scope(mid) AND bid IS NULL OR EXISTS(SELECT 1 FROM memberships ms WHERE ms.profile_id=cp.id AND ((branch_access(mid,ms.origin_branch_id) AND (bid IS NULL OR ms.origin_branch_id=bid)) OR EXISTS(SELECT 1 FROM loyalty_transactions t WHERE t.membership_id=ms.id AND branch_access(mid,t.branch_id) AND (bid IS NULL OR t.branch_id=bid)))))
 ), labelled AS (SELECT *,CASE WHEN last_purchase_at IS NULL THEN 'never_active' WHEN last_purchase_at>=now()-interval '30 days' THEN 'active' ELSE 'inactive' END AS segment FROM scoped)
 SELECT to_jsonb(labelled) FROM labelled WHERE segment_arg='all' OR segment=segment_arg ORDER BY created_at DESC,id LIMIT limit_arg OFFSET offset_arg;
END $$;
GRANT EXECUTE ON FUNCTION customer_directory(uuid,uuid,text,uuid,integer,integer) TO nuqta_runtime;

REVOKE SELECT ON tenant_customer_profiles FROM nuqta_runtime;
GRANT SELECT(id,merchant_id,user_id,alias,created_at) ON tenant_customer_profiles TO nuqta_runtime;
CREATE TABLE saved_segments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants(id),created_by uuid NOT NULL REFERENCES users(id),name text NOT NULL,branch_id uuid,segment text NOT NULL CHECK(segment IN ('all','active','inactive','never_active')),created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(merchant_id,branch_id) REFERENCES branches(merchant_id,id)
);
ALTER TABLE saved_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_segment_scope ON saved_segments USING(created_by=app_user() AND tenant_access(merchant_id) AND (branch_id IS NULL OR branch_access(merchant_id,branch_id))) WITH CHECK(created_by=app_user() AND tenant_access(merchant_id) AND (branch_id IS NULL OR branch_access(merchant_id,branch_id)));
GRANT SELECT,INSERT,DELETE ON saved_segments TO nuqta_runtime;
