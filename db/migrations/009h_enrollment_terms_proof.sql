CREATE OR REPLACE FUNCTION public_merchant_details(slug_arg text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('merchant',jsonb_build_object('id',m.id,'slug',m.slug,'name',m.name,'status',m.status,'timezone',m.timezone,'primary_color',m.primary_color,'accent_color',m.accent_color,'surface_color',m.surface_color,'template',m.template,'terms',m.terms,'logo_asset_id',m.logo_asset_id),'branches',coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'address',b.address)) FROM branches b WHERE b.merchant_id=m.id AND b.status='active'),'[]'),'programs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'versionId',v.id,'version',v.version,'threshold',v.threshold,'rewardTitle',v.reward_title,'rewardTerms',v.reward_terms,'termsHash',encode(sha256(convert_to(m.terms||E'\n'||v.reward_terms,'UTF8')),'hex'),'termsVersion',encode(sha256(convert_to(m.terms||E'\n'||v.reward_terms,'UTF8')),'hex'))) FROM programs p JOIN program_versions v ON v.id=p.current_version_id WHERE p.merchant_id=m.id AND p.status='active' AND (v.ends_at IS NULL OR v.ends_at>now())),'[]')) FROM merchants m WHERE m.slug=slug_arg AND m.status IN ('active','trial')
$$;

CREATE FUNCTION public_enrollment_terms(pid uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('programId',p.id,'programVersionId',v.id,'termsHash',encode(sha256(convert_to(m.terms||E'\n'||v.reward_terms,'UTF8')),'hex')) FROM programs p JOIN merchants m ON m.id=p.merchant_id JOIN program_versions v ON v.id=p.current_version_id WHERE p.id=pid AND p.status='active' AND m.status IN ('active','trial') AND v.starts_at<=now() AND (v.ends_at IS NULL OR v.ends_at>now())
$$;
CREATE FUNCTION enroll_customer_with_terms(mid uuid,pid uuid,version_arg uuid,alias_arg text,source_arg text,branch_arg uuid,consents_arg jsonb,terms_hash_arg text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE merchant merchants;prog programs;ver program_versions;
BEGIN
 SELECT * INTO merchant FROM merchants WHERE id=mid FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF merchant.status NOT IN ('active','trial') THEN RAISE EXCEPTION 'NQ:MERCHANT_PAUSED';END IF;
 SELECT * INTO prog FROM programs WHERE merchant_id=mid AND id=pid FOR SHARE;IF NOT FOUND OR prog.status<>'active' THEN RAISE EXCEPTION 'NQ:PROGRAM_INACTIVE';END IF;
 IF prog.current_version_id IS DISTINCT FROM version_arg THEN RAISE EXCEPTION 'NQ:PROGRAM_VERSION_CHANGED';END IF;
 SELECT * INTO ver FROM program_versions WHERE id=version_arg;
 IF terms_hash_arg IS DISTINCT FROM encode(sha256(convert_to(merchant.terms||E'\n'||ver.reward_terms,'UTF8')),'hex') THEN RAISE EXCEPTION 'NQ:TERMS_CHANGED';END IF;
 RETURN enroll_customer(mid,pid,version_arg,alias_arg,source_arg,branch_arg,consents_arg);
END $$;
REVOKE EXECUTE ON FUNCTION enroll_customer(uuid,uuid,uuid,text,text,uuid,jsonb) FROM nuqta_runtime;
GRANT EXECUTE ON FUNCTION public_enrollment_terms(uuid),enroll_customer_with_terms(uuid,uuid,uuid,text,text,uuid,jsonb,text) TO nuqta_runtime;
