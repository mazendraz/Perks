-- What kind of business a shop is, and how often its customers normally come back.
-- Analytics uses these to tell "late" from "normal": a café customer gone 20 days is late, a
-- barber customer gone 20 days is not. Defaults per category come from loyalty-industry norms and
-- live in a table the platform team can tune; each shop can set its own numbers on top.
-- Additive: new table, new nullable/defaulted columns, new functions. The running release ignores them.

CREATE TABLE analytics_category_defaults (
 category text PRIMARY KEY,
 expected_gap_days integer NOT NULL,
 at_risk_after_days integer NOT NULL,
 lost_after_days integer NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(expected_gap_days>=1 AND expected_gap_days<at_risk_after_days AND at_risk_after_days<lost_after_days AND lost_after_days<=365)
);
INSERT INTO analytics_category_defaults(category,expected_gap_days,at_risk_after_days,lost_after_days) VALUES
 ('cafe',7,14,45),('bakery',5,12,40),('restaurant',21,30,90),('barber',28,42,90),('salon',42,70,120),
 ('carwash',21,35,90),('gym',3,10,45),('workspace',7,14,45),('retail',45,90,180),('other',14,30,90);
ALTER TABLE analytics_category_defaults ENABLE ROW LEVEL SECURITY;
CREATE POLICY category_defaults_read ON analytics_category_defaults FOR SELECT USING(true);
REVOKE ALL ON analytics_category_defaults FROM PUBLIC;
GRANT SELECT ON analytics_category_defaults TO nuqta_runtime,nuqta_worker;

ALTER TABLE merchants
 ADD COLUMN business_category text NOT NULL DEFAULT 'other' REFERENCES analytics_category_defaults(category),
 ADD COLUMN business_category_confirmed boolean NOT NULL DEFAULT false,
 ADD COLUMN expected_gap_days integer,
 ADD COLUMN at_risk_after_days integer,
 ADD COLUMN lost_after_days integer,
 ADD CONSTRAINT merchant_cadence_ok CHECK(
  (expected_gap_days IS NULL OR expected_gap_days BETWEEN 1 AND 180)
  AND (at_risk_after_days IS NULL OR at_risk_after_days BETWEEN 2 AND 300)
  AND (lost_after_days IS NULL OR lost_after_days BETWEEN 3 AND 365)
  AND (expected_gap_days IS NULL OR at_risk_after_days IS NULL OR expected_gap_days<at_risk_after_days)
  AND (at_risk_after_days IS NULL OR lost_after_days IS NULL OR at_risk_after_days<lost_after_days)
  AND (expected_gap_days IS NULL OR lost_after_days IS NULL OR expected_gap_days<lost_after_days));

-- Best guess from the card the shop already chose. The owner confirms or changes it later.
UPDATE merchants SET business_category=CASE
  WHEN template IN ('cafe','espresso','latte','roastery','foam') OR stamp_icon IN ('coffee','bean') THEN 'cafe'
  WHEN template IN ('bakery','sweets') OR stamp_icon='cupcake' THEN 'bakery'
  WHEN template IN ('restaurant','bistro','grill') OR stamp_icon IN ('utensils','flame') THEN 'restaurant'
  WHEN template IN ('barber','grooming') OR stamp_icon='scissors' THEN 'barber'
  WHEN template IN ('salon','spa') THEN 'salon'
  WHEN template IN ('carwash','detailing') OR stamp_icon IN ('car','drop') THEN 'carwash'
  WHEN template IN ('gym','pulse') OR stamp_icon='dumbbell' THEN 'gym'
  WHEN template='cowork' OR stamp_icon='laptop' THEN 'workspace'
  ELSE 'other' END;

-- The shop's effective rhythm: its own numbers, else its category's, else 'other'.
-- If the owner set only the normal gap, the other two follow from it.
CREATE FUNCTION merchant_cadence(mid uuid)
RETURNS TABLE(category text,gap integer,risk integer,lost integer,customized boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT m.business_category,
  g.gap,
  coalesce(m.at_risk_after_days,CASE WHEN m.expected_gap_days IS NULL THEN d.at_risk_after_days ELSE ceil(g.gap*1.5)::int END),
  coalesce(m.lost_after_days,greatest(CASE WHEN m.expected_gap_days IS NULL THEN d.lost_after_days ELSE g.gap*3 END,
   coalesce(m.at_risk_after_days,ceil(g.gap*1.5)::int)+1)),
  (m.expected_gap_days IS NOT NULL OR m.at_risk_after_days IS NOT NULL OR m.lost_after_days IS NOT NULL)
 FROM merchants m
 JOIN analytics_category_defaults d ON d.category=m.business_category
 CROSS JOIN LATERAL (SELECT coalesce(m.expected_gap_days,d.expected_gap_days) AS gap) g
 WHERE m.id=mid
$$;
REVOKE ALL ON FUNCTION merchant_cadence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merchant_cadence(uuid) TO nuqta_runtime,nuqta_worker;

-- Owners (and the platform team) set the category and, optionally, their own numbers.
-- NULLs mean "use the category's numbers".
CREATE FUNCTION set_merchant_cadence(mid uuid,category_arg text,gap_arg integer,risk_arg integer,lost_arg integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT (is_platform_admin() OR merchant_owner(mid)) THEN RAISE EXCEPTION 'NQ:FORBIDDEN';END IF;
 IF NOT EXISTS(SELECT 1 FROM analytics_category_defaults WHERE category=category_arg) THEN RAISE EXCEPTION 'NQ:VALIDATION_FAILED';END IF;
 UPDATE merchants SET business_category=category_arg,business_category_confirmed=true,
  expected_gap_days=gap_arg,at_risk_after_days=risk_arg,lost_after_days=lost_arg
 WHERE id=mid;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 INSERT INTO audit_events(merchant_id,actor_id,action,target_id,detail)
  VALUES(mid,app_user(),'merchant.cadence_changed',mid,jsonb_build_object('category',category_arg,'gap',gap_arg,'risk',risk_arg,'lost',lost_arg));
END $$;
REVOKE ALL ON FUNCTION set_merchant_cadence(uuid,text,integer,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_merchant_cadence(uuid,text,integer,integer,integer) TO nuqta_runtime;

-- The platform team tunes a category's defaults for every shop that has not set its own.
CREATE FUNCTION set_category_defaults(category_arg text,gap_arg integer,risk_arg integer,lost_arg integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT is_platform_admin() THEN RAISE EXCEPTION 'NQ:FORBIDDEN';END IF;
 UPDATE analytics_category_defaults SET expected_gap_days=gap_arg,at_risk_after_days=risk_arg,lost_after_days=lost_arg,updated_at=now()
  WHERE category=category_arg;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 INSERT INTO audit_events(actor_id,action,detail)
  VALUES(app_user(),'platform.category_defaults_changed',jsonb_build_object('category',category_arg,'gap',gap_arg,'risk',risk_arg,'lost',lost_arg));
END $$;
REVOKE ALL ON FUNCTION set_category_defaults(text,integer,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_category_defaults(text,integer,integer,integer) TO nuqta_runtime;
