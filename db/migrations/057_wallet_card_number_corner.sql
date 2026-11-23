-- Add the number to the private Apple pass payload. Google already receives it.
-- The public Google artwork function selects its image fields explicitly.
CREATE OR REPLACE FUNCTION wallet_card_base_json(member_arg uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT c || jsonb_build_object('logo_mark_position',m.logo_mark_position,'logo_mark_bleed',m.logo_mark_bleed)
  || CASE WHEN n.card_number IS NOT NULL THEN jsonb_build_object('card_number',n.card_number)
     ELSE '{}'::jsonb END
 FROM wallet_card_core_json(member_arg) c JOIN merchants m ON m.id=(c->>'merchant_id')::uuid
 LEFT JOIN membership_card_numbers n ON n.membership_id=member_arg AND (c->>'active')::boolean
$$;

CREATE OR REPLACE FUNCTION google_wallet_card_json(member_arg uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT wallet_card_json(member_arg)
$$;
