# Analytics — Phase B: صفحة التحليلات

> المواصفات: `docs/ANALYTICS-PLAN.md` · القواعد العامة: `docs/analytics/README.md`
> ابدأ المرحلة دي بس لما اللي قبلها تخلص وكل اختباراتها خضرا.

## Phase B — صفحة التحليلات

### B1 — العقد (contracts)  ·  `packages/contracts/src/analytics.ts`
Zod schemas: `AnalyticsQuery {days: 7|30|90, branchId?}`, `AnalyticsResponse` (الشكل في §5 من المواصفات)، `SegmentKey`, `SegmentPage`, `CustomerInsights`, `SectionState = {status:'ready'} | {status:'not_enough_data', needed:string}`.
`ANALYTICS_SECTIONS` — map من كل جزء للمستوى المطلوب (`actions:'basic'`, `funnel:'branches'`, …). النهارده كله مفتوح لأن كل الباقات `advanced`.

### B2 — الـAPI  ·  `apps/api/src/modules/analytics.ts`
1. `GET /merchants/:m/analytics` — كل الأجزاء في transaction واحدة، كل جزء query واحدة:
   - `actions`, `segments`, `atRisk` ← `customer_stats`
   - `kpis` + `deltas` ← `visits_v` للفترة والفترة اللي قبلها
   - `trend` ← `visits_v` group by `business_date` (أيام فاضية بتتملا بصفر في الـAPI)
   - `funnel`, `distribution` ← `customer_stats` + `loyalty_accounts`
   - `heat` ← `visits_v.first_at` بتوقيت المحل، آخر 90 يوم، 7×5
   - `branches` ← `visits_v` + `stamp_requests` (median `decided_at-created_at`، pending)
   - `value` ← `{ returningVisits, visitsAfterMessages }`
   - **حد الداتا الأدنى** لكل جزء: funnel ≥ 20 عضو، heat ≥ 50 زيارة، health ≥ 30 يوم و50 عميل — غير كده `not_enough_data`.
2. `ETag` = hash(`max(loyalty_transactions.sequence)`, `max(customer_stats.refreshed_at)`, query) → `304` لو مفيش جديد.
3. `GET /merchants/:m/analytics/segments/:key?cursor=&q=` — 50 صف، ترتيب حسب الأهم للشريحة (at_risk: الأطول غياب نسبةً لإيقاعه؛ near_reward: الأقل أختام فاضلة).
4. `GET /merchants/:m/customers/:profileId/insights` — كارت العميل + timeline (زيارات بريسيتاتها، هدايا، رسايل اتبعتتله) — Phase C بتعرضه.
5. هدف أداء: p95 < 300ms لمحل فيه 20k عميل (اختبار في `load.test.ts`).

**اختبارات** (`tests/integration/analytics.test.ts`): الأرقام تطابق fixture معروف، نطاق الفروع، الكاشير 403، محل تاني 403، 304 بيشتغل، `not_enough_data` لمحل جديد.

### B3 — مكونات الواجهة  ·  `apps/web/src/features/analytics/`
| الملف | المسؤولية |
|---|---|
| `AnalyticsPage.tsx` | fetch + state الفترة/الفرع في الـURL + ترتيب الأجزاء + skeleton |
| `useAnalytics.ts` | fetch بـETag، refresh كل 60 ث وهو مفتوح، وعلى `live-events` بتاع ختم جديد (debounce 5 ث) |
| `TodayActions.tsx` | كروت «النهارده تعمل إيه» (navy) — بتختفي اللي عددها صفر؛ لو كله صفر: «مفيش حاجة مستعجلة النهارده» |
| `KpiRow.tsx` + `StatTile.tsx` | الأرقام + التغيير (أخضر/أحمر + سهم + نص، مش لون بس) |
| `VisitsTrend.tsx` | أعمدة + آخر يوم lime + جدول مخفي |
| `HealthCard.tsx` | الدرجة + أضعف نقطة (Phase D — placeholder مخفي لحد وقتها) |
| `LoyaltyFunnel.tsx` | البارات + إبراز أكبر وقعة + جملة نصيحة |
| `VisitDistribution.tsx` | 1/2/3/4/5+ |
| `SegmentGrid.tsx` | 8 كروت، كل واحد → قايمة الشريحة |
| `SegmentList.tsx` | قايمة عملاء الشريحة (بحث + تحميل المزيد) |
| `PeakHeat.tsx` | 7×5 + أهدى وقت |
| `AtRiskList.tsx` | أول 5 + «ذكّره» |
| `BranchTable.tsx` | يختفي لو فرع واحد |
| `ValueCard.tsx` | «Perks رجّعلك X زيارة» + الحاسبة المحلية (Phase D) |
| `primitives/` | `Section`, `EmptyState`, `Skeleton`, `InfoHint`, `Bar` |
| `copy.ts` | كل النصوص |

**الترتيب على الموبايل** (زي artboard الموبايل): الأرقام 2×2 → الأكشنز → الصحة → الرسم → الشرايح → اتأخروا. **على الديسكتوب** زي artboard الديسكتوب.

**الحركة:** الأعمدة والبارات بتطلع من 0 في 300ms `ease-out` أول مرة بس؛ الأرقام مابتتحركش (عشان ماتلخبطش). `prefers-reduced-motion` → صفر حركة.

### B4 — أول تاب  ·  `MerchantPage.tsx`
- `overview` يعرض `AnalyticsPage` بدل المحتوى القديم.
- `SetupChecklist` و`OwnerToday` يفضلوا فوق لحد ما الإعداد يخلص.
- الأرقام القديمة + جدول الفروع القديم + `StaffActivity` ينتقلوا تحت disclosure «التشغيل والتفاصيل» لـrelease واحد، بعدها يتشالوا (StaffActivity يتنقل لتاب `operations`).
- **Feature flag:** `merchants.analytics_v2 boolean DEFAULT false` (في `043` أو migration صغيرة) — نفتحه للـdemo ومحلات تجريبية الأول.

### B5 — حالات الفراغ
- محل جديد (0 زيارات): كارت واحد «أول ما زباينك ياخدوا أختام، هنوريك هنا مين بيرجع ومين غاب» + زرار «شوف شكلها بداتا تجريبية» (نفس المكونات بداتا ثابتة من `copy.ts`، وعليها شارة «تجريبي»).
- جزء معندوش داتا كفاية: يظهر بعنوانه وتحته `needed` («محتاجين 20 عميل على الأقل — عندك 12»).
- خطأ شبكة: الرسالة من `error-messages.ts` + «حاول تاني».

### B6 — اختبارات الواجهة
- E2E (`tools/test-e2e.ts`): owner يفتح → يشوف الأكشنز → يغير الفترة → يفتح شريحة → يرجع. على 390 و1440، عربي وإنجليزي.
- Screenshots مرجعية للصفحة بداتا الـseed (مقارنة بصرية مع الـcanvas يدوي في الـreview).
- فحص accessibility: كل زرار ليه اسم، الترتيب بالـTab منطقي، contrast.

**خلصت Phase B لما:** مفعّلة لمحلات الـdemo + محلين حقيقيين أسبوع من غير مشاكل، بعدها flag للكل.

---
