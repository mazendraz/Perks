# Database plan

> تحديث التنفيذ: وصف P00 والـMock في هذا الملف يوثق الأصول عند مراجعتها. السورس الحالي المتصل وحدود قبوله في [IMPLEMENTATION](IMPLEMENTATION.md) و[STATUS](STATUS.md). جدول المراحل هنا خطة قبول، مش إعلان اكتمال إنتاجي.


**تصميم مطلوب، مفيش DB أوmigration اتنفذت لسه.** PostgreSQL source of truth؛ بيانات الـDemo seed صناعية، ومينفعش نستورد `nuqta-demo-v2` كأرصدة تجارية من غير إثبات مستقل ومراجعة.

## قواعد عامة

IDs من الخادم UUID، و`public_reference` غير متسلسل للعمليات المعروضة. الوقت `timestamptz` UTC؛ `business_date` بيتحدد من timezone التاجر وسياسة مصدر الإيصال المحفوظة، مش ساعة موبايل الكاشير. أرصدة وكميات integer، مبالغ `bigint minor_units` مع `currency`؛ لا float للفلوس. كل tenant table له `merchant_id NOT NULL` و`UNIQUE(merchant_id,id)` وFK مركب `(merchant_id,parent_id)`؛ كده branch أوprogram أوmembership من تاجر مختلف مينفعش يتحط في نفس العملية. الـledger والأدلة المالية لا hard delete لها؛ مسح/إخفاء PII مسار مستقل وretention policy معتمدة.

## الجداول والعلاقات

