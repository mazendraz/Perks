# Tasks

تاريخ الأساس 2026-11-07. الحالات: `IN_PROGRESS` تنفيذ جزئي أو بوابات باقية؛ `DONE` بدليل؛ `READY` ممكن يبدأ دلوقتي؛ `PLANNED` مستني dependencies؛ `BLOCKED_EXTERNAL` الجزء الخارجي فقط محتاج حساب/قرار؛ `DEFERRED` لا تستخدم إلا بقرار نطاق مكتوب. مفيش implementation task متعلّمة DONE بناء على mock. DONE فيمهامالمسارالمحليتعنيتحققDEV فقط،وقبولManaged Auth/hosting/providers/devices لهبواباتمستقلة فيSTATUS وIMPLEMENTATION.

الأدوار المقترحة: `ENG` تنفيذ، `QA` تحقق، `OPS` تشغيل، `OWNER` قرار/قبول. مش تعيين أشخاص فعلية. تقديرات المراحل في PHASES هي person-days وتشمل اختبار ومراجعة؛ المهام هنا غالبًا 1–3 أيام، والـprovider spikes ممكن 3–5 أيام وتتقسم لو تجاوزت. كل مهمة لها DoD: contract/schema review عند اللزوم + تنفيذ السلوك + authorization/negative cases المناسبة + دليل test مرتبط + docs/status update، من غير أسرار. المهام اللي بتكتب بيانات تحتاج migration و rollback/recovery مناسبين؛ no direct ledger edits.

## P00 — المراجعة

| ID | الحالة / الدور | المهمة والسلوك القابل للفحص | Dependencies | Definition of Done / Evidence |
|---|---|---|---|---|
| P00-01 | DONE / ENG | جرد الأصول وفك الكود وتحديد الـstack والبيانات | — | inventory SHA256،مصادر extracted،PROJECT-AUDIT؛الأصول محفوظة |
| P00-02 | DONE / ENG+QA | تشغيل محلي وفحص صفحات ورحلات و negative mock probes | P00-01 | browser-smoke6/6؛journeys34 PASS و 9 findings؛لا ادعاء production checks |
| P00-03 | DONE / ENG | تسليم 13 ملف خطة مترابطين و backlog/runbook | P00-01,02 | ملفات موجودة وروابطها و IDs متحققة؛STATUS يميز planned/actual |

## P01 — Foundations

| ID | الحالة / الدور | المهمة والسلوك | Dependencies | DoD / دليل القبول |
|---|---|---|---|---|
| P01-01 | DONE / ENG | إنشاء npm workspace للـweb/api/worker/contracts،TS،scripts،lockfile،env template بأسماء فقط،نقل tokens/Card skeleton | P00-03 | fresh checkout: install/build/typecheck/lint؛Demo untouched؛app health render؛لا mock في production bundle |
| P01-02 | DONE / ENG+QA | M001 tenancy/grants/audit + scoped DB layer و RLS runtime role | P01-01 | A/B composite FK failures و API/query negative tests؛pooled connection scope reset |
| P01-03 | IN_PROGRESS / ENG+OWNER | تثبيت Auth adapter contract ومقارنة Supabase candidate بالتكلفة/region/MFA/recovery،local mail sink | P00-03 | ADR محدث ومسار local بلا إنفاق؛no fixed OTP؛external approval محدد فقط عند الاحتياج |
| P01-04 | DONE / ENG | email/password login/register/change/reset/session/logout لكل الأدوار و active grant policy لكل request | P01-02,03 | expired/revoked/disabled deny؛secure cookie+CSRF؛tenant actor مستمد من server |
| P01-05 | IN_PROGRESS / ENG+QA | OpenAPI/errors/request IDs و CI baseline و A/B fixtures + telemetry/secret redaction | P01-01,02 | CI من DB فارغة؛401/403/404 contract؛logs خالية من tokens/PII |

## P02 — Provisioning

