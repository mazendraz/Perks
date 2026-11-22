# Perks Analytics — Build Plan (تنفيذ خطوة بخطوة)

> **المواصفات (إيه اللي بنبنيه):** `docs/ANALYTICS-PLAN.md`
> **التصميم:** canvas «Perks — صفحة تحليلات المحل (تصور)» — نسخة ديسكتوب 1440 + موبايل 390.
> **الملف ده (إزاي نبنيه):** كل خطوة صغيرة، ليها ملفات محددة، اختبارات، وشرط «خلصت».
> اشتغل بالترتيب. ماتبدأش خطوة قبل ما اللي قبلها يعدّي شرط «خلصت».

---

## المراحل
| المرحلة | الملف |
|---|---|
| A — أساس الداتا | `phase-A.md` |
| B — صفحة التحليلات | `phase-B.md` |
| C — من الرقم للأكشن | `phase-C.md` |
| D — المتقدم | `phase-D.md` |

## 0. قواعد ثابتة لكل الشغل

### 0.1 الريبو
- الشغل على `master` مباشرة (حسب `CLAUDE.md`). commit لكل خطوة، رسالة واضحة بالإنجليزي.
- قبل أي commit: `npm run typecheck && npm run lint && npm test` + الـintegration tests الخاصة بالخطوة.
- مفيش مكتبات جديدة (لا charts ولا state managers). الرسوم divs/SVG زي `PurchaseTrend.tsx`.

### 0.2 قاعدة البيانات
- Migrations جديدة تبدأ من `040_`. كل migration **additive** (تضيف ومابتكسرش)، زي ستايل `039_reward_cycle.sql`: تعليق في أولها بيشرح هي بتعمل إيه وإن الـrelease الشغال مش هيتأثر.
- كل جدول جديد: `ENABLE ROW LEVEL SECURITY` + policy بـ`tenant_access` / `branch_access` + `REVOKE ALL ... FROM PUBLIC` + `GRANT` محدد لـ`nuqta_runtime` / `nuqta_worker`.
- كل function: `SECURITY DEFINER SET search_path=public,pg_temp` + `REVOKE`/`GRANT` صريح.
- **مصدر الحقيقة الواحد للمنطق:** قواعد الشرايح والزيارة بتتكتب **مرة واحدة في SQL**. الـAPI والـworker بينادوا نفس الـfunction. ممنوع نكرر المنطق في TypeScript.

### 0.3 الـAPI
- Module جديد `apps/api/src/modules/analytics.ts`، متسجل في `server.ts` زي باقي الـmodules.
- كل الأشكال (request/response) بـzod في `packages/contracts/src/analytics.ts`، والويب يستورد نفس الـtypes.
- الصلاحيات: `merchantGrant(db, actor, m, ['owner','manager'])` + `branch_access` — نفس `/overview` بالظبط. الكاشير مالوش وصول.

### 0.4 الواجهة
- كل حاجة في `apps/web/src/features/analytics/` + `apps/web/src/analytics.css`.
- عربي أولاً (RTL)، إنجليزي كامل. CSS logical properties بس (`margin-inline-start` مش `margin-left`).
- الألوان من tokens `design.css` (`--ink`, `--lime`, `--paper`, `--border`, `--muted`). نضيف semantic tokens: `--ok`, `--warn`, `--warn-bg`, `--danger` — كل واحد contrast ≥ 4.5:1 على خلفيته.
- كل زرار ≥ 44px. كل رسم ليه `role="img"` + `aria-label` + جدول بيانات مخفي للـscreen readers.
- `prefers-reduced-motion`: مفيش أنيميشن.
- الصفحة lazy-loaded (`React.lazy`) — حجمها < 40KB gzip.

### 0.5 الكلام (copy)
- مصري طبيعي، واضح، من غير فصحى ولا كلام شركات. نفس نبرة الـcanvas.
- كل النصوص في ملف واحد `features/analytics/copy.ts` (`{ ar, en }`) عشان المراجعة تبقى في مكان واحد.
- مفيش رقم من غير شرح قصير يظهر في tooltip/«؟» (التعريف من §4 في المواصفات).

### 0.6 شرط «خلصت» العام (لأي خطوة)
1. Typecheck + lint + unit + integration الخاصة بيها خضرا.
2. مفيش تغيير في سلوك الكاشير أو العميل إلا لو الخطوة قالت كده.
3. اتجرب على موبايل 390px وديسكتوب 1440 بالعربي والإنجليزي (للخطوات اللي فيها UI).
4. اتحدّث الـchecklist في آخر الملف ده.

---

## نشر وتشغيل
1. A1→A4 تتنشر واحدة واحدة (كلها من غير تغيير شكل). بعد A4: `npm run analytics:backfill` على production، ونراجع.
2. B بـflag: demo → 2–3 محلات → الكل.
3. مراقبة: لوج زمن `GET /analytics` و`analytics.refresh`؛ تنبيه في Kuma لو p95 > 800ms أو الـrefresh الليلي فشل.
4. Rollback: الـflag يرجّع الصفحة القديمة فوراً؛ الـmigrations additive فمفيش داتا بتضيع.

---

## Checklist
- [x] A1 تعريف الزيارة
- [x] A2 نوع النشاط وأيام الرجوع
- [x] A3 حماية مميزات المشتركين + فتح التحليلات للكل
- [x] A4 customer_stats + worker + backfill
- [x] B1 contracts
- [x] B2 API
- [x] B3 المكونات
- [x] B4 أول تاب + flag
- [x] B5 حالات الفراغ
- [x] B6 اختبارات الواجهة
- [x] C1 جمهور الشرايح
- [x] C2 نافذة الإرسال
- [x] C3 أثر الرسالة
- [x] C4 صفحة العميل
- [x] D1–D4


## اللي اتنفذ فعلاً (فروق عن الخطة)
- **A1:** الزيارة بقت view اسمه `visits_v` من غير عمود جديد، لأن `loyalty_transactions` جدول مقفول ضد التعديل (immutable)، فمش بنعدّل صفوفه القديمة.
- **A4:** مفيش سكريبت backfill منفصل: الـworker بيعمل أول تحديث لكل محل تلقائي في أول دقيقة بعد النشر (`analytics_refresh_due`). التحديث بيقف بعد 5 ثواني في كل لفة عشان مايأخرش إشعارات الكاشير، ولو الإحصائيات قديمة بيعيد بخطة ثابتة.
- **B4:** مفيش feature flag. صفحة التحليلات بقت أول حاجة في «الرئيسية»، والأرقام القديمة تحت «أرقام التشغيل التفصيلية». الرجوع للقديم = revert للـcommit بتاع B.
- **C:** المالك بس اللي بيبعت رسايل (زي قبل كده). المدير بيشوف القوايم من غير إرسال.
- **D:** التصدير CSV فيه أرقام بس (من غير أسامي أو أرقام تليفونات) ومتعمل في المتصفح. الـholdout (مجموعة ماتوصلهاش الرسالة) **متأجل**: معناه إن صاحب المحل يبعت لـ90% بس من اللي اختارهم، ودي محتاجة قرار منك الأول.
- **أزرار نوع الطلب:** متأجلة.