| المجموعة / الجداول | أهم الأعمدة والعلاقات | قيود وفهارس مطلوبة |
|---|---|---|
| `users`, `auth_identities`, `sessions` | global subject، provider subject، status، revocation/version؛ no tenant PII reads مباشرة | unique(provider,subject)، token hashes فقط، session expiry index |
| `platform_grants`, `support_access_events` | user→role/scope/time/reason؛ لا merchant impersonation تلقائية | expiry/status indexes، audit لكل reveal/action |
| `merchants`, `merchant_status_events` | slug، status، timezone، suspension reason، owner contact reference | unique normalized slug، allowed lifecycle transitions، created/status indexes |
| `brands`, `brand_versions`, `assets` | merchant identity، immutable revision، private file metadata/hash، scan state | unique(merchant,version)، approved asset FK، content size/type/ownership checks |
| `branches`, `staff_memberships`, `staff_branch_grants`, `invitations` | branch merchant FK؛ user ممكن يخدم أكتر من merchant بصلاحيات مستقلة؛ invitation token hash/expiry/accepted/revoked | unique(merchant,user)، unique(staff,branch)، partial unique pending normalized invite email/role policy، no plaintext PIN |
| `provisioning_drafts`, `provisioning_activations`, `provisioning_steps` | draft revision، validated payload، activation key، resulting merchant، resource IDs/step status | unique(draft,revision)، unique(activation,step_key)، draft optimistic version؛ exactly one merchant per activation |
| `programs`, `program_versions`, `program_branches` | logical program + immutable published rules، threshold، per-tx limit، earn window، reward validity، stacking policy | unique(program,version)، threshold>0، max_qty integer>0، earning_end>start؛ tenant-safe branch FK |
| `customer_accounts`, `customer_identifiers`, `tenant_customer_profiles` | global holder user/verified normalized email أوphone؛ tenant alias/profile منفصل | global verified identifier uniqueness عبر identity adapter؛ unique(merchant,customer_account)، tenant API مايرجعش global روابط التجار |
| `memberships`, `terms_acceptances` | tenant customer profile→program، pinned program version، status، joined_at، accepted version/hash/time | unique(merchant,profile,program)، composite version/program FKs، joined/time indexes |
| `loyalty_accounts` | one per membership/version bucket؛ current_remaining، revision، last_confirmed_purchase_at | balance>=0، unique(membership,program_version)، projection لا يعدلها غير loyalty command role |
| `purchase_references`, `purchase_allocations` | canonical reference + merchant + namespace + branch/business_date scope، raw display ref، policy_version؛ allocation→membership/operation | unique canonical business key؛ افتراضي unique(merchant,purchase_id) للـexclusive policy؛ لا source A/B في المفتاح |
| `operations`, `idempotency_records` | actor، command، tenant، request hash، status، response snapshot، business ID، timestamps | unique(merchant,actor,command,key)، key length bounds؛ immutable completed response، lookup scoped؛ retention tombstone |
| `loyalty_transactions`, `ledger_entries` | business operation→purchase/membership/version/branch/staff؛ entry type/signed amount/sequence/original compensation reference | unique(operation)، unique(account,sequence)، composite FKs؛ earn integer>0، consumption<0، no update/delete، origin index |
| `reward_grants`, `reward_events` | earned transaction + ordinal، program_version + snapshot(title,terms,eligible_branches,validity)، earned/expires/redeemed/void times | unique(earned_transaction,ordinal)، one redemption per grant؛ immutable earned terms؛ available/expiry partial index |
| `presentation_tokens`, `transaction_tokens` | random hashed token، intended purpose، membership/merchant، issued/expires/revoked؛ optional transaction once-use | unique token hash، purpose check، expires index؛ no arbitrary membership ID in client token |
| `redemption_challenges`, `reward_redemptions` | reward، cashier session/branch، holder subject، challenge hash، expires، confirmed/consumed | partial unique open challenge per reward؛ unique(merchant,reward_id) completed redemption؛ challenge single-consumption |
| `stamp_requests`, `request_events` | membership/branch، status، matching code hash/display policy، expires، decision operation | partial unique pending membership+branch؛ version guard؛ no state change after final؛ decision unique |
| `correction_requests`, `correction_events` | original tx، requested delta/reason/evidence، requester/approver، status/review_reason، compensating tx | unique approved full reversal per original؛ approver≠requester افتراضيًا؛ unique compensation operation |
| `placements`, `placement_events`, `fulfillment_orders` | merchant/branch، random public code، media kind، revoked_at/replacement، shipping/install/physical verification | unique public code، replacements retain old history؛ active branch check؛ revoked route لا يمنح activity |
| `audit_events` | actor,tenant,branch,action,target,request/operation refs، reason، redacted before/after، timestamp | append-only runtime؛ (merchant,at,id)، (operation_id)، PII access review |
| `outbox_events`, `background_jobs`, `job_attempts` | event type/aggregate revision/tenant، lease token/deadline، next retry، dedupe، last outcome | unique(event,destination)، next_run/status partial index، lease generation fencing، append-only attempts |
| `provider_connections`, `merchant_provider_capabilities`, `wallet_passes`, `wallet_registrations` | provider account refs/secret refs لا قيم، merchant readiness، pass serial/object/revision، device registration token encrypted | unique(provider,merchant,membership)، unique(provider,external_id)، stale revision guard، registration unique device/pass |
| `consent_events`, `consent_current`, `notification_intents`, `deliveries` | subject/merchant/channel/purpose، legal/text version، grant/withdraw time، idempotent intent، provider IDs/unknown status | unique(event,recipient,channel,template_version)، current consent unique tuple؛ optout index |
| `campaigns`, `campaign_audiences`, `message_budget_reservations` | schedule UTC + source timezone، audience snapshot، delivery consent recheck، reserved/spent/released minor units | unique(campaign,recipient,channel)، atomic budget guard، delivery unique reservation |
| `plans`, `plan_versions`, `feature_entitlements`, `subscriptions`, `invoices`, `payments` | plan immutable revision، tenant overrides with expiry، external refs، invoice amount/currency، effective period | provider external IDs unique، no duplicate subscription active period؛ entitlement transaction guard |
| `webhook_inbox`, `billing_events` | provider event ID، raw payload hash/redacted data، verified signature timestamp، processing status، effective provider version | unique(provider,event_id)، retry after persistence؛ ordered reconciliation by provider object |
| `support_tickets`, `ticket_messages`, `exports` | tenant scope، linked operation، requester/scope snapshot، file key/expiry، visibility | scoped FKs، assignee validity، signed download auth، audit export+reveal |
| `analytics_daily`, `analytics_checkpoints` | merchant/branch/program/date + unique purchase/customer/transaction aggregates، watermark | unique dimension tuple، no cross-tenant rollup for merchant actor؛ rebuild from canonical facts |