| ID | الحالة / الدور | المهمة والسلوك | Dependencies | DoD / دليل القبول |
|---|---|---|---|---|
| P02-01 | DONE / ENG | M002 merchant/brand/assets/branch/staff foundations و initial program config،private uploads | P01-02,04 | admin يجهز هوية وبرنامج وفرعين؛file ownership/type checks؛IDs stable |
| P02-02 | DONE / ENG | نقل wizard7steps إلى typed UI +server draft revisions/validation/preview | P02-01,P01-05 | save/resume/reload حتى مع رد إنشاء/تحديث/تفعيل ضائع،password re-login يحفظ المدخلات،وتعارض النسخ يظهر للمراجعة |
| P02-03 | DONE / ENG+QA | activation keyed by draft revision +step records +invite/asset outbox | P02-02 | double-click/timeout/retry تنتج merchant واحد وكل invite/asset مرة واحدة |
| P02-04 | DONE / ENG | invitations accept/resend/revoke +per-staff branch grants +disable live | P02-01,P01-04 | cashier لفرع واحد مرفوض في التاني؛old invite invalid بعد revoke؛disabled session command denied |
| P02-05 | DONE / ENG | merchant status و manual plans/entitlements أولية +server limits | P02-01 | suspend blocks earning بلا حذف حقوق؛limit checks في transaction؛audit reason |

## P03 — Enrollment/cards

| ID | الحالة / الدور | المهمة والسلوك | Dependencies | DoD / دليل القبول |
|---|---|---|---|---|
| P03-01 | DONE / ENG+QA | M003 immutable program versions +tenant profiles/membership unique/terms | P02-01,05 | existing memberships pinned؛duplicate concurrent enrollment واحدة؛no cross-tenant profile leak |
| P03-02 | DONE / ENG | customer enrollment/recovery typed flow مربوط بـAuth الحقيقي | P03-01,P01-04 | terms mandatory،marketing optional off؛recovery لا يكشف وجود account؛OTP attempt limits/expiry |
| P03-03 | DONE / ENG | card/list/activity APIs +LoyaltyCard TS +persisted server reads | P03-01,02 | نفس membership بعد reload؛دورة جديدة بعد صرف المكافأة تحفظ الفائض والسجل،motion وreduced-motion؛A/B balances مستقلة؛no localStorage truth |
| P03-04 | DONE / ENG+QA | real enrollment QR +opaque presentation token وبداية public placement resolve | P03-03 | encode/decode roundtrip؛expired/forged/wrong-purpose token denied؛opening URL لا award ولا visit |

## P04 — Atomic stamps

| ID | الحالة / الدور | المهمة والسلوك | Dependencies | DoD / دليل القبول |
|---|---|---|---|---|
| P04-01 | IN_PROGRESS / ENG | canonical purchase refs و idempotency operation contract والـretention | P03-04,P01-05 | A/B تشترك في business key؛different payload same key409؛authorize before replay |
| P04-02 | DONE / ENG+QA | M004 award transaction +ledger/grants/projection/audit/outbox | P04-01,P03-01 |4+2→1+grant1؛multiple thresholds؛rollback بلا جزء محفوظ؛immutable ledger |
| P04-03 | DONE / ENG | cashier camera/manual fallback +receipt review +durable pending operation recovery | P04-02,P02-04 | success بعد commit؛lost response/reload يتحقق بنفس key؛offline لا success/queue جديدة |
| P04-04 | DONE / QA+ENG | prove concurrency/isolation/disable barriers وربط max integer qty | P04-02,03 |2connections+50parallel؛same receipt≤1award؛different receipts totals conserved؛all F02/03/04/09 closed server-side |
| P04-05 | DONE / ENG | basic merchant operation read model +platform trace/timeline by reference | P04-02 | award يظهر في merchant scoped list و ops trace مرتبط audit/outbox؛3stamps=1visit |

## P05 — Rewards/redemption/corrections

| ID | الحالة / الدور | المهمة والسلوك | Dependencies | DoD / دليل القبول |
|---|---|---|---|---|
| P05-01 | DONE / ENG+QA | M005 holder challenge +atomic once-only redemption/UI | P04-02,03 |CU منفصل يؤكد؛two cashiers redeem→one؛disabled/foreign branch denied؛stable receipt |
| P05-02 | DONE / ENG+QA | DB-time expiry jobs/checks و program-version/earned-rights guards | P05-01,P03-01 |expiry بعد challenge يمنعصرف؛end earning يبقي grant صالح؛no old rights repricing |
| P05-03 | DONE / ENG | compensating corrections +review workflow للعمليات اللاحقة/المصروفة | P05-02 |repeated approval أثر واحد؛latest safe reversal conserved؛unsafe cases needs_review مع reason؛no truncate |
| P05-04 | IN_PROGRESS / QA+OWNER | أول دورة حقيقية 12 خطوة بتاجرين و credential contexts منفصلة | P01-05,P02-03,04,05,P03-03,04,P04-04,05,P05-01,02 |سجل API+SQL+UI لكل خطوة؛no mocks؛A/B negative complete؛manual owner demo |

## P06–P09 — Requests/reports/materials/operations

