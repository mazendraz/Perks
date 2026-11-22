# Analytics — Phase D: المتقدم

> المواصفات: `docs/ANALYTICS-PLAN.md` · القواعد العامة: `docs/analytics/README.md`
> ابدأ المرحلة دي بس لما اللي قبلها تخلص وكل اختباراتها خضرا.

## Phase D — المتقدم (بعد ما B وC يستقروا)
1. **ValueCard + الحاسبة المحلية:** متوسط الفاتورة في `localStorage` بمفتاح `perks.avgTicket.<merchantId>`، wrapped بـtry/catch، مفيش API. نص واضح «الرقم ده على جهازك بس».
2. **Health score:** function `merchant_health(mid)` بالأوزان في §4 + `HealthCard`.
3. **Holdout:** `wallet_message_deliveries.holdout bool` — ~10% من الشريحة مايتبعتلهمش (Scale بس لما نقفل). النتيجة: «رجع 25% من اللي وصلتهم مقابل 9% من اللي ماوصلتهمش».
4. **Cohorts شهرية + تصدير CSV.**
5. ~~أزرار نوع الطلب~~ — متأجلة.

---
