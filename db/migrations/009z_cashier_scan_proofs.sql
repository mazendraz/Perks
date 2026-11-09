-- A request approval must follow a holder QR scan, not merely know a request ID.
ALTER TABLE presentation_tokens DROP CONSTRAINT presentation_tokens_purpose_check;
ALTER TABLE presentation_tokens ADD CONSTRAINT presentation_tokens_purpose_check
 CHECK(purpose IN ('customer_presentation','cashier_lookup','cashier_scan'));
ALTER TABLE presentation_tokens ADD COLUMN source_presentation_id uuid;
ALTER TABLE presentation_tokens ADD CONSTRAINT presentation_tenant_key UNIQUE(merchant_id,id);
ALTER TABLE presentation_tokens ADD CONSTRAINT scan_source_tenant FOREIGN KEY(merchant_id,source_presentation_id) REFERENCES presentation_tokens(merchant_id,id);
ALTER TABLE presentation_tokens ADD CONSTRAINT scan_source_required CHECK(purpose<>'cashier_scan' OR (source_presentation_id IS NOT NULL AND branch_id IS NOT NULL));
CREATE FUNCTION valid_customer_presentation(proof_arg uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM presentation_tokens p
 JOIN presentation_tokens original ON original.id=coalesce(p.source_presentation_id,p.id) AND original.merchant_id=p.merchant_id AND original.membership_id=p.membership_id
 JOIN memberships m ON m.id=original.membership_id AND m.merchant_id=original.merchant_id
 JOIN sessions s ON s.id=original.session_id AND s.user_id=original.created_by
 JOIN users u ON u.id=s.user_id
 WHERE p.id=proof_arg AND member_access(p.membership_id)
 AND p.purpose IN ('customer_presentation','cashier_scan') AND original.purpose='customer_presentation'
 AND original.created_by=m.user_id AND m.status='active' AND u.status='active'
 AND p.expires_at>clock_timestamp() AND original.expires_at>clock_timestamp()
 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.credential_version=u.password_version)
$$;
REVOKE ALL ON FUNCTION valid_customer_presentation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION valid_customer_presentation(uuid) TO nuqta_runtime;
