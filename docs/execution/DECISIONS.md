# Decisions

كل القرارات بتاريخ 2026-11-07. `ACCEPTED` هنا قرار تنفيذ عملي من المسؤول التقني بناء على الطلب؛ `PROVISIONAL` افتراض قابل للتعديل قبل تنفيذ الجزء؛ `OWNER_REQUIRED` يتطلب قرار تجاري أوحساب من المالك، ومش بيوقف العمل المستقل.

| ID | الحالة / صاحب القرار | القرار والسبب | الأثر / موعد المراجعة |
|---|---|---|---|
| D01 | ACCEPTED / Tech lead | نحافظ على `standalone/` كمرجع UI وسلوك ونضيف تطبيق قابل للبناء تدريجيًا. الموجود exports مع runtime مولّد وسورسه غائب؛ تعديله مباشرة مش أساس صيانة مناسب. | استخراج tokens وcopy وCard UI وحالات الخطأ، وتحويلها لمكونات React TypeScript في P01–P05؛ مفيش إعادة تصميم شاملة. |
| D02 | ACCEPTED / Tech lead | React + TypeScript + Vite للويب، Node.js + Fastify للـAPI، PostgreSQL، Modular Monolith + Worker. | React موجود فعلًا 18.3.1. نسخة production المدعومة لكل dependency تتثبت بـlockfile في P01 بعد compatibility check؛ مش ترقية تلقائية للـDemo. |
| D03 | ACCEPTED / Tech lead | npm workspaces و`package-lock.json` واحد في P01. | مفيش package manager أصلي أوlockfile؛ npm موجود 11.17.0. مفيش install مطلوب لتشغيل exports. |
| D04 | PROVISIONAL / Tech lead، المالك يراجع التكلفة | Auth managed خلف adapter؛ Supabase Auth هو المرشح الأول، مع local/test adapter منفصل ومستحيل يشتغل في production. | مفاتيح مزود الـAuth ما تتحولش لصلاحيات تاجر. عضوية الموظف ونطاق الفرع بيتراجعوا من DB في كل أمر. مقارنة التكلفة والإقامة والـMFA في P01-03. |
| D05 | ACCEPTED / Tech lead | خادم واحد مركزي، tenant = merchant؛ كل صف tenant-owned له `merchant_id` وعلاقات مركبة. RLS دفاع إضافي مع app role محدود، مش بديل للـauthorization. | أي query أوcache أوfile أوjob يمر بـscope موثّق؛ support access مقيّد ومُسجّل. |
| D06 | PROVISIONAL / Product owner | الإطلاق الأول يمنع جمع أختام من أكتر من برنامج لنفس الشراء عند نفس التاجر؛ `exclusive_purchase`. | Memberships مستقلة، لكن uniqueness تخص purchase allocation عند التاجر. أي stacking مستقبلًا سياسة versioned ومراجعة مفاتيح القيود قبل الإتاحة. |
| D07 | ACCEPTED / Tech lead | نفس purchase reference في A وB. idempotency key لمنع تكرار الطلب، business key لمنع شراء مكرر حتى بمفتاح جديد. | receipt canonicalization في الخادم: merchant + POS namespace + branch/business-date scope حسب إعداد المصدر + reference. نفس الشراء لازم ييجي بنفس scope في الطريقتين. |
| D08 | PROVISIONAL / Product owner | مصدر الإيصال في أول Pilot يدوي ومعه namespace ثابت، فرع وتاريخ عمل. | رقم إيصال جديد متعمد يقدر يمثل احتيال؛ dedupe مش إثبات شراء. تقارير شذوذ وحدود موظفين ومراجعة؛ POS integration لاحق لو مطلوب إثبات آلي. |
| D09 | ACCEPTED / Tech lead | Ledger append-only؛ الرصيد projection قابلة لإعادة البناء. reward grant مستقلة وشروطها snapshot. كل mutation وaudit وoutbox في transaction واحدة. | مفيش direct balance update أوإرسال خارجي قبل commit. |
| D10 | PROVISIONAL / Product owner | نشر program version جديدة يسري على العضويات الجديدة؛ العضوية الموجودة تفضل على version اللي انضمت لها لحد انتقال صريح محفوظ الحقوق. | لا نعيد احتساب الأرصدة القديمة بعتبة جديدة. انتقال جماعي خارج أول دورة، محتاج سياسة وتعويض واختبارات. إيقاف الكسب لا ينهي مكافأة سبق اكتسابها. |
| D11 | ACCEPTED / Tech lead | العكس الآلي الكامل متاح فقط لآخر award بلا نشاط لاحق وبمكافآت لم تُستبدل؛ غير كده `needs_review`. | لا `Math.max(0, balance+delta)`؛ تعويض مرتبط بالعملية الأصلية، void grant غير المصروف وتعويض consumption. المكافأة المصروفة تحتاج قرار بشري موثّق. |
| D12 | ACCEPTED / Tech lead | presentation QR opaque قصير العمر، مش اعتماد لصرف المكافأة. redemption يحتاج holder challenge مؤقت ومربوط بالعملية. | Wallet barcode لو static يبقى handle محدود يحتاج تحقق server والـholder؛ مفيش وعد بتدوير barcode كل 90 ثانية في كل Wallet. |
| D13 | ACCEPTED / Tech lead | NFC الأول URL tag بس، منفصل تمامًا عن Apple NFC pass وGoogle Smart Tap. | كتابة وتحقق مادي وQR بديل وrevocation لكل placement. مفيش شراء هاردوير حاليًا. |
| D14 | ACCEPTED / Tech lead | Wallet والرسائل optional بقدرات مستقلة لكل merchant/provider. | الويب كامل حتى لو Wallet معطل. badge ظاهر فقط بعد إثبات readiness؛ retry مش بيحوّل الحالة لـready من غير نتيجة مزود. |
| D15 | ACCEPTED / Tech lead | كل paid delivery لها dedupe وbudget reservation؛ timeout ambiguous يروح reconciliation قبل resend. | لا ضمان exactly-once عبر مزود غير داعم. loyalty DB transaction تضمن أثرها الداخلي؛ التسليم الخارجي at-least-once مع معالجة الغموض. |
| D16 | PROVISIONAL / Product owner | أول Pilot باشتراك يدوي موثق وentitlements يضبطها admin، بدون بوابة تحصيل. | مفيش تحصيل أوVAT أوproration مثبتين. commercial self-service يحتاج P12 كامل. |
| D17 | OWNER_REQUIRED / المالك + مزود/مستشار مؤهل | مسار إصدار Apple متعدد العلامات، تفويض Google، وملكية WABA/أرقام الرسائل. | P10/P11 production gated؛ [INTEGRATIONS](INTEGRATIONS.md). لا نفترض حساب لكل تاجر ولا صلاحية تلقائية لحساب المنصة. |
| D18 | OWNER_REQUIRED / المالك | أسماء 2–3 تجار Pilot، شروط مكافآتهم، مجال الإيصالات، أسعار حقيقية وميزانية التشغيل ومكان الاستضافة والسياسة القانونية/الاحتفاظ. | التخطيط والـlocal foundation مستمرين؛ مفيش أي إنفاق قبل عرض التكلفة والموافقة. أسعار الـDemo 450/950/1900 مش أسعار معتمدة. |
| D19 | PROVISIONAL / Tech lead + Ops | SLO pilot: 99.5% شهريًا، recovery RPO ≤15 دقيقة/RTO ≤4 ساعات، أهداف أداء في TEST-PLAN. | دي أهداف تصميم محتاجة قياس restore وload وملاءمة مزود الاستضافة؛ مش نتائج تحققت. |
| D20 | ACCEPTED / Tech lead | ترتيب بناء P00–P15 لا يعني تأخير الأمان والـobservability للآخر. | isolation/auth/audit/outbox/concurrency مع أول ميزة؛ P13 يعمّق ويثبت. تشغيل reports/tracing بسيط من P04/P05 قبل dashboards الكاملة. |

