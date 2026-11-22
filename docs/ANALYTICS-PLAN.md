# Perks Analytics — خطة التنفيذ

> الهدف: أول صفحة صاحب المحل يشوفها تبقى "التحليلات": تقوله أعمل إيه النهارده، الأرقام ماشية إزاي، وزباينه مين.
> التصميم المرجعي: canvas «Perks — صفحة تحليلات المحل (تصور)» (ديسكتوب + موبايل).
> القاعدة الذهبية: نعرض بس اللي اتقاس فعلاً. أي رقم فلوس مكتوب عليه «تقديري» أو بييجي من مبلغ فاتورة متسجل فعلاً.

---

## 1) الموجود فعلاً في المشروع (مش محتاج نبنيه)

| الداتا | فين | هنطلع منها إيه |
|---|---|---|
| تاريخ التسجيل + طريقته + فرعه | `memberships.joined_at, source (qr/nfc/link), origin_branch_id` | عملاء جداد، قناة التسجيل، الفرع اللي جاب العميل |
| كل ختم بتوقيته وفرعه والكاشير ونوعه | `loyalty_transactions (at, branch_id, staff_id, source, quantity, type)` | الزيارات، آخر زيارة، الفترات بين الزيارات، أوقات الزحمة، أداء الفروع والكاشير |
| رقم الريسيت | `loyalty_transactions.receipt_note` + `purchase_references.reference` | سجل ريسيتات كل عميل (موجود بس من غير مبلغ) |
| الرصيد الحالي + دورة الكارت | `loyalty_accounts.balance, cycle_number, last_purchase_at` + `program_versions.threshold` | فاضله كام ختم، كام كارت كمّل |
| الهدايا | `reward_grants (earned_at, expires_at, status)` + `reward_redemptions.at` | استحق/صرف/مصرفش، الوقت لحد الهدية، رجع بعد الهدية ولا لأ |
| طلبات الختم | `stamp_requests (created_at, decided_at, status, reason, decided_by)` | وقت موافقة الكاشير، نسبة الرفض وأسبابه، الطلبات المستنية |
| محاولات اتمنعت | `stamp_collection_checks.outcome` (location/limit/cooldown…) | نشاط غير معتاد، محاولات بره الفرع |
| فتح الكارت | `customer_experience_events (card_open)` | تفاعل العميل من غير زيارة |
| حفظ في Wallet | `wallet_passes`, `wallet_registrations`, `google_wallet_objects` | كام عميل حفظ الكارت في Apple/Google |
| رسايل صاحب المحل + التذكيرات | `wallet_messages (audience: all/reward_ready/near_reward/inactive)`, `wallet_message_deliveries`, `customer_reminders` | مين اتبعتله إمتى → قياس مين رجع بعد الرسالة |
| منطقة المحل الزمنية | `merchants.timezone` | اليوم التجاري الصح |
| مستوى التقارير في الباقة | `plan_entitlements.analytics_level = basic / branches / advanced` | قفل أجزاء حسب الباقة (متعرّف بس **مش متطبق** في الـAPI) |
| Endpoints حالية | `reporting.ts`: `/today`, `/overview`, `/staff-activity` | هنبني جنبهم، مش هنكسرهم |

---

## 2) الناقص / المشاكل اللي لازم تتصلّح

### 2.1 مشكلة في تعريف «الزيارة» (أهم حاجة)
النهارده الزيارة = `count(DISTINCT coalesce(purchase_id, CASE WHEN receipt_note IS NOT NULL THEN id END))`.
يعني **الختم الأوتوماتيك بالموقع (`source='auto'`) مش بيتحسب زيارة خالص**، وأي ختم من غير ريسيت مش بيتحسب.
- **الحل:** زيارة = عميل واحد × يوم تجاري واحد (بتوقيت المحل) فيه ختم `award` مش `welcome` ومش متلغي بتصحيح.
- ده متسق مع قاعدة «يوم جديد = ختم جديد».
- يتعمل كـ SQL view واحد `visits_v` وكل التقارير تقرا منه (overview, today, analytics).

