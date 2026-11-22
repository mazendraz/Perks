# Analytics — Phase A: أساس الداتا

> المواصفات: `docs/ANALYTICS-PLAN.md` · القواعد العامة: `docs/analytics/README.md`
> ابدأ المرحلة دي بس لما اللي قبلها تخلص وكل اختباراتها خضرا.

## Phase A — أساس الداتا (مفيش تغيير في الشكل)

### A1 — تعريف الزيارة الصح  ·  `040_business_date_visits.sql`
**المشكلة:** الختم الأوتوماتيك والختم من غير ريسيت مش بيتحسبوا زيارة.

**الـmigration:**
1. `ALTER TABLE loyalty_transactions ADD COLUMN business_date date;`
2. Trigger `BEFORE INSERT` بيملاه: `(NEW.at AT TIME ZONE m.timezone)::date` من `merchants`.
3. Backfill على دفعات (10k صف كل مرة) لكل الصفوف القديمة، بعدها `SET NOT NULL`.
4. Index: `CREATE INDEX tx_visits ON loyalty_transactions(merchant_id, business_date, membership_id) WHERE type='award' AND source<>'welcome';`
5. View `visits_v`: صف واحد لكل `(membership_id, business_date)`:
   - `merchant_id, membership_id, profile_id, business_date`
   - `first_at` (أول ختم في اليوم)، `branch_id` و`staff_id` بتوع أول ختم، `stamps` (مجموع اليوم)، `receipts text[]`
   - شروط: `type='award' AND source<>'welcome'` ومش متلغي بتصحيح (نفس تعريف الإلغاء في `026_auto_stamp_revocation.sql`: correction بـ`original_transaction_id` = الـtx ده).
   - `security_invoker = true` عشان الـRLS يشتغل.

**الكود:** `reporting.ts` — `/today` و`/overview` و`trend` يعدّوا الزيارات من `visits_v` بدل `coalesce(purchase_id, receipt_note…)`. نص التعريف في `definitions.visits` يتحدّث.

**اختبارات** (`tests/integration/visits.test.ts`):
- ختم أوتوماتيك = زيارة.
- ختمين لنفس العميل في نفس اليوم (حتى من فرعين) = زيارة واحدة.
- 11:59م و 12:01ص بتوقيت القاهرة = زيارتين.
- welcome مش زيارة. ختم اتلغى مش زيارة.
- العدد في `/today` = `/overview` = `visits_v`.

**خلصت لما:** الاختبارات خضرا + query مقارنة على داتا الـdemo بتوضح الفرق القديم/الجديد ومتسجلة في الـcommit message.

---

### A2 — نوع النشاط وأيام الرجوع  ·  `041_business_cadence.sql`
**الـmigration:**
1. جدول `analytics_category_defaults(category text PK, expected_gap_days int, at_risk_after_days int, lost_after_days int, updated_at)` — RLS: قراءة للكل، كتابة للـplatform admin بس. Seed من جدول §3 في المواصفات.
2. `merchants` + `business_category text NOT NULL DEFAULT 'other'` (CHECK من القايمة) + `expected_gap_days int NULL`, `at_risk_after_days int NULL`, `lost_after_days int NULL` بـCHECKs: `1 ≤ gap < risk < lost ≤ 365`.
3. Backfill للفئة من `template`/`stamp_icon` لما يكون واضح (scissors→barber، carwash templates→carwash، coffee→cafe، utensils→restaurant)، والباقي `other`.
4. Function `merchant_cadence(mid) RETURNS TABLE(gap int, risk int, lost int, source text)`: override المحل ← default الفئة ← `other`. لو المحل غيّر `gap` بس: `risk = ceil(gap*1.5)`، `lost = max(gap*3, default lost)`.

**الـAPI:** `PATCH /merchants/:m/cadence` (owner بس) + الحقول في `GET` بتاع إعدادات المحل. Super Admin: `PATCH /platform/analytics-defaults/:category`.

**الواجهة:**
- Onboarding: خطوة «نوع نشاطك» (grid أيقونات، ضغطة واحدة).
- إعدادات المحل: كارت «زباينك بيرجعوا كل قد إيه؟» — رقمين (عادي / بعد خلاص) متعبيين، تحتهم «الأرقام دي متعارف عليها في [الفئة]» + زرار «رجّع الافتراضي».
- محل قديم فئته `other`: banner صغير في الصفحة الرئيسية «اختار نوع نشاطك عشان التحليلات تبقى أدق».

**اختبارات:** القيم الافتراضية لكل فئة، override، CHECKs بترفض قيم غلط، الكاشير مايقدرش يعدّل.

---

### A3 — حماية مميزات المشتركين  ·  `042_entitlement_snapshots.sql`
**ده للمنصة كلها، مش التحليلات بس.**