## Ledger: نموذج الحساب

```text
account.remaining = SUM(ledger_entries.amount)
earn:              +qty
reward_consumption:-threshold  (ومعه reward grant منفصلة)
reversal:          عكس entry الأصلية، مربوط بيها
```

مثال رصيد 4، عتبة 5، award +2: نسجل +2 و-5 ونصدر grant واحدة؛ projection=1. كمية 12 عند حد مصرح وعتبة5 ورصيد4 تصدر3 grants ورصيد1؛ حدود integer تتراجع قبلها. `reward_grants.ordinal` يمنع تكرار الإصدار عند retry. balance مجرد projection ومعاها revision؛ nightly reconciliation تقارنها بالـledger وتعمل alert، لا تعدّل ledger لإخفاء فرق.

أول migration للولاء يمنع UPDATE/DELETE على ledger بـDB grants/trigger مخصص؛ تصحيح PII لا يغيّر amounts. تقارير الرصيد تقرأ projection، ودليل العملية يقرأ ledger + immutable response. seed يمر بأوامر domain أو opening-balance event مع سبب، علشان الرصيد والمكافآت والتاريخ يبقوا متسقين؛ الـDemo الحالي أرصدته مزروعة منفصلة عن التاريخ.

## بروتوكول التزامن والـIdempotency

1. Validate authenticated actor وactive staff وtenant/branch/entitlement؛ افتح transaction واضبط RLS context بـtransaction-local settings.
2. Claim `(tenant,actor,command,key)`؛ قارن canonical request hash. نفس key مع payload مختلف =409 `IDEMPOTENCY_CONFLICT`. الـhash يشمل membership/branch/purchase/qty، مع فصل presentation token قصير العمر عن business payload.
3. المفتاح المكتمل يرجّع stored result بعد authorization الحالي. command لسه شغال يرجع202 operation reference أوينتظر timeout محدود. operation/response مربوطين بنفس commit؛ rollback يلغي claims الجزئية.
4. Lock request/challenge لما موجود، بعده membership account، وبعده purchase claim؛ ترتيب موحد يتوثق في implementation ويُختبر لتجنب deadlocks. commands تمنع staff disable race بتأمين نسخة grant/check transaction؛ staff disable serialize على نفس grant lock أوpolicy version fence.
5. `purchase_references` canonical unique مستقلة عن key والطريقة والمستخدم. `purchase_allocations` default تمنع تخصيص نفس الشراء مرة تانية حتى لعضوية/برنامج تاني. conflict من request B بعد A =409 `PURCHASE_ALREADY_USED` ويرجع ref آمن لو الصلاحية تسمح.
6. الحساب + ledger + grants + projection + audit + outbox + operation snapshot داخل transaction واحدة. commit ثم HTTP success. failure قبل commit =لا أثر؛ failure بعد commit =نفس operation عند lookup/retry.
7. Retry SQL serialization/deadlock محدود وبنفس key؛ مفيش إعادة إرسال مدفوع داخل retry. المفتاح لا يتحذف بما يسمح بإعادة أثر قديم؛ يحتفظ tombstone ومراجع الـbusiness الفريدة حسب retention المعتمد.

تجربة SQL المطلوبة: 2 DB connections مستقلين، barrier عند lock، 50 parallel attempts لنفس الإيصال، وkill API بعد commit وقبل response. نجاح `Promise.all` في JavaScript أوstorage event مش دليل على سلامة ده.

## request / redemption / corrections

`stamp_request` من `pending` إلى approved/rejected/expired/cancelled، transition واحدة بـrow lock. نعيد فحص `expires_at > DB now()` **بعد** lock وعند commit logic؛ expiry job وapproval يمشوا بنفس guard. approval يشترك مع Method A في award service، ومش ينشئ stamp command تانية خارج transaction. كود المطابقة مع العميل جزء من approval contract ومعدل المحاولات محدود.