### 2.2 الفلوس: من غير ما نسأل المحل بيدخل كام
**قرار:** مفيش خانة «مبلغ الفاتورة» عند الكاشير، ومش بنخزّن أي مبالغ على السيرفر.
السبب: صاحب المحل مش هيحب يقول دخله (خوف من الضرايب، الموظفين يشوفوا، أو المنصة تعرف).

بدلها:
1. **العملة الأساسية = الزيارات.** الرقم اللي بنبيع بيه Perks: «رجّعلك X زيارة من زباين راجعين» و «Y زيارة بعد رسايلك».
2. **حاسبة على جهاز صاحب المحل بس:** لو حب يشوف فلوس، يكتب متوسط الفاتورة مرة واحدة. الرقم يتحفظ في `localStorage` على جهازه، والحساب يحصل في المتصفح. الرقم ده مش بيتبعت للسيرفر، ولا الكاشير ولا Perks يشوفوه. الكارت مكتوب عليه «تقديري، الرقم ده على جهازك بس».
3. **(متأجل) نوع الطلب من غير سعر:** صاحب المحل يعرّف 3–6 أزرار (مثلاً: قهوة / مشروب بارد / أكل، أو حلاقة / دقن / باكدج). الكاشير يدوس زرار واحد وقت الموافقة. بيدي «المنتجات المفضلة لكل عميل» من غير أي أرقام فلوس. عمود `loyalty_transactions.order_tag text NULL` + `merchant_order_tags`.
4. **ربط POS** (Enterprise بس، لو المحل طلبه بنفسه): ساعتها بس المبالغ الحقيقية تدخل.

### 2.3 مفيش نوع نشاط للمحل
الـ`template` مش مصدر موثوق. نضيف `merchants.business_category`:
`cafe | restaurant | bakery | barber | salon | carwash | retail | workspace | gym | other`.
بنستخدمه في القيم الافتراضية لمعدّل الرجوع (عميل الحلاق اللي غاب 20 يوم طبيعي، عميل الكافيه لأ).

### 2.4 مفيش «ملخص لكل عميل» محسوب
حساب الشرايح لكل العملاء مع كل فتحة صفحة هيبقى تقيل مع الوقت. نضيف جدول كاش:

```sql
CREATE TABLE customer_stats (
  merchant_id uuid NOT NULL, membership_id uuid PRIMARY KEY, profile_id uuid NOT NULL,
  joined_at timestamptz NOT NULL,
  first_visit_at timestamptz, last_visit_at timestamptz,
  visits_total int NOT NULL DEFAULT 0, visits_90d int NOT NULL DEFAULT 0,
  median_gap_days numeric,           -- معدل رجوعه الشخصي
  expected_gap_days numeric NOT NULL,-- personal لو عنده ≥2 فترات، وإلا default الفئة
  stamps_to_reward int,              -- threshold - balance
  rewards_earned int NOT NULL DEFAULT 0, rewards_redeemed int NOT NULL DEFAULT 0,
  has_open_reward boolean NOT NULL DEFAULT false,
  lifecycle text NOT NULL,           -- new | one_time | regular | at_risk | lost | reactivated | never
  tags text[] NOT NULL DEFAULT '{}', -- vip, near_reward, reward_holder
  lifecycle_since timestamptz NOT NULL,
  favorite_branch_id uuid, wallet_saved boolean NOT NULL DEFAULT false,
  refreshed_at timestamptz NOT NULL
);
CREATE INDEX customer_stats_segment ON customer_stats(merchant_id, lifecycle);
```
- يتحدّث **فوراً** للعميل ده بعد كل ختم/صرف هدية (في نفس الـtransaction أو outbox job).
- و**مرة كل ليلة** لكل العملاء من الـworker (عشان «اتأخر» بيحصل من غير أي حدث).
- RLS زي باقي الجداول: كل محل يشوف عملاؤه بس، وبحسب `branch_access`.

### 2.5 تاريخ الشرايح
عشان «رجع بعد انقطاع» و«الشريحة دي زادت ولا قلّت»: جدول `customer_segment_changes (membership_id, from, to, at)` يتكتب لما `lifecycle` يتغير. + `merchant_daily_stats (merchant_id, day, segment counts, visits, new)` يتكتب كل ليلة للمقارنات السريعة.