**الـmigration:**
1. `merchant_subscriptions` + `entitlements_snapshot jsonb NULL`, `snapshot_until timestamptz NULL`.
2. Function `take_entitlement_snapshot(mid)`: يحفظ ناتج مميزات الباقة الحالية + `snapshot_until = current_period_end`.
3. تتنادى في كل مكان الفترة بتبدأ أو تتجدد أو تترقّى: `subscriptions.ts` (السطور اللي بتعمل `current_period_end=` حوالين 131 و242) + `advance_subscription_states()`.
4. `effective_entitlements(mid)` (`CREATE OR REPLACE`): لو `now() < snapshot_until` → لكل مفتاح ناخد **الأحسن** بين الـsnapshot والباقة الحالية:
   - `int` → الأكبر، `unlimited` يكسب، `bool` → OR، `enum` → الأعلى في ترتيب معرّف (`analytics_level`: basic < branches < advanced؛ `reminders`: reward_near < all؛ `support_level`: standard < priority < account_manager < sla).
   - بعد `snapshot_until` → الباقة الحالية بس.
5. **فتح التحليلات للكل دلوقتي:** `UPDATE plan_entitlements SET enum_value='advanced' WHERE key='analytics_level';`
6. Backfill: snapshot لكل اشتراك شغال دلوقتي (**بعد** خطوة 5، فكل المشتركين الحاليين محميين على `advanced` لحد آخر فترتهم).

**الكود:** مفيش تغيير في `getEntitlements` — هي بتنادي `effective_entitlements` أصلاً.

**اختبارات** (`tests/integration/entitlement-snapshots.test.ts`):
- نقلّل `max_branches` في الباقة → المشترك الحالي محتفظ بالقديم لحد `current_period_end`، وبعدها ياخد الجديد.
- ترقية في نص الفترة → ياخد الأحسن فوراً.
- تجديد → snapshot جديد من الباقة الحالية.
- كل اختبارات `entitlements.test.ts` و`entitlement-enforcement.test.ts` الموجودة لسه خضرا.

---

### A4 — ملخص كل عميل والشرايح  ·  `043_customer_stats.sql`
**الـmigration:**
1. `classify_lifecycle(visits int, since_days int, joined_days int, gap numeric, risk numeric, lost numeric, was_lost_recently bool) RETURNS text IMMUTABLE` — جدول §3 بالحرف. **ده المكان الوحيد للقواعد.**
2. جدول `customer_stats` (الأعمدة من §2.4 في المواصفات، من غير أعمدة مبالغ ولا order tags) + index `(merchant_id, lifecycle)` و `(merchant_id, last_visit_at)`.
3. `customer_segment_changes(id, merchant_id, membership_id, from_lifecycle, to_lifecycle, at)`.
4. `merchant_daily_stats(merchant_id, day, customers, active_30d, new_customers, visits, lifecycle_counts jsonb, PRIMARY KEY(merchant_id, day))`.
5. `refresh_customer_stats(membership uuid)`: يحسب صف عميل واحد من `visits_v` + `loyalty_accounts` + `program_versions` + `reward_grants` + `wallet_passes`/`google_wallet_objects`، و`gap` الشخصي = median الفترات لو ≥3 زيارات، محصور بين `merchant gap × 0.5` و `× 3`. لو الـlifecycle اتغير → صف في `customer_segment_changes`.
6. `refresh_merchant_stats(mid)`: نفس الحساب بس set-based لكل عملاء المحل في query واحدة (مش loop) + يكتب صف النهارده في `merchant_daily_stats`.
7. Triggers `AFTER INSERT` على `loyalty_transactions` (`NEW.membership_id`) و`reward_events` (مفيهوش membership — نجيبه من `reward_grants` بـ`NEW.reward_id`) → `refresh_customer_stats(...)` (عميل واحد = سريع، وفي نفس الـtransaction فالداتا دايماً متسقة).
8. `analytics_refresh_due() RETURNS SETOF uuid`: المحلات اللي يومها (بتوقيتها) اتغير من آخر refresh.
9. RLS: نفس نطاق `customer_directory` (owner بيشوف الكل لو `owner_full_customer_scope`، غير كده حسب الفروع).

**الـworker:** `apps/worker/src/analytics-refresh.ts` — في الـsweep كل دقيقة: لكل محل من `analytics_refresh_due()` → `refresh_merchant_stats`. لوج `analytics.refresh` بالمدة.

**Backfill:** `tools/backfill-analytics.ts` + سكريبت npm `analytics:backfill` — idempotent، محل محل، بيطبع التقدم.

**اختبارات:**
- `tests/integration/customer-segments.test.ts` — table-driven: عميل لكل حالة (never/new/one_time/regular/at_risk/lost/reactivated + tags) لكل فئة، والوقت بيتحرك بـ`clock` الاختبار.
- ختم جديد بيغيّر الشريحة فوراً.
- الـbatch والـsingle بيطلعوا نفس النتيجة على نفس الداتا.
- محل مايشوفش عملاء محل تاني. مدير فرع يشوف عملاء فرعه بس.
- **أداء** (في `load.test.ts`): محل فيه 20,000 عميل و300,000 ختم → `refresh_merchant_stats` < 3 ثواني، `refresh_customer_stats` < 20ms.

**خلصت Phase A لما:** كل ده متعمل deploy، الـbackfill اتشغّل على production، وأرقام `customer_stats` اتراجعت يدوي على 3 محلات حقيقية.

---
