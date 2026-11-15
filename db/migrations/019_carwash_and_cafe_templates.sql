-- New card templates: two more café editions (latte, roastery) and a car wash category
-- (carwash, detailing), with stamp symbols for them (car, drop, bean).
ALTER TABLE merchants DROP CONSTRAINT merchants_template_check;
ALTER TABLE merchants ADD CONSTRAINT merchants_template_check CHECK(template IN ('classic','minimal','bold','noir','editorial','botanical','ticket','mosaic','aurora','cafe','espresso','restaurant','bistro','barber','grooming','latte','roastery','carwash','detailing'));
DO $$ DECLARE c text; BEGIN
 SELECT conname INTO c FROM pg_constraint WHERE conrelid='merchants'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%stamp_icon%';
 EXECUTE format('ALTER TABLE merchants DROP CONSTRAINT %I',c);
END $$;
ALTER TABLE merchants ADD CONSTRAINT merchants_stamp_icon_check CHECK(stamp_icon IN ('check','star','heart','coffee','utensils','scissors','crown','flame','car','drop','bean'));
