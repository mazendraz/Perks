-- Wallet passes now follow the shop's card edition (template colours and artwork), not only the
-- brand colour. Google's public strip projection gains the two fields it needs, still with no
-- customer or merchant identity, and every saved pass is reissued with the new artwork.
CREATE OR REPLACE FUNCTION google_wallet_strip(key_arg uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('threshold',c->'threshold','display_balance',c->'display_balance','primary_color',c->'primary_color',
  'accent_color',c->'accent_color','surface_color',c->'surface_color','template',c->'template',
  'stamp_shape',c->'stamp_shape','stamp_icon',c->'stamp_icon','stamp_style',c->'stamp_style')
 FROM google_wallet_objects g CROSS JOIN LATERAL wallet_card_json(g.membership_id) c WHERE g.object_key=key_arg
$$;
UPDATE wallet_passes SET fingerprint = '';
UPDATE google_wallet_objects SET fingerprint = '';