| ID | الحالة / الدور | المهمة والسلوك | Dependencies | DoD / دليل القبول |
|---|---|---|---|---|
| P06-01 | DONE / ENG | M006 customer request +valid branch/placement +matching code/expiry | P03-04,P05-02 |URL لايزود balance؛request موجود مرة؛cancel/expiry محفوظين |
| P06-02 | DONE / ENG | cashier branch queue/approve/reject مربوطين بنفس award transaction | P06-01,P04-02 |matching code مطلوب؛A ثم B لنفس receipt→409؛staff branch check |
| P06-03 | DONE / QA+ENG | request approval/cancel/expiry concurrency،reconnect UI | P06-02 |transition واحدة و award≤1؛expiry بعد lock respected؛lost reply same result |
| P07-01 | DONE / ENG+OWNER | KPI definitions/timezones/windows و M007 read models/checkpoints | P04-05,P05-02 |fixture report يطابق ledger؛unique customers منفصلة عن memberships؛watermark ظاهر |
| P07-02 | DONE / ENG | customer directory/details +saved segments/inactivity +pagination | P07-01 |search scoped،never-active منفصلة،counts dedup across programs،no foreign IDs |
| P07-03 | DONE / ENG | overview/branch performance/return trends typed charts | P07-01,02 |filters و definitions متطابقين؛no scan visit؛empty/error/loading states |
| P07-04 | DONE / ENG+QA | private export jobs/download/auth recheck | P07-02,P01-02 |exportA غير قابل للوصول B؛revoked requester denied؛CSV formula injection mitigated |
| P08-01 | DONE / ENG | M008 placements generation/revocation/replacement +real QR assets | P03-04,P02-01 |كل قطعة link مستقل؛revoked القديم لا award؛replacement history محفوظ |
| P08-02 | BLOCKED_EXTERNAL / OPS+QA | NFC write instructions +physical attest +QR fallback | P08-01 |iOS/Android يفتحواالتاجر/الفرع الصح؛device/operator/time evidence؛hardware budget gate |
| P08-03 | DONE / ENG+OPS | material center/fulfillment statuses/retry-safe orders | P08-01 |production→shipped→installed transitions authorized؛retry لا يكرر order |
| P09-01 | DONE / ENG | M009 real jobs/attempts/dead-letter/operation timelines/safe retry | P04-05 |same intent retry،unknown paid outcomes لا resend؛tenant scope every job |
| P09-02 | IN_PROGRESS / ENG | support tickets/audit filtering/PII reveal reason و support role | P09-01,P01-04 |support يرى scopedminimum؛reveal/reply/status traced؛no broad impersonation |
| P09-03 | IN_PROGRESS / OPS+QA | health dashboards/alerts/provider expiry/worker backlog +admin surface | P09-01,02 |inject failure→alert→runbook action؛masked config no secrets |

## P10–P12 — External capabilities

| ID | الحالة / الدور | المهمة والسلوك | Dependencies | DoD / دليل القبول |
|---|---|---|---|---|
| P10-01 | IN_PROGRESS / ENG+OWNER | account/brand eligibility spike و provider adapter contracts | P00-03 |official-source ADR،issuer mapping،cost/options،explicit external blockers؛no purchase |
| P10-02 | BLOCKED_EXTERNAL / ENG | Apple signing/issuance/registration/update endpoints | P10-01,P09-01 |approved issuer path/cert first؛signed test pass+registration/update logs؛no keys browser |
| P10-03 | BLOCKED_EXTERNAL / ENG | Google issuer/class/object/save/update | P10-01,P09-01 |test issuer access first؛stableIDs و retry-safe create؛publishing gate مستقل |
| P10-04 | BLOCKED_EXTERNAL / QA+ENG | pass revision/outbox/retry/renewal +physical provider acceptance | P10-02,03 |wallet failure لايغير loyalty؛out-of-order no stale update؛device save/update evidence لكل provider |
| P11-01 | IN_PROGRESS / ENG+OWNER | consent purposes/schema و channel eligibility/cost discovery | P00-03,P03-01 عند التنفيذ |Meta official docs verified وقت التنفيذ؛approved channels +optout contract؛no paid send |
| P11-02 | PLANNED / ENG+QA | M011 intents/deliveries/budget reservations/reconciliation | P11-01,P09-01 |optout قبل dispatch suppress؛unknown outcome quarantine؛duplicate webhook لا duplicate bill/send |
| P11-03 | PLANNED / ENG | campaign preview/schedule/report +server reachable audience | P11-02,P07-02 |timezone schedule صحيح؛budget cap atomic؛delivery≠accepted؛no fake opens |
| P11-04 | BLOCKED_EXTERNAL / ENG+QA | opted-in Web Push و enabled message adapters | P11-02 |real test delivery evidence لكل enabled channel؛Safari/Android permission/revoke handling؛unready hidden |
| P12-01 | IN_PROGRESS / ENG+OWNER | plan versions/subscription state machine و M012 schema | P02-05 |أسعار/ضرائب/limits/cancellation معتمدة؛manual paid invoice permission audited |
| P12-02 | BLOCKED_EXTERNAL / ENG | payment provider sandbox checkout وربط billing UI | P12-01 |entity/provider approval؛server intent +signed callbacks؛redirect لا يثبت paid؛cost قبلال live |
| P12-03 | BLOCKED_EXTERNAL / ENG+QA | durable webhook inbox/signature/idempotency/out-of-order reconciliation | P12-02 |sameevent100 مرة/ordering reversed→invoice/entitlement واحد؛retry recovers after outage |
| P12-04 | PLANNED / ENG | entitlements usage limits/renewal/dunning/grace/downgrade | P12-03 |no accrued rights deletion؛limit race serialized؛support can explain state/reason |

