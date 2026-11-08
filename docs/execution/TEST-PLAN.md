# Test plan

> تحديث التنفيذ: وصف P00 والـMock في هذا الملف يوثق الأصول عند مراجعتها. السورس الحالي المتصل وحدود قبوله في [IMPLEMENTATION](IMPLEMENTATION.md) و[STATUS](STATUS.md). جدول المراحل هنا خطة قبول، مش إعلان اكتمال إنتاجي.


القسم الأول **ACTUAL**. باقي السيناريوهات **PLANNED** لحد تنفيذها على API و PostgreSQL حقيقيين. نجاح Mock في متصفح واحد مش دليل atomicity أو tenant isolation إنتاجية.

## اللي اتنفذ فعلًا

| Evidence | النتيجة | الحدود |
|---|---|---|
| [inventory.json](evidence/inventory.json) |6 original hashes وموارد مضمنة؛الـmock والـruntime متطابقين | جرد محتوى،مش إثبات مصدر تاريخي |
| [browser-smoke.json](evidence/browser-smoke.json) |6 صفحات rendered؛HTTP200؛0 page errors/failed requests | isolated Edge profile؛من غير هاردوير فعلي |
| [browser-journeys.json](evidence/browser-journeys.json) |18 view +4 UI journey checks +4 mock checks +8 mobile snapshots =34 PASS | backend محلي في localStorage؛فتح wizard مش تفعيل كامل E2E |
| F01–F09 في نفس التقرير |9 reproduced defects | دليل خلل،مش نجاح لمتطلبات الإنتاج |
| node --check |4 أدوات JavaScript سليمة syntax | application lint/typecheck/build غير متاحين لغياب package.json |

رحلة الـUI المختبرة: simulated scan →member→receipt→review→lost response→lookup→success→same-attempt replay بلازيادة؛customer tab اتحدثت. التسجيل: email→fixed demo OTP→terms→card و reload persistence. فتح customer detail و program editor و wizard اتجرب. redemption/request اتجربوا من NQ methods،من غير real holder Auth أو network API.

صور mobile للأربع portals بالعربي والإنجليزي على 390×844 موجودة في evidence. root scrollWidth المسجل 390؛ده smoke لجمع أبعاد وصور،مش تدقيق keyboard أو screen reader أوكل التفاصيل. harness الأول فيه selector/timing errors محفوظة في browser-journeys-initial.json؛النهائي 0 FAIL و 0 page errors.

## معيار الدليل

كل run يسجل testId و taskId و commit/artifact hash و environment و migration version و runtime versions و UTC time و fixtures والنتيجة المتوقعة والفعلية و outcome ومسار الدليل. API evidence فيها status و operation reference؛SQL assertions فيها counts و ledger totals؛UI evidence فيها screenshots/video عند الحاجة. ممنوع OTP أو cookies أو keys أو full contacts في logs.

الاختبارات deterministic بساعة و random seed قابلين للضبط في test فقط. التزامن يستخدم DB connections مستقلة و barriers،بدل الاعتماد على sleep. fixture ثابتة فيها A/B وفرعين وكاشير لكلنطاق و customer متعدد العضويات و support محدود.

## اختبارات التنفيذ المطلوبة — كلها PLANNED

