# Nuqta — فهرس خطة التنفيذ

L09: [الخصوصية والاشتراك](PRIVACY-AND-PILOT.md)، [تشغيل المحل](PILOT-RUNBOOK.md)، [الاحتفاظ والاستعادة](../../deploy/RETENTION.md). حالة القبول والأدلة الحالية في STATUS؛ لا تُعتبر المسودات القانونية أو أسعار الديمو معتمدة.

**تاريخ الأساس: 2026-11-07، Africa/Cairo. الحالة الحالية: تنفيذ محلي متصل؛راجع STATUS وIMPLEMENTATION.**

مراجعة P00 التاريخية مبنية على الست ملفات الموجودة فعلًا، والكود اللي اتفك منها، وتشغيل Edge في profile مؤقت. أي سلوك في `window.NQ` هو **Mock** حتى لو الواجهة بتظهر نجاح. ملفات المعمارية والـDatabase والـAPI تضم التصميم المستهدف. التنفيذ الفعلي وحدوده موجودين في[IMPLEMENTATION.md](IMPLEMENTATION.md)،والأصول الأصلية تظلMock مستقلًا.

| اقرأ | الغرض |
|---|---|
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | السورس المتصل والوظائف المتحققة وحدودها |
| [STATUS.md](STATUS.md) | آخر حالة، نتائج التحقق، العوائق، والمهمة التالية |
| [PROJECT-AUDIT.md](PROJECT-AUDIT.md) | الحالة الحالية وأدلتها ومخاطرها |
| [SCREEN-TO-FEATURE-MAP.md](SCREEN-TO-FEATURE-MAP.md) | كل شاشة، ملفها وبياناتها وإجراءها وصلاحيتها والـAPI والمرحلة |
| [DECISIONS.md](DECISIONS.md) | قرارات محسومة وافتراضات وقرارات محتاجة المالك |
| [ARCHITECTURE.md](ARCHITECTURE.md) | حدود النظام ومسارات البيانات وMermaid |
| [DATABASE-PLAN.md](DATABASE-PLAN.md) | الجداول والقيود والتزامن والـLedger والـmigrations |
| [API-PLAN.md](API-PLAN.md) | العقود المطلوبة والأخطاء والصلاحيات والتكرار |
| [PHASES.md](PHASES.md) | P00–P15 والتبعيات وشروط قبول كل مرحلة |
| [TASKS.md](TASKS.md) | Backlog بـIDs ثابتة ومعايير تحقق |
| [TEST-PLAN.md](TEST-PLAN.md) | اللي اتجرب فعلًا والاختبارات المطلوبة للإنتاج |
| [INTEGRATIONS.md](INTEGRATIONS.md) | جاهزية المزودين، حساباتهم، أسرارهم بأسماء فقط ومراجع رسمية |
| [RUNBOOK.md](RUNBOOK.md) | التشغيل الحالي وخطوات التحقق والتشخيص، ثم أوامر المستقبل المشروطة |

## أول مسار تنفيذي

`P01 → P02 → P03 → P04 → P05` ومعاهم من البداية read models بسيطة للتاجر وoperation tracing من P07/P09. المسار المفصل بـTask IDs في [TASKS.md](TASKS.md#first-operational-loop). لا يحتاج Wallet أوحملات أوتحصيل آلي. مفيش تصريح باستخدام بيانات عملا حقيقية قبل اجتياز العزل والـAuth والتزامن.

## طريقة الاستكمال في جلسة جديدة

1. اقرأ STATUS ثم DECISIONS ثم المهمة التالية في TASKS، وافحص ملفات المجلد وGit قبل أي كتابة.
2. الأدلة المستخرجة في [evidence/inventory.json](evidence/inventory.json) فيها hashes الأصل والموارد. شغّل extractor لو الأصل اتغيّر؛ متعدّلش evidence باعتبارها production source.
3. أي تنفيذ جديد يحدّث TASKS وحالة المرحلة ونتائج الاختبار بـcommit أوhash وبيئة وتاريخ. `DONE` يتطلب دليل؛ `PLANNED` مش نجاح.
4. حافظ على الـIDs؛ ضيف مهام لاحقة من غير إعادة ترقيم. أي تغيير سياسة مكافأة/اشتراك يتسجل في DECISIONS قبل تغيير السلوك.

## حدود التسليم

بعد تسليم المراجعة بدأ تنفيذWeb/API/DB/Worker فعلي. لم يتم تفعيل حساب خارجي أوشراء أوإرسال خارجي أونشر؛الحالة الحالية فيSTATUS. لا يوجد AGENTS.md أوتنظيم تخطيط سابق في المجلد وقت الفحص. مفيش تعديلات أصلية للمستخدم اتكتبت فوقها.
