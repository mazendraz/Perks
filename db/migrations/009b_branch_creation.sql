CREATE FUNCTION create_merchant_branch(mid uuid,name_arg text,address_arg text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE limits feature_entitlements;b branches;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.role='owner' AND s.status='active' AND u.status='active') THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 PERFORM id FROM merchants WHERE id=mid AND status IN ('active','trial') FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'NQ:MERCHANT_PAUSED';END IF;
 SELECT * INTO limits FROM feature_entitlements WHERE merchant_id=mid FOR UPDATE;
 IF NOT FOUND OR (SELECT count(*) FROM branches WHERE merchant_id=mid)>=limits.max_branches THEN RAISE EXCEPTION 'NQ:PLAN_LIMIT';END IF;
 IF length(trim(name_arg)) NOT BETWEEN 2 AND 100 OR length(address_arg)>500 THEN RAISE EXCEPTION 'NQ:INVALID_QUERY';END IF;
 INSERT INTO branches(merchant_id,name,address) VALUES(mid,name_arg,address_arg) RETURNING * INTO b;
 INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) SELECT merchant_id,id,b.id FROM staff_memberships WHERE merchant_id=mid AND role='owner' AND status='active';
 RETURN to_jsonb(b);
END $$;
GRANT EXECUTE ON FUNCTION create_merchant_branch(uuid,text,text) TO nuqta_runtime;