## P13–P15 — Prove/pilot/launch

| ID | الحالة / الدور | المهمة والسلوك | Dependencies | DoD / دليل القبول |
|---|---|---|---|---|
| P13-01 | IN_PROGRESS / QA+ENG | threat model/tenant+branch suite/abuse/session+upload/webhook security | P05-04،كل enabled feature |no critical/high unresolved؛SAST/dependency/secrets checks evidence؛no production demo switches |
| P13-02 | IN_PROGRESS / OPS+QA | backups/PITR/isolated restore+ledger/outbox/provider reconciliation | P04-02,P09-01 |restore measuredRPO/RTO؛exactpurchase/rewardinvariants؛external calls paused until reconciliation |
| P13-03 | IN_PROGRESS / ENG+QA | realistic load/lock/query/index/worker backlog tests | P07-03,P09-01 |SLOtargets under declared load؛no balance drift；explain plans retained |
| P13-04 | IN_PROGRESS / QA+ENG | RTL/LTR/mobile/keyboard/screen-reader/reduced-motion audit | P05-04،كل enabled UI |critical journeys touch/keyboard focus+labels/status announcements؛device evidence |
| P14-01 | BLOCKED_EXTERNAL / OPS | staging/prod separation و CI deploy/migrate/smoke/rollback rehearsal | P13-01,02 |staging freshseed،no live secrets/test sends،release artifact reproducible |
| P14-02 | BLOCKED_EXTERNAL / QA+OPS | physical scan/NFC/optionalWallet/device network interruptions | P14-01,P08-02 لو NFCenabled |iOS Safari/Android Chrome matrix،camera denial،lowlight،URLreplace،actualdevice videos/logs |
| P14-03 | BLOCKED_EXTERNAL / OWNER+QA | merchant pilot training+support+feedback+daily reconciliation | P14-02,P05-03,P07-04,P09-03 |2–3 merchants،7–14days proposed؛no unexplained balance drift؛owner signoff؛issues triaged |
| P15-01 | PLANNED / OPS+OWNER | production go/no-go +progressive rollout +verified billing scope | P14-03 وكل enabled phase gates |DNS/TLS/backup/alerts/support/rollbackchecked؛paid provider cost approval؛smallcohort launch |
| P15-02 | PLANNED / OPS+ENG | operating handover/oncall/incident/cert/retention/billing runbooks | P15-01 |support runs provisioning/reflookup/retry/restore tabletop without dev؛owners/access known |
| P15-03 | PLANNED / QA+OWNER | postlaunch stabilization/reconciliation/SLO/cost review | P15-01,02 |agreed window7days proposed؛noP0/P1open؛metrics+next backlog published |

## First operational loop

الأهداف هنا أول دورة **محفوظة على server و DB مع Auth حقيقي** في dev/staging؛مش نجاح mock أوإطلاقعام. secure auth ممكنيُختبر localmail sink،لكن pilot الخارجي يلزم email provider مؤهل.

**Task set المطلوب كاملًا:** P01-01 إلى P01-05،P02-01 إلى P02-05،P03-01 إلى P03-04،P04-01 إلى P04-05،P05-01 و P05-02 و P05-04. P04-05 متعمد يشمل minimal merchant reporting و ops tracing قبل P07/P09 الكاملين. P05-04 دليل جمع الأجزاء،لاينفذبديله Mock.

