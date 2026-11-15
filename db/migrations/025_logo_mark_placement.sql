-- "Your logo" edition: the owner chooses where the large logo sits (centre, a side or a corner)
-- and how much of it runs past the card edge.
ALTER TABLE merchants
 ADD COLUMN logo_mark_position text NOT NULL DEFAULT 'center' CHECK(logo_mark_position IN ('center','top','bottom','left','right','top-left','top-right','bottom-left','bottom-right')),
 ADD COLUMN logo_mark_bleed integer NOT NULL DEFAULT 0 CHECK(logo_mark_bleed BETWEEN 0 AND 60);

-- Public shop brand (web card design) gets both settings.
CREATE OR REPLACE VIEW public_merchant_brands WITH (security_barrier=true) AS SELECT id,slug,name,status,timezone,primary_color,accent_color,surface_color,template,terms,logo_asset_id,stamp_shape,stamp_icon,stamp_style,logo_style,logo_size,logo_mark_position,logo_mark_bleed FROM merchants WHERE status IN ('active','trial');

-- Customer's saved cards.
ALTER FUNCTION my_cards() RENAME TO my_cards_core;
REVOKE ALL ON FUNCTION my_cards_core() FROM PUBLIC;
CREATE FUNCTION my_cards() RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT c || jsonb_build_object('logo_mark_position',m.logo_mark_position,'logo_mark_bleed',m.logo_mark_bleed)
 FROM my_cards_core() c JOIN merchants m ON m.id=(c->>'merchant_id')::uuid
$$;
GRANT EXECUTE ON FUNCTION my_cards() TO nuqta_runtime;

-- Apple and Google Wallet cards.
ALTER FUNCTION wallet_card_base_json(uuid) RENAME TO wallet_card_core_json;
CREATE FUNCTION wallet_card_base_json(member_arg uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT c || jsonb_build_object('logo_mark_position',m.logo_mark_position,'logo_mark_bleed',m.logo_mark_bleed)
 FROM wallet_card_core_json(member_arg) c JOIN merchants m ON m.id=(c->>'merchant_id')::uuid
$$;
REVOKE ALL ON FUNCTION wallet_card_core_json(uuid),wallet_card_base_json(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION google_wallet_strip(key_arg uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('threshold',c->'threshold','display_balance',c->'display_balance','primary_color',c->'primary_color',
  'accent_color',c->'accent_color','surface_color',c->'surface_color','template',c->'template',
  'stamp_shape',c->'stamp_shape','stamp_icon',c->'stamp_icon','stamp_style',c->'stamp_style',
  'merchant_id',c->'merchant_id','logo_asset_id',c->'logo_asset_id',
  'logo_mark_position',c->'logo_mark_position','logo_mark_bleed',c->'logo_mark_bleed')
 FROM google_wallet_objects g CROSS JOIN LATERAL wallet_card_json(g.membership_id) c WHERE g.object_key=key_arg
$$;
