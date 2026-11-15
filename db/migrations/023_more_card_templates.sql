-- Six more card templates: confetti and waves (any business), chalkboard (café),
-- grill (restaurant), vintage (barber) and foam (car wash).
ALTER TABLE merchants DROP CONSTRAINT merchants_template_check;
ALTER TABLE merchants ADD CONSTRAINT merchants_template_check CHECK(template IN ('classic','minimal','bold','noir','editorial','botanical','ticket','mosaic','aurora','cafe','espresso','restaurant','bistro','barber','grooming','latte','roastery','carwash','detailing','confetti','waves','chalkboard','grill','vintage','foam'));
