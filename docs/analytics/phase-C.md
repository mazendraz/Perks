# Analytics — Phase C: من الرقم للأكشن

> المواصفات: `docs/ANALYTICS-PLAN.md` · القواعد العامة: `docs/analytics/README.md`
> ابدأ المرحلة دي بس لما اللي قبلها تخلص وكل اختباراتها خضرا.

## Phase C — من الرقم للأكشن

### C1 — جمهور الرسايل بالشرايح  ·  `044_message_segments.sql`
- `wallet_messages.audience` CHECK يضيف: `new, one_time, at_risk, lost, vip, reactivated`.
- Function حل الجمهور تقرا من `customer_stats` (والقديم `inactive_days` يفضل شغال).
- `owner-plan.ts` `POST /wallet-messages` يقبل الشرايح الجديدة (zod في contracts).

### C2 — نافذة الإرسال  ·  `features/analytics/SendSheet.tsx`
- Bottom sheet على الموبايل / dialog على الديسكتوب (`dialog-accessibility.ts` للـfocus trap و Esc).
- جواها: اسم الشريحة + العدد + «شوف الأسامي» · الرسالة الجاهزة (قابلة للتعديل، عدّاد 150 حرف) · معاينة إشعار Wallet · «فاضلك X رسالة الشهر ده».
- «ابعت» → يبعت على طول (من غير تأكيد تاني) → toast «اتبعتت لـ47 زبون» → الكارت يتحدّث.
- الكوتة خلصت: الزرار متعطل + سطر «الرسايل خلصت الشهر ده» + رابط الباقة (`LimitSheet` الموجود).
- رسايل جاهزة لكل شريحة في `packages/contracts/src/analytics-messages.ts` (ar/en)، مصري طبيعي، ≤ 150 حرف.

### C3 — أثر الرسالة
- View `wallet_message_results`: لكل رسالة → اتبعتت لكام (accepted) + رجع منهم كام خلال 7 و14 يوم (`visits_v`).
- يظهر في سجل الرسايل («رجع 12 من 47») وتحت كارت الأكشن («آخر مرة بعتّ للشريحة دي رجع 25%»).

### C4 — صفحة العميل  ·  `CustomerInsights.tsx`
- من `SegmentList` و`AtRiskList` و`Customers.tsx`.
- هيدر: الاسم، الشريحة، الزيارات، الأختام/الكارت، إيقاعه («بييجي كل 5 أيام»)، آخر زيارة.
- Timeline: زيارة (التاريخ، الفرع، الأختام، رقم الريسيت لو موجود) · هدية استحقها/صرفها · رسالة اتبعتتله.
- رقم الموبايل متخبّي جزئياً زي `Customers.tsx`.

---
