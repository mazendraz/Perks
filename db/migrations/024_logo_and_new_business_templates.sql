-- "Your logo" edition, and four more business types with two editions each:
-- workspace (cowork, studio), gym (gym, pulse), beauty (salon, spa), bakery (bakery, sweets),
-- plus their stamp symbols.
ALTER TABLE merchants DROP CONSTRAINT merchants_template_check;
ALTER TABLE merchants ADD CONSTRAINT merchants_template_check CHECK(template IN ('classic','minimal','bold','noir','editorial','botanical','ticket','mosaic','aurora','cafe','espresso','restaurant','bistro','barber','grooming','latte','roastery','carwash','detailing','confetti','waves','chalkboard','grill','vintage','foam','logomark','cowork','studio','gym','pulse','salon','spa','bakery','sweets'));
ALTER TABLE merchants DROP CONSTRAINT merchants_stamp_icon_check;
ALTER TABLE merchants ADD CONSTRAINT merchants_stamp_icon_check CHECK(stamp_icon IN ('check','star','heart','coffee','utensils','scissors','crown','flame','car','drop','bean','laptop','dumbbell','sparkle','cupcake'));

-- The Google card picture now also needs the shop and its logo (for the "Your logo" edition).
CREATE OR REPLACE FUNCTION google_wallet_strip(key_arg uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('threshold',c->'threshold','display_balance',c->'display_balance','primary_color',c->'primary_color',
  'accent_color',c->'accent_color','surface_color',c->'surface_color','template',c->'template',
  'stamp_shape',c->'stamp_shape','stamp_icon',c->'stamp_icon','stamp_style',c->'stamp_style',
  'merchant_id',c->'merchant_id','logo_asset_id',c->'logo_asset_id')
 FROM google_wallet_objects g CROSS JOIN LATERAL wallet_card_json(g.membership_id) c WHERE g.object_key=key_arg
$$;