### 2.6 جمهور الرسايل ضيق
`wallet_messages.audience` فيها `all/reward_ready/near_reward/inactive` بس. نوسعها:
`one_time | at_risk | lost | new | vip | segment` (+ `segment_key`). كده كل زرار في كروت «النهارده تعمل إيه» يفتح كاتب الرسالة على الشريحة الصح.

**قرار — شكل زرار الأكشن:** الزرار يفتح نافذة معاينة (bottom sheet على الموبايل، dialog على الديسكتوب) فيها:
- مين هيوصله: اسم الشريحة + العدد (+ «شوف الأسامي»).
- الرسالة مكتوبة جاهزة حسب الشريحة، وقابلة للتعديل (150 حرف).
- معاينة شكل الإشعار على Apple/Google Wallet.
- الرصيد: «فاضلك X رسالة الشهر ده».
- زرار واحد «ابعت». بعد الضغط: الإرسال على طول من غير تأكيد تاني.

### 2.7 قياس أثر الرسايل
`wallet_message_deliveries` موجودة → نحسب «رجع خلال 7/14 يوم بعد الرسالة».
للدقة (المرحلة 3): `holdout boolean` — ~10% من الشريحة مايتبعتلهمش، ونقارن رجوعهم باللي اتبعتلهم.

### 2.8 الباقات — كل حاجة مفتوحة دلوقتي
**قرار:** في البداية مفيش أي جزء مقفول في أي باقة. الهدف إن الناس تحب التحليلات.
بس نبني البنية من دلوقتي عشان القفل بعدين يبقى تغيير إعدادات مش كود:
1. كل جزء في الصفحة ليه مفتاح ثابت (`analytics.actions`, `analytics.segment_list`, `analytics.funnel`, `analytics.heat`, `analytics.health`, `analytics.message_impact`, `analytics.cohorts`, `analytics.export`, …).
2. الـAPI والواجهة يسألوا `can(merchant, key)` قبل ما يرجّعوا/يعرضوا الجزء. النهارده كل المفاتيح `true` لكل الباقات.
3. مكون `LockedBadge` جاهز للجزء المقفول (معاينة مغبّشة + «متاحة في باقة X» + زرار ترقية)، بس مش مستخدم لحد ما نقرر.

**التوزيع المستقبلي المقترح (مش مفعّل):**

| الجزء | Starter | Growth | Pro | Scale |
|---|:-:|:-:|:-:|:-:|
| كروت الأكشن، الأرقام، الرسم، «رجّعلك كام زيارة»، الشرايح بالأرقام، أول 5 اتأخروا | ✓ | ✓ | ✓ | ✓ |
| قايمة كل عملاء الشريحة، صفحة العميل، رحلة الكارت، توزيع الزيارات، الفروع، فترة 90 يوم | — | ✓ | ✓ | ✓ |
| أوقات الزحمة، صحة البرنامج، أثر الرسايل | — | — | ✓ | ✓ |
| مقارنة الشهور، holdout، تصدير، فترة سنة | — | — | — | ✓ |

**حماية المشتركين الحاليين (grandfathering) — قرار:**
اللي اشترك في باقة بمميزات معينة، المميزات دي تفضل معاه لحد ما فترة اشتراكه الحالية تخلص، حتى لو قفلنا حاجة في الباقة بعدين.
- النهارده المميزات بتتقري live من `plan_entitlements`، يعني أي تغيير في الباقة بيأثر على الكل فوراً. **ده محتاج يتغير لكل المنصة مش للتحليلات بس.**
- Migration: `merchant_subscriptions.entitlements_snapshot jsonb` + `snapshot_taken_at`. بيتكتب لما الاشتراك يبدأ أو يتجدد أو يترقى.
- `effectiveEntitlements` = لو `now() < current_period_end` → snapshot ∪ (مميزات الباقة الحالية لو أحسن)، وبعد ما الفترة تخلص → مميزات الباقة الحالية.
- لو هنقفل حاجة: نبعت لصاحب المحل قبلها برسالة داخل الداشبورد «الجزء ده هيبقى في باقة X من تجديدك الجاي يوم ...».
- Backfill: كل الاشتراكات الحالية تاخد snapshot من مميزات باقتها النهارده.

