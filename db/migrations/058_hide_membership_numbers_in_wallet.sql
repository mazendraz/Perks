-- Wallet payloads omit the membership credential. Website and cashier functions
-- continue to read the same card numbers. The changed payload and design signature
-- cause the existing Wallet workers to refresh saved passes.
CREATE OR REPLACE FUNCTION wallet_card_base_json(member_arg uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT c || jsonb_build_object('logo_mark_position',m.logo_mark_position,'logo_mark_bleed',m.logo_mark_bleed)
 FROM wallet_card_core_json(member_arg) c JOIN merchants m ON m.id=(c->>'merchant_id')::uuid
$$;