الاستبدال: lock grant، فحص available + `expires_at > transaction clock` + branch snapshot + staff active + authenticated holder confirmation + challenge not expired/used، ثم redemption row unique وgrant state event وtransaction/audit/outbox. لو اتنين صرفوا في وقت واحد واحد بس يفوز؛ انتهاء المكافأة بعد إنشاء challenge يمنع الصرف. payout الحقيقي تسليم التاجر، والنظام لا يعد العميل بتحويل نقدي.

التصحيح الآلي: full reversal لآخر award فقط بلا عمليات لاحقة، rewards المكتسبة منه available وغير مستخدمة؛ void grants وappend عكس consumption وearn في نفس transaction، فلا يختفي رصيد بالسالب أويتضاعف grant. partial adjustments والإضافات أوالعمليات اللاحقة أوالمكافأة المصروفة =review path مع owner decision وأثر واضح؛ لا تعديل صامت للـreward ولا receipt reuse. كل قرار يتكرر بنفس correction operation من غير أثر إضافي.

## Program versions وحقوق العملاء

published row immutable، والعضوية تشير لنسخة محددة. D10 الافتراضي: عضويات حالية تظل pinned، عضويات جديدة على آخر نسخة فعالة. الـversion تحدد شروط الكسب، لكن reward snapshot تحفظ شروط الاستبدال وقت الاكتساب. انتهاء earning window يوقف awards الجديدة؛ grants تستمر لحد `expires_at` الخاص بها. migration للعضويات بين قواعد اقتصادية مش update مباشر؛ تحتاج preview + موافقة + compensating/transition events واختبار conservation، خارج أول دورة.

## العزل والـMigrations

| Migration ID | Phase | التغيير واختبار الترقية |
|---|---|---|
| M001 | P01 | users/tenancy/grants/audit، RLS roles/policies؛ اختبار A/B مع app role حقيقي |
| M002 | P02 | brands/assets/branches/staff/invitations/provisioning/plans+manual entitlements؛outbox/jobs/attempts أساس للدعوات والتفعيل بعدcommit؛activate twice ->resource IDs ثابتة |
| M003 | P03 | profiles/program versions/memberships/terms/presentation handles؛ concurrent enrollment ->واحدة |
| M004 | P04 | purchases/operations/idempotency/ledger/accounts/reward grants؛توسيعoutbox/jobs الموجودة منM002 لأحداث الولاء؛invariant+multi-connection tests |
| M005 | P05 | challenges/redemptions/corrections/expiry indexes؛ expiry/redemption races |
| M006 | P06 | requests/events/approval constraints؛ approval/expiry/cancel race |
| M007 | P07 | aggregate read models/checkpoints + export jobs؛ reconcile to ledger |
| M008 | P08 | placement lifecycle/fulfillment/physical verification؛ revoke link mapping |
| M009 | P09 | support/reveal grants/job attempts enrichment؛ scoped operations lookup |
| M010 | P10 | provider connections/wallet passes/device registrations؛ unique external IDs + encryption |
| M011 | P11 | consent/delivery/campaigns/budgets؛ optout race + unknown outcomes |
| M012 | P12 | billing/subscriptions/inbox/events/versioned entitlements؛ duplicate/out-of-order fixture |
| M013 | P13 | indexes/retention/restore controls حسب قياس التنفيذ؛ explain plans + restore drill |

أرقام migration ثابتة في الخطة؛ timestamp filenames تتحدد عند التنفيذ. `db:migrate` و`db:seed` أوامر مستقبلية لازم P01 يوفّرها. بيئة local seed deterministic بساعة ثابتة وتاجرين وفرعين وكاشير branch-scoped وcustomer متعدد العضويات. production ممنوع Demo seed أوglobal reset endpoint. migrations تتجرب empty DB ثم upgrade من last release snapshot ثم app compatibility. large indexes concurrent حيث مناسب؛ expand/backfill/validate/contract في إصدارات منفصلة. rollback للـschema المهدّمة مش مسموح كإجراء عادي؛ restore isolated + reconciliation أوforward fix.

المصدر المرجعي لآلية RLS والـowner bypass: [PostgreSQL documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html). باقي الجدول تصميم Nuqta المقترح.