---

## 3) إمتى العميل يعتبر «اتأخر» أو «بعد»

### المبدأ (المتعارف عليه في أنظمة الولاء)
- الأدق إن كل عميل يتقاس على **إيقاعه هو** مش رقم ثابت للكل: عميل بيجي كل 4 أسابيع واتأخر لـ6 يبقى في خطر، وعميل بييجي مرتين في السنة طبيعي جداً لو غاب 150 يوم.
- **في خطر** = غاب أكتر من **1.5×** معدّله المعتاد.
- **بعد** = غاب حوالي **3×** معدّله (أبحاث المطاعم بتقول إن عند 80–90 يوم لعميل شهري، يعني ~3× معدله، الغياب مابقاش «عادي»).
- لعميل جديد أو عنده زيارة/زيارتين بس (مفيش إيقاع شخصي): نستخدم أرقام الفئة تحت.

### الأرقام الافتراضية لكل فئة

| الفئة | العادي بيرجع كل | في خطر بعد | بعد خلاص بعد | المرجع |
|---|---|---|---|---|
| كافيه | 7 أيام | 14 يوم | 45 يوم | الزبون المنتظم 2–4 مرات في الأسبوع؛ اللي بييجي مرتين في الأسبوع وغاب 30 يوم يعتبر lapsed |
| مخبز / عصاير | 5 أيام | 12 يوم | 40 يوم | تقدير قريب من الكافيه (مفيش مرجع مباشر) |
| مطعم | 21 يوم | 30 يوم | 90 يوم | مطعم غدا كاجوال: 30 يوم = في خطر؛ الصناعة بتستخدم 90 يوم للـchurn |
| حلاق | 28 يوم | 42 يوم | 90 يوم | متوسط ~4 أسابيع بين الحلاقات (47% كل 4 أسابيع) |
| صالون حريمي / بيوتي | 42 يوم | 70 يوم | 120 يوم | قص/صبغة كل 6–8 أسابيع؛ بيتعلّم lapsed عند 10+ أسابيع |
| مغسلة عربيات | 21 يوم | 35 يوم | 90 يوم | المنتظمين 1–3 مرات في الشهر |
| جيم / ستوديو | 3 أيام | 10 أيام | 45 يوم | تنبيه أول 7–14 يوم، خطر عالي 45–60 يوم |
| مساحة عمل (workspace) | 7 أيام | 14 يوم | 45 يوم | تقدير قريب من الكافيه |
| محلات / ملابس | 45 يوم | 90 يوم | 180 يوم | تقدير (شراء أقل تكرار) |
| تاني | 14 يوم | 30 يوم | 90 يوم | افتراضي عام |

> الأرقام دي نقطة بداية. نراجعها بعد أول 3 شهور من داتا Perks الحقيقية لكل فئة.

### صاحب المحل يقدر يغيّرها
- في الإعدادات: «زباينك بيرجعوا عادةً كل [__] يوم» + «اعتبره بعد لو غاب [__] يوم» — متعبيين مسبقاً بأرقام الفئة.
- `merchants.expected_gap_days`, `merchants.at_risk_after_days`, `merchants.lost_after_days` (NULL = استخدم الفئة). الشاشة البسيطة بتعرض أول رقم وآخر رقم بس؛ «في خطر» يتحسب تلقائي لو صاحب المحل غيّر الأول.
- رقم صاحب المحل بيستبدل رقم الفئة. الإيقاع الشخصي للعميل (لو عنده 3+ زيارات) بيفضل هو الأساس، ومحصور بين نص رقم المحل و3 أضعافه عشان مايطلعش رقم غريب.

### الشرايح
`gap` = إيقاع العميل الشخصي (median، لو ≥3 زيارات) وإلا «العادي» بتاع المحل/الفئة. `risk_after` = 1.5×gap للإيقاع الشخصي، وإلا «في خطر بعد» بتاع المحل/الفئة. `since` = أيام من آخر زيارة.