## مقارنة الاختيارات الكبيرة

| الاختيار | يحل إيه | تكلفة/بديل |
|---|---|---|
| React/Vite بدل الاستمرار في DC export | source modules وtypes واختبارات وبناء وrouting | تحويل templates وDCLogic يدويًا واختبار parity؛ الاحتفاظ بـDC يحتاج سورس compiler/runtime وعقد صيانة مش موجودين. React runtime نفسه مستخدم بالفعل. |
| Fastify modular API | auth/validation/SQL transactions وحدود modules واضحة | API service جديد؛ Next.js غير مطلوب حاليًا ومش هيسترجع السورس الغائب. ممكن مراجعته لو ظهر احتياج SSR حقيقي. |
| PostgreSQL | constraints وrow locks وledger وoutbox وRLS | مفيش DB نهاجر منها؛ localStorage مش production migration source. Mongo/Redis كـsource of truth مش بيقدّموا ميزة لازمة هنا. |
| DB outbox worker بدل broker منفصل | retries وdurability بأقل تشغيل | queue PostgreSQL بـleases و`SKIP LOCKED`؛ Redis/broker يتضاف بالقياس لو throughput تطلبه. |

المراجع التقنية اللي اتراجعت: [Vite](https://vite.dev/guide/)، [Fastify](https://fastify.dev/docs/latest/)، [Supabase server-side Auth](https://supabase.com/docs/guides/auth/server-side)، [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html). الاختيارات استنتاج هندسي من احتياجات Nuqta، مش توصية صادرة من المصادر.


## قرارات التنفيذ المحلي — 2026-11-07

- D21 — ACCEPTED: PostgreSQL 17 native مستقلة على 55432 للتطوير بدل تعطيل التنفيذ بسبب Docker daemon. runtime/auth/worker أدوار منفصلة، والأسرار عشوائية وممنوعة من التقارير. لا تعديل لـclusters أخرى.
- D22 — ACCEPTED: التقارير الحالية تقرأ الوقائع مباشرة، من غير projection cache أوcheckpoints مصطنعة. وقت تحديث وwatermark واضحان. تقييم aggregates/indexes لاحقًا بالقياس، من غير تعديل الـLedger.
- D23 — ACCEPTED: نطاق دليل العملاء والتصدير تابع للفروع الحالية. مالك ذو نطاق جزئي لا يرى contacts فروع غير مسموحة؛ المالك المصرح له بكل الفروع يرى التسجيلات غير المنسوبة. contact_email غير مقروءة مباشرة من runtime.
- D24 — ACCEPTED: ملف CSV خاص بكل lease، وربطه بالـexport محمي بفencing. رابط التنزيل ساعة ويعيد authorization. سياسة تنظيف الملفات الفعلية وحفظ البيانات الإنتاجية مازالت مطلوبة.
- D25 — ACCEPTED: نسخة البرنامج وفروعها منشورة immutable؛ تغييرها يتطلب version جديدة. seed لا يضيف فرعًا جديدًا لنسخة قديمة عند إعادة تشغيله. انتهاء الكسب لا يلغي مكافأة مكتسبة.
- D26 — OWNER CONFIRMED: لا توجد حسابات خارجية حاليًا. لا شراء أوإنشاء حساب أوإرسال مدفوع أوتحصيل أونشر تلقائي. local Auth والبريد والتخزين أدوات تطوير، والـSupabase exchange مرشح لم يُؤهل كتدفق إنتاجي كامل.
- D27 — ACCEPTED: حد الطلبات العام للحساب المتحقق منه، وIP للمجهول. لا تُجمع حسابات كاشير وعميل خلف NAT واحدة في حصة حساب واحد. حدود OTP/TOTP مستقلة. إعداد reverse proxy والإساءة في الإنتاج جزء منP13/P14.

- D28 — ACCEPTED: نتائج العمليات المحفوظة لا تحتفظ بدور أوفرع مسحوب. GET للنتيجة يراجع صلاحية الأمر الأصلية. تصدير خاص مربوط ببصمة نطاق عند الطلب،وتُراجع قبل التجهيز والتنزيل. ملفات قديمة بلا بصمة تُلغى روابطها عند migration009g؛لا تغيير لأي شراء أوLedger. الفروع الموقوفة تظل ضمن تاريخ البيانات،ولاتمنح مالكًا جزئيًا صلاحية كاملة لمجرد إيقاف فرع غير مسموح له.
- D29 — ACCEPTED: حد البرامج يخص البرامج النشطة. إنشاء برنامج واستئناف برنامج موقوف يتسلسلان مع تعديل حدود الخطة. نشر شروط جديدة يحافظ على حالة الكسب؛الاستئناف إجراء منفصل وبسبب.

- D30 — ACCEPTED: موافقة التسجيل مرتبطة بـprogramVersionId وبصمة النص المجمع لشروط التاجر والمكافأة. الخادم يقارنها تحت lock قبل إنشاء العضوية؛تغيير الشروط يرجعTERMS_CHANGED ويحتاج موافقة جديدة. مسارDB القديم من غيربصمة مسحوبة صلاحيةتشغيله منruntime. النص الفعلي وبصمته محفوظان فيterms_acceptances.


## 2026-11-08 — الدخول بالإيميل والباسورد وتصميم المنتج

قرار صريح من المستخدم: كل الأدوار تدخل بإيميل وباسورد دون OTP أوAuthenticator. ده يستبدل تدفق MFA الإجباري السابق في التجربة المحلية؛مسار OTP/TOTP القديم يبقى لاختبارات التراجع فقط في test،وحسابات الباسورد لا يمكن تجاوزها منه. Password sessions لا تُطلب منها MFA،مع بقاء شروط الدور والفرع وحالة الحساب والجلسة وCSRF وOrigin على الخادم. بيانات اعتماد bootstrap عشوائية وخاصة،ويختار المالك والكاشير والعميل كلمات مرورهم عند إنشاء الحساب. الاستضافة وmanaged adapter والإيميل الإنتاجي لها قبول مستقل.

واجهة جديدة مبنية على خط عربي محلي،وتنقل بحسب مساحة العمل،وكروت عضوية تحمل هوية النشاط وتقدم العميل ومكافأته. لا نقل إلى مزود استضافة،ولا تعديل في exports الأصلية. زر إظهار الباسورد يأخذ عمودًا مستقلًا لضمان RTL/LTR بدل absolute positioning فوق input. اختبار المتصفح يقيس عدم التداخل ويحافظ على قيمة الباسورد.
