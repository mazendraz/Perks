-- Refresh installed passes with native member fields and versioned artwork.
-- This private projection remains reachable only through the existing guarded
-- Apple/Google pass functions. Public Google artwork keeps its explicit whitelist.
CREATE OR REPLACE FUNCTION wallet_card_json(member_arg uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',ms.id,'merchant_id',m.id,'merchant_name',m.name,'program_name',p.name,'threshold',v.threshold,
  'balance',a.balance,'cycle_number',a.cycle_number,'wallet_presentation_version',2,
  'customer_name',CASE WHEN ms.status='active' AND u.status='active' THEN profile.alias ELSE '' END,
  'pending_rewards',(SELECT count(*)::int FROM reward_grants r WHERE r.membership_id=ms.id AND r.status='available' AND r.expires_at>now()),
  'display_balance',CASE WHEN EXISTS(SELECT 1 FROM reward_grants r WHERE r.membership_id=ms.id AND r.status='available' AND r.expires_at>now()) THEN v.threshold ELSE a.balance END,
  'primary_color',m.primary_color,'accent_color',m.accent_color,'surface_color',m.surface_color,'template',m.template,
  'stamp_shape',m.stamp_shape,'stamp_icon',m.stamp_icon,'stamp_style',m.stamp_style,
  'logo_asset_id',CASE WHEN m.status IN ('active','trial') THEN m.logo_asset_id END,
  'reward_title',v.reward_title,'reward_terms',v.reward_terms,
  'active',ms.status='active' AND u.status='active',
  'earning_active',p.status='active' AND m.status<>'suspended' AND (v.ends_at IS NULL OR v.ends_at>now()) AND merchant_earning_allowed(m.id))
 FROM memberships ms JOIN users u ON u.id=ms.user_id
 JOIN tenant_customer_profiles profile ON profile.id=ms.profile_id AND profile.merchant_id=ms.merchant_id AND profile.user_id=ms.user_id
 JOIN merchants m ON m.id=ms.merchant_id JOIN programs p ON p.id=ms.program_id
 JOIN program_versions v ON v.id=ms.program_version_id JOIN loyalty_accounts a ON a.membership_id=ms.id
 WHERE ms.id=member_arg
$$;
REVOKE ALL ON FUNCTION wallet_card_json(uuid) FROM PUBLIC;