| lifecycle | القاعدة |
|---|---|
| never | سجل ومعندوش ولا زيارة |
| new | أول زيارة خلال آخر `gap` يوم |
| one_time | زيارة واحدة بس و `since > gap` و مش lost |
| regular | ≥2 زيارات و `since ≤ risk_after` |
| at_risk | `risk_after < since ≤ lost_after` |
| lost | `since > lost_after` (= max(3×gap, رقم «بعد» بتاع المحل/الفئة)) |
| reactivated | رجع بعد ما كان lost، لمدة 30 يوم بعد رجوعه |

Tags: `near_reward` (فاضله 1–2 ختم)، `reward_holder` (عنده هدية متاحة)، `vip` (أعلى 5% في زيارات آخر 90 يوم و ≥5 زيارات).

## 4) معادلات الأرقام

| الرقم | المعادلة |
|---|---|
| زيارات مؤكدة | `count(*) FROM visits_v` في الفترة |
| عملاء نشطين | عملاء ليهم زيارة في الفترة |
| عملاء جداد | `memberships.joined_at` في الفترة |
| نسبة الرجوع | عملاء ليهم ≥2 زيارات في الفترة ÷ عملاء ليهم ≥1 زيارة |
| الرجوع للزيارة التانية | من اللي أول زيارتهم كانت من 30+ يوم: نسبة اللي عملوا زيارة تانية خلال 30 يوم |
| بيرجعوا كل | median لـ `median_gap_days` للعملاء المنتظمين |
| التغيير | نفس الرقم للفترة اللي قبلها بنفس الطول |
| رحلة الكارت (funnel) | لكل عميل في الدورة الحالية/اللي فاتت: سجل → ختم 1 → ختم 2 → نص الـthreshold → استحق → صرف |
| توزيع الزيارات | عدد العملاء حسب `visits_total` (1, 2, 3, 4, 5+) |
| أوقات الزحمة | زيارات حسب (يوم الأسبوع × شريحة ساعات) بتوقيت المحل، آخر 90 يوم |
| وقت موافقة الكاشير | median `decided_at - created_at` للطلبات المقبولة، لكل فرع |
| صحة البرنامج (0–100) | 30% نسبة الرجوع + 25% الرجوع للزيارة التانية + 20% إكمال الكارت + 15% صرف الهدايا + 10% نسبة النشطين، كل واحد normalized لهدف الفئة. يظهر بعد 30 يوم/50 عميل بس |
| زيارات رجعت | زيارات العملاء اللي ليهم زيارة قبل الفترة (الرقم الأساسي للقيمة) |
| تقدير المبيعات | يتحسب في المتصفح بس: زيارات رجعت × متوسط فاتورة محفوظ على جهاز صاحب المحل. مش بيتخزن على السيرفر |

---

## 5) API

Endpoint جديد واحد للصفحة (واحد عشان الموبايل يفتح بسرعة):

`GET /api/v1/merchants/:m/analytics?days=7|30|90&branchId=`
```ts
{
  period, updatedAt, level: 'basic'|'branches'|'advanced',
  actions: [{ key: 'at_risk'|'near_reward'|'one_time'|'reward_holder', count, audience }],
  kpis: { customers, active, newCustomers, visits, returnRate, secondVisitRate, typicalGapDays,
          deltas: {...} },
  trend: [{ day, visits }],
  health: { score, weakest, parts } | null,
  funnel?: [...], distribution?: [...], heat?: number[7][5],     // branches+
  segments: [{ key, count }],
  atRisk: [{ membershipId, alias, expectedGapDays, sinceDays, stampsToReward }],   // top 5
  branches?: [{ id, name, visits, newCustomers, returnRate, medianApprovalSec, pending }],
  value: { returningVisits, visitsAfterMessages }     // الحساب بالفلوس بيحصل في المتصفح
}
```
+ `GET /merchants/:m/analytics/segments/:key` (قايمة العملاء في شريحة، paginated)
+ `GET /merchants/:m/customers/:profileId/insights` (صفحة العميل: timeline زيارات + ريسيتات + مبالغ + هدايا + رسايل اتبعتله)

كل حاجة بتمر على `merchantGrant` + `branch_access` زي `/overview`.