| ID / Task | السلوك المطلوب | Evidence إلزامية |
|---|---|---|
| T01 / P01-02,P04-04 | B لا يقرأ أويكتب بيانات A عبر path/query/body/token/cache/job/file | separate sessions؛API matrix؛SQL before/after؛RLS runtime role؛لا foreign payload |
| T02 / P02-04,P04-04 | كاشير الفرع 1 مرفوض في الفرع 2،حتى بتغيير IDs | grant snapshot؛403؛ledger unchanged؛manager subset test |
| T03 / P01-04,P04-04 | تعطيل موظف في جلسة مفتوحة يمنع command جديدة بعد قرار التعطيل | grant lock/version barrier؛ترتيب commit؛API denial؛UI reauth |
| T04 / P03-01 |20 enroll متزامنين لنفس الهوية والبرنامج ينتجوا membership واحدة | unique constraint؛counts=1؛existing ID ثابت؛terms محفوظة |
| T05 / P04-01,03 | repeated click بنفس key نفس النتيجة؛payload مختلف 409؛replay بعد disable مرفوض | immutable response hash؛tx count1؛conflict/authorization responses |
| T06 / P04-01,P06-02 | same receipt في A ثم B والعكس وبرنامج تاني حسب exclusive policy | canonical key واحدة؛allocation/award واحدة؛409؛لا visit إضافية |
| T07 / P04-03,04 | lost response بعد commit ثم reload/reauth ترجع نفس operation | fault point بعد commit؛persisted key؛نفس tx/grant IDs؛count unchanged |
| T08 / P04-04 | كاشيران: نفس purchase لها award≤1؛purchases مختلفة تحافظ على مجموع الرصيد والمكافآت |2 DB connections؛barriers؛ledger replay؛grant uniqueness |
| T09 / P05-01 | صرفان متزامنان لنفس reward ينجحوا مرة واحدة | unique redemption row؛one win/one conflict؛holder proof؛outbox واحدة |
| T10 / P06-03 | approve/expiry/cancel/reject يتنافسوا على قرار نهائي واحد | controlled DB time؛lock barrier؛request transition واحدة؛award≤1 |
| T11 / P03-01,P05-02 | version جديدة لا تغير حقوق القديمة؛old membership pinned؛new member latest | immutable published rows؛version FKs؛grant snapshots؛UI proof |
| T12 / P05-02 | reward انتهت قبل complete تترفض حتىلو challenge بدأتقبلها | boundary fixtures؛DB time؛expiry worker replay بلا أثر جديد |
| T13 / P05-03 | correction آمنة تتعكس مرة؛نشاط لاحق أومكافأة مصروفة يروح review | original/compensation links؛ledger sum؛grant void events؛approver/reason audit |
| T14 / P10-04 | Wallet outage/429/cert expiry لا يفشل award المحفوظة | successful commit؛failed/retryable outbox؛web current؛pass revision lag |
| T15 / P11-02 | opt-out بعد schedule وقبل dispatch يمنع الإرسال؛budget race لايتجاوزالحد | consent event time؛worker recheck؛suppressed delivery؛reservation settlement |
| T16 / P12-03 | duplicate/out-of-order payment events لا يكرروا أثرًا؛signature مزورة مرفوضة | durable inbox uniqueness؛one invoice effect؛provider state reconciliation |
| T17 / P13-02 | backup/PITR restore يسترجع بيئة متسقة معحصر RPO gap | restore time؛measured RPO/RTO؛ledger/grants/purchases reconciliation؛providers paused |
| T18 / P07-04 | exportA ممنوع على B؛تعطيل requester يمنع download | job scope hash؛file/download negative tests؛expiry/delete؛access audit |
| T19 / P13-04 | RTL/LTR و mobile و keyboard و screen reader شغالين في الرحلات الأساسية | manual matrix؛focus order/trap/return؛labels/live status؛200%zoom؛صور |
| T20 / P02-03 | activation retry/crash/double-click لا يكرر merchant/invite/asset | activation key ثابتة؛resource IDs؛step attempts؛mail/object count1 |
| T21 / P04-02 | فشل بين ledger/grant/projection/outbox يعمل rollback كامل | fault points؛rollback counts كلها 0؛committed facts متطابقة؛rebuild diff0 |
| T22 / P04-02,P05-03 | property tests تحافظ على integer/nonnegative balance و grant uniqueness | generated sequences؛conservation formula؛unsafe correction gates |
| T23 / P03-04,P04-03 | forged/expired/wrong-purpose QR مرفوضة؛camera denial لها fallback | encode/decode؛token expiry/hash؛rate limits؛فيديو كاميرا و manual flow |
| T24 / P09-01 | worker crash/lease expiry/parallel retry لا يكررواالأثر؛revision قديمةمرفوضة | fencing token traces؛one effective result؛stale event rejection؛dead-letter recovery |
| T25 / P11-02 | paid provider قبل الرسالة ثم الرد ضاع: مفيش blind resend | delivery unknown؛lookup/reconcile أو manual review؛حجزتكلفة واحد |
| T26 / P13-01 | CSRF/OTP brute-force/enumeration/session fixation/MFA gaps مرفوضة | negative suite؛generic responses؛rate-limit؛cookie flags؛MFA gate |
| T27 / P02-01,P13-01 | mime spoof/XSS/SVG/script/oversize/traversal مرفوضين | quarantine/rejection؛private paths؛sanitized image؛لا executable upload |
| T28 / P12-04 | quota race/downgrade/grace لا يتجاوزوا السياسة أويمسحوا حقوقًا | atomic limits؛state transitions؛balance/grants unchanged؛reason audit |
| T29 / P14-02 | NFC write/read/revoke/replace و printed QR fallback يعملوا فعليًا | placement/device/operator/time؛iOS/Android captures؛old link revoked |
| T30 / P10-04 | Apple/Google pass save/update/remove/readd و cert rotation | artifact hash؛provider IDs؛device captures؛registration/update traces |
| T31 / P09-02,P13-01 | support/PII reveal/logs/cache ملتزمين بالنطاق | منع reveal بلا سبب؛redacted logs؛expiry للـgrant؛no tenant dump |
| T32 / P13-03 | load و lock contention و worker backlog لا يخلّوا invariants | profile قابل للتكرار؛percentiles/errors؛explain/lock stats؛ledger conservation |

