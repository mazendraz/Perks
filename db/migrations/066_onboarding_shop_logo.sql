ALTER TABLE merchant_onboarding_drafts
 ADD COLUMN logo_id uuid,
 ADD COLUMN logo_image bytea,
 ADD COLUMN logo_width integer,
 ADD COLUMN logo_height integer,
 ADD CHECK (logo_image IS NULL OR octet_length(logo_image) BETWEEN 1 AND 2000000);
GRANT SELECT (logo_id,logo_image) ON merchant_onboarding_drafts TO nuqta_runtime;
GRANT UPDATE (logo_id,logo_image,logo_width,logo_height) ON merchant_onboarding_drafts TO nuqta_runtime;

CREATE FUNCTION attach_onboarding_logo(draft_arg uuid, hash_arg text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d merchant_onboarding_drafts;
BEGIN
 SELECT * INTO d FROM merchant_onboarding_drafts
 WHERE id=draft_arg AND owner_id=app_user() AND merchant_id IS NOT NULL AND logo_id IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 INSERT INTO assets(id,merchant_id,storage_key,mime,bytes,width,height,sha256,created_by)
 VALUES(d.logo_id,d.merchant_id,d.merchant_id::text||'/'||d.logo_id::text||'.png','image/png',
        octet_length(d.logo_image),d.logo_width,d.logo_height,hash_arg,d.owner_id);
 UPDATE merchants SET logo_asset_id=d.logo_id WHERE id=d.merchant_id;
 UPDATE merchant_onboarding_drafts SET logo_image=NULL WHERE id=d.id;
END $$;
REVOKE ALL ON FUNCTION attach_onboarding_logo(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION attach_onboarding_logo(uuid,text) TO nuqta_runtime;

CREATE FUNCTION apply_onboarding_card_design() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE merchants SET
  accent_color=coalesce(NEW.details->'setup'->>'accentColor',accent_color),
  surface_color=coalesce(NEW.details->'setup'->>'surfaceColor',surface_color),
  template=coalesce(NEW.details->'setup'->>'template',template),
  logo_style=coalesce(NEW.details->'setup'->>'logoStyle',logo_style),
  logo_size=coalesce((NEW.details->'setup'->>'logoSize')::integer,logo_size),
  stamp_shape=coalesce(NEW.details->'setup'->>'stampShape',stamp_shape),
  stamp_icon=coalesce(NEW.details->'setup'->>'stampIcon',stamp_icon),
  stamp_style=coalesce(NEW.details->'setup'->>'stampStyle',stamp_style)
 WHERE id=NEW.merchant_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION apply_onboarding_card_design() FROM PUBLIC;
CREATE TRIGGER merchant_onboarding_card_design AFTER UPDATE OF merchant_id ON merchant_onboarding_drafts
 FOR EACH ROW WHEN (OLD.merchant_id IS NULL AND NEW.merchant_id IS NOT NULL)
 EXECUTE FUNCTION apply_onboarding_card_design();