---

## 6) الواجهة

- `analytics` يبقى أول تاب في `MerchantPage` بدل `overview` الحالي (القديم يتشال أو يتنقل تحت «تفاصيل»).
- مكونات جديدة في `apps/web/src/features/analytics/`: `TodayActions`, `KpiRow`, `VisitsTrend`, `HealthCard`, `LoyaltyFunnel`, `VisitDistribution`, `SegmentGrid`, `PeakHeat`, `AtRiskList`, `BranchTable`, `ValueCard` (زيارات + حاسبة محلية).
- أزرار الأكشن → تفتح `WalletMessages` على الشريحة برسالة مكتوبة جاهزة (صاحب المحل يراجع ويبعت) وتحترم كوتة `manual_messages_per_month`.
- `SetupChecklist` يفضل يظهر فوق الصفحة لحد ما المحل يكمّل الإعداد. لو مفيش داتا كفاية: empty states واضحة («أول 10 زيارات وهنبدأ نوريك مين بيرجع»).
- الرسوم من غير مكتبة تقيلة (divs/SVG زي `PurchaseTrend`)، RTL، أرقام tabular.

---

## 7) المراحل

**Phase A — أساس الداتا (من غير ما الشكل يتغير)**
1. Migration: `visits_v` view + تعديل `/today` و `/overview` يقروا منه (+ test إن الختم الأوتو بيتحسب زيارة).
2. Migration: `merchants.business_category`, `expected_gap_days`, `at_risk_after_days`, `lost_after_days` + خانة الفئة في onboarding + إعداد «زباينك بيرجعوا كل كام يوم» + Super Admin.
2b. Migration (لكل المنصة): `merchant_subscriptions.entitlements_snapshot` + تعديل `effectiveEntitlements` + backfill (§2.8).
3. Migration: `customer_stats`, `customer_segment_changes`, `merchant_daily_stats` + RLS.
4. Worker job `analytics-refresh` (ليلي + بعد كل ختم/هدية) + backfill script للمحلات الحالية.
5. Tests: segment rules (unit)، backfill idempotent، العزل بين المحلات.

**Phase B — صفحة التحليلات**
1. `GET /analytics` + `/analytics/segments/:key` + فحص `can(merchant, key)` (كله مفتوح دلوقتي).
2. الواجهة (ديسكتوب + موبايل) حسب الـcanvas، وتبقى أول تاب.
3. Empty states + ترجمة إنجليزي.
4. E2E: محل جديد / محل فيه داتا / محل غيّر أيام الرجوع.

**Phase C — من التحليل للأكشن**
1. توسيع `wallet_messages.audience` للشرايح.
2. أزرار الأكشن تفتح نافذة المعاينة (الشريحة + العدد + الرسالة الجاهزة + الرصيد) → «ابعت».
3. أثر كل رسالة: «اتبعتت لـ X — رجع منهم Y خلال 7 أيام».
4. صفحة العميل `/customers/:id/insights` (timeline + ريسيتات).

**Phase D — القيمة والمتقدم**
1. كارت «Perks رجّعلك كام زيارة» + الحاسبة المحلية (localStorage، من غير API).
2. Health score.
3. ~~أزرار نوع الطلب~~ — متأجلة.
4. Holdout للرسايل + cohorts شهرية + تصدير.
5. ربط POS للـEnterprise عند الطلب.

---

## 8) القرارات
- [x] مبلغ الفاتورة: مش هنسأل عنه. القيمة بالزيارات، والفلوس حاسبة على جهاز صاحب المحل بس.
- [x] أيام الرجوع: أرقام افتراضية لكل فئة (§3) + صاحب المحل يقدر يغيّرها + إيقاع كل عميل الشخصي.
- [x] أزرار الأكشن: نافذة معاينة → «ابعت» يبعت على طول.
- [x] الباقات: كل حاجة مفتوحة دلوقتي، والبنية جاهزة للقفل بعدين. المشترك يحتفظ بمميزات باقته لحد آخر فترته.
- [x] أزرار نوع الطلب: متأجلة خالص (مش في أي مرحلة دلوقتي).