| خطوة قبول المالك | المهام المسؤولة | الدليل |
|---|---|---|
|1. Admin ينشئ MerchantA | P01-04,P02-02,03 |session+activationId+merchant row |
|2. يختار هوية وبرنامج | P02-01,02,P03-01 |approved brand asset+published version |
|3. فرعين وكاشير مقيد بواحد | P02-04,05 |grantrow+unauthorized branch403 |
|4. Customer يسجل من QR | P03-02,04 |realdecode+verified identity+terms |
|5. كارت من بيانات محفوظة | P03-01,03 |reload/device2same membership |
|6. Cashier يمسح ويضيف بإيصال | P04-01,02,03 |purchase+operation+ledger |
|7. Balance يتحدث | P04-02,03 |serverrevision/customerread |
|8. Retry نفس attempt نفس النتيجة | P04-01,03,04 |storedsnapshot و countunchanged |
|9. Threshold يصدر grant | P04-02 |ledger consumption+grantunique |
|10. Redeem مرة واحدة | P05-01,02 |holderproof+unique redemption |
|11. Merchant+ops يشوفوا العملية | P04-05 |scopedlist+traceaudit/outbox |
|12. MerchantB مايشوفش A | P01-02,04,05,P04-04,P05-04 |API+SQL+file/job isolation evidence |

التأجيل المسموح بعد أول دورة: MethodB/requests(P06)،dashboards وال segments وال exports الكاملة(P07)،physicalNFC/fulfillment(P08)،supportsuite الكاملة(P09)،Wallet(P10)،paid campaigns(P11)،automated billing(P12). الـAuth والعزل والـatomicity والـaudit والـoutbox والـreceipt dedupe والـexpiry والـholder verification لاتتأجل. correction automation ممكن بعد الدورة الداخلية،لكن قبل pilot لازم P05-03 ومسار review آمن.

الدفعة المحلية اتنفذت. أول دورة آلية متصلة موجودة فيevidence/implementation؛P05-04 يفضلIN_PROGRESS لحدقبولالمالك العملي،ومشإثباتPilot أوهاردوير. المهمةالقادمةهيإغلاقبواباتIN_PROGRESS المذكورةفيSTATUS. P10-01/P11-01 discovery ممكن يمشوا كبحث مستقل في حسابات المستقبل،من غير تعطيل المسار الأساسي أوإنفاق.


## دليل التنفيذ الحالي

[IMPLEMENTATION](IMPLEMENTATION.md) يربطالسلوك بالمصدر وحدودالتحقق. [checks.json](evidence/implementation/checks.json) يسجلأوامرالتحقق وأكوادخروجها،و[browser.json](evidence/implementation/browser.json) يسجلالرحلة. عدمتفعيلحسابخارجي مؤكدمنالمالك؛المهامالمدفوعةوالنشرماتتنفذشتلقائيًا.

## Local follow-up — 2026-11-08

تم تنفيذ طلبات اللوجو أثناء التجهيز،الباسورد من المسؤول للحسابات الجديدة مع تحويل الدعوة المعلقة دون تغيير حساب موجود،HEX/palette،9 قوالب،QR مرئي وقابل للتنزيل وتوليد الفرع،ملف متابعة ودعم لكل محل،ولغة أولى حسب المتصفح مع اختيار يدوي محفوظ. تفاصيل التنفيذ والحدود في [ONBOARDING-AND-SUPPORT](ONBOARDING-AND-SUPPORT.md). بوابات الخدمات الخارجية والإطلاق الواردة أعلاه تظل كما هي.

متابعة تخصيص الأختام:تم تنفيذ العدد المرتبط بالمكافأة (2–50)،5 أشكال،8 رموز،ممتلئ/محدد،ومعاينة موبايل. أضيف قالبان لكل من الكافيه والمطعم والحلاق ليصبح الإجمالي15. تغيير عدد برنامج منشور ينشئ نسخة جديدة دون تعديل العضويات الحالية. التفاصيل في [STAMP-DESIGN](STAMP-DESIGN.md).

متابعة Preview والحسابات:تمت إضافة معاينة المحل وقائمة النواقص وفتح تصميم الكارت من المنصة،وإدارة بيانات دخول الحسابات الحالية وعضويات الفريق،ودليل عملاء للتواصل بمسودات واتساب لصاحب المحل والعملاء أصحاب الموافقة والرقم. سحب الموافقة وتغيير الرقم ونطاق المحل محكومون بالخادم. انظر [ACCOUNT-PREVIEW-AND-CONTACT](ACCOUNT-PREVIEW-AND-CONTACT.md).