## KPI definitions واختبارات المطابقة

timestamps UTC،والعرض حسب reporting timezone للتاجر. windows هي`[from,to)`،والـbranch/program filters مصرحين من server. كل metric ترجع definition/window/scope/watermark/updatedAt. `Date.now()` وحده مش دليل freshness. scans و card opens مش زيارات.

| المؤشر | المصدر والتعريف | الفترة والنطاق |
|---|---|---|
| Registered customers | distinct tenant profiles لها membership واحدة على الأقل؛عدد memberships منفصل | all time/asOf؛merchant |
| Active | distinct customers لهم confirmed purchase فيآخر 30 يوم |30days؛الفروع والبرامج المصرحة |
| Inactive | آخر confirmed purchase أقدم من 30 يوم | asOf؛never-active منفصلين |
| Never active | عضوية من غير أي confirmed purchase | all time؛التسجيل لا يثبت زيارة |
| New signups | أول membership للعميل عند التاجر فيال window؛program enrollments منفصلة | selected window؛branch غيرمعروف=unattributed |
| Stamps issued | SUM positive award quantities؛reversals/corrections منفصلين؛net له label مختلفة | selected window؛committed ledger |
| Confirmed visits | COUNT distinct canonical purchase allocations؛qty3=visit1؛redemption وحدها لا زيارة | window/branch |
| Open rewards | available grants لمتنتهِ ولمتُصرف أوتُلغَ | snapshot/asOf؛branch eligibility لوفي filter |
| Redeemed rewards | completed unique redemptions | selected window/branch |
| Branch performance | نفس تعريفات purchase/stamps/rewards مجمعةبـbranch | نفس window مع scope واضح |
| Returning trend | weekly distinct visiting customers لهم purchase قبل بداية الأسبوع ÷ weekly distinct visiting customers |8 أسابيع محلية؛denominator0=no data؛لا causality claim |

Fixtures تشمل customer في برنامجين وpurchase بها3stamps وscan بلا شراء وsignup بلا نشاط وredeem بلاpurchase وday/DST boundaries وreversal وexpired grant وفرعين بصلاحيات مختلفة. المطلوب منع double counting ومطابقة read models مع canonical facts.

تصحيح عدد الأختام مش بيلغي تلقائيًا حقيقة الشراء أوالزيارة. إلغاء تأكيد شراء يحتاج event مستقلة بمبرر وصلاحية،وبعدها التقارير تستبعد purchase الملغية. آخر confirmed purchase هي مصدر الخمول؛صرف reward لوحده لا يغيّر visit count.

## أهداف أداء وتعافي — لسه غير مقاسة

حمل Pilot مرجعي:20merchants×2000customers و 1million ledger rows و 10 أجهزة كاشير متزامنة. load gate مقترحة 20award writes/s+100reads/s لمدة 10 دقائق،مع توثيق مواصفات host والـfixtures. هدف API p95: writes≤700ms و reads≤400ms؛p99≤2s و 5xx<0.5%؛صفر invariant violations. provider calls خارجدائرة DB transaction. Web LCP≤2.5s على جهاز متوسط وشبكة 4G موثقة؛worker lag≤60s عند توفر المزود. الأهداف تتراجع حسب الحمل المعتمد.

RPO≤15minutes و RTO≤4hours هدفان محتاجان مزود استضافة مناسب واختبار restore. ده مش ضمان عدم فقد أي transaction؛لازم reconciliation من receipts/operation audit/provider state للفجوة،والـpending clients يعيدوا نفس key. وجود backup file وحده مش نجاح؛يلزم restore فعلي ومقارنة counts و ledger معحفظ encryption keys بأمان.

## Release gates

كل feature تحتاج domain و DB integration و API authorization و critical UI path واختبارات negative المناسبة. قبل Pilot:core tests المذكورة،restore و security/performance/a11y gates،ومفيش critical/high مفتوح. أي provider enabled يحتاج اختباراته؛القدرات غير المختبرة تبقى disabled ومش متسوقة كجاهزة. قبل production:staging upgrade/rollback rehearsal و owner12step acceptance و on-call handover. اختبار واقف على حساب أو هاردوير يتسجل BLOCKED_EXTERNAL بسبب ومالك،والعمل المستقل يكمل.
