# Screen to feature map

> تحديث التنفيذ: وصف P00 والـMock في هذا الملف يوثق الأصول عند مراجعتها. السورس الحالي المتصل وحدود قبوله في [IMPLEMENTATION](IMPLEMENTATION.md) و[STATUS](STATUS.md). جدول المراحل هنا خطة قبول، مش إعلان اكتمال إنتاجي.


المسارات تحت **الحالية**، مش routing جديد. `SA`=`/Nuqta%20-%20Super%20Admin.html`، `MD`=`/Nuqta%20-%20Merchant%20Dashboard.html`، `CA`=`/Nuqta%20-%20Cashier%20Portal.html`، `CU`=`/Nuqta%20-%20Customer%20Portal.html`. `@view`/`@screen`/`@tab` معناها state داخل React لا deep link؛ refresh بيرجع default أو query الأصلية. `?view` مدعوم للشاشات العليا بس في SA/MD؛ التفاصيل بتحتاج IDs في state من الضغط على الواجهة.

مصادر الملفات: الأصل في `standalone/Nuqta - <name>.html`؛ الملفات المفكوكة حرفيًا للقراءة:

| الرمز | Logic الحالي | Template الحالي |
|---|---|---|
| SA | [super-admin.app.js](evidence/extracted/super-admin.app.js) | [super-admin.template.html](evidence/extracted/super-admin.template.html) |
| MD | [merchant-dashboard.app.js](evidence/extracted/merchant-dashboard.app.js) | [merchant-dashboard.template.html](evidence/extracted/merchant-dashboard.template.html) |
| CA | [cashier-portal.app.js](evidence/extracted/cashier-portal.app.js) | [cashier-portal.template.html](evidence/extracted/cashier-portal.template.html) |
| CU | [customer-portal.app.js](evidence/extracted/customer-portal.app.js) | [customer-portal.template.html](evidence/extracted/customer-portal.template.html) |
| NQ | [mock-repository.js](evidence/extracted/mock-repository.js) | نفس المورد SHA256 في الخمس exports التفاعلية |
| LC | [LoyaltyCard.dc.html](evidence/extracted/LoyaltyCard.dc.html) | shared component props، 3 templates |

كل بيانات NQ هي seed + localStorage؛ الصلاحية في الجدول **المطلوبة** في المنتج، ومش دليل authorization حقيقي دلوقتي. `R`=تم فتح الشاشة في browser؛ `J`=تفاعل UI مُختبر؛ `C`=موجود في الكود ومش تم اختبار كل حالاته؛ `M`=ناقص. حتى R/J كلها Demo-ready فقط. API IDs من [API-PLAN](API-PLAN.md).

## Launcher / design

| الشاشة | المسار | الملفات | البيانات | الإجراء | الصلاحية المطلوبة | API | Phase | الجاهزية |
|---|---|---|---|---|---|---|---|---|
| Demo Launcher | `/` أو`/Nuqta%20-%20Demo%20Launcher.html` | demo-launcher.app.js/template | NQ.session،APPS/JOURNEYS | فتح persona،لغة،شبكة،reset | dev-only | لا production endpoint | P00/P01 | R؛ أداة عرض لا صفحة تجارية |
| Design System | `/Nuqta%20-%20Design%20System.html` | design-system.app.js/template + LC | tokens/sample props | عرض ألوان/controls/states | internal design | — | P01 | R؛ inline styles، مش UI package |

## Platform Super Admin

| الشاشة | المسار | الملفات | البيانات | الإجراء | الصلاحية | API | Phase | الجاهزية |
|---|---|---|---|---|---|---|---|---|
| Overview | SA أو`?view=overview` | SA + NQ.platformMetrics | merchants,transactions,jobs | فتح follow-up | PA/PS scoped | API29 | P09؛minimal P04 | R،MRR تجريبي |
| Merchants list | SA`?view=merchants` | SA | merchants/contact | بحث،تفاصيل،تعليق | PA،PS read | API08 | P02/P09 | R |
| Merchant overview | SA`@view=merchant,mid;tab=overview` | SA lines81+ | merchant + metrics | عرض/تعليق/restore | PA reason؛PS read | API08,26 | P02/P09 | C |
| Merchant branding | SA`@merchant,tab=branding` | SA + LC | brand/program sample | card preview | PA delegated | API12 | P02 | C |
| Merchant programs | SA`@merchant,tab=programs` | SA | programs/version number | عرض | PA/PS read | API14 | P02/P03 | C؛history مش immutable |
| Merchant branches | SA`@merchant,tab=branches` | SA | branches + metrics | عرض | PA/PS scoped | API09,26 | P02/P07 | C |
| Merchant staff | SA`@merchant,tab=staff` | SA | staff/branches | عرض | PA؛PII policy | API10,11 | P02 | C |
| Merchant subscription | SA`@merchant,tab=subscription` | SA | plan/invoices | عرض | PA billing/PS subset | API37,38 | P12 | C |
| Merchant integrations/tasks | SA`@merchant,tab=integrations` | SA | wallet/channel/tasks | retry task | PA integration ops | API07,31 | P09/P10/P11 | C؛retry محاكاة |
| Merchant operations | SA`@merchant,tab=operations` | SA | transactions | timeline | PA/PS scoped | API29 | P04/P09 | C |
| Merchant tickets | SA`@merchant,tab=tickets` | SA | tickets | فتح thread | PA/PS assigned | API30 | P09 | C |
| Merchant config history | SA`@merchant,tab=history` | SA | audit mutable array | عرض | PA/PS scoped | API29 | P09 | C |
| Provisioning landing/drafts | SA`?view=provisioning` | SA | drafts/activations | جديد،resume،delete | PA | API05,07 | P02 | R/J فتح wizard |
| Wizard business/contact | SA`@wizard,step=1` | SA blankDraft/validate | draft business | validation/save | PA | API05 | P02 | J فتح فقط |
| Wizard logo/brand/card | SA`@wizard,step=2` | SA + LC | logo boolean/colors/template | محاكاة upload/preview | PA | API12,05 | P02 | C؛مفيش asset upload |
| Wizard program rules | SA`@wizard,step=3` | SA | threshold/reward/validity | validation/save | PA | API14,05 | P02 | C |
| Wizard branches/team | SA`@wizard,step=4` | SA | branches/staff | add/remove/invite config | PA | API09,10,05 | P02 | C؛لا اختيار branch grants لكل staff حاليًا |
| Wizard QR/NFC/Wallet | SA`@wizard,step=5` | SA | qr/nfc/provider seed | config/preview | PA | API28,31,05 | P02/P08/P10 | C؛لا physical proof |
| Wizard messages/plan | SA`@wizard,step=6` | SA | channels/plans | اختيار | PA | API38,31,05 | P02/P11/P12 | C |
| Wizard review | SA`@wizard,step=7` | SA | draft + validation | activate confirm | PA/MFA | API06 | P02 | C؛duplicate activation مثبت |
| Activation results | SA`@view=activation,activated` | SA + NQ.activateMerchant | created resources/tasks | retry per step | PA | API07 | P02/P09 | C؛web/task statuses محاكاة |
| Operations/search/timeline | SA`?view=operations` | SA | tx/attempt/receipt/jobs | بحث وكشف PII و retry | PA/PS scoped reason | API19,29 | P04/P09 | R؛search محلي |
| Audit log | SA`?view=operations` داخل القسم | SA | audit | filter merchant/action | PA/PS scope | API29 | P01/P09 | R section؛مش immutable |
| Support list/thread | SA`?view=support` | SA | tickets/messages | رد/assign/status | PS assigned/PA | API30 | P09 | R؛no real delivery |
| Billing | SA`?view=billing` | SA | invoices/plans | charge mock/change plan | PA billing | API37,38,39 | P12 | R؛مفيش تحصيل |
| Integrations | SA`?view=integrations` | SA | provider fixtures | test/renew mock | PA integrations/MFA | API31 | P09/P10/P11 | R؛no live credentials |
| System health | SA`?view=system` | SA | counts/network toggles | simulate/reset | PA ops؛reset dev-only | API29,40 | P09/P13 | R؛مش infra health |
| Settings/platform team/privacy | SA`?view=settings` | SA | CONFIG/platform staff/mask pref | عرض/تبديل privacy | PA | API03,29,31 | P09 | R؛بعض config إرشادي |
| Admin login/MFA/recovery | غير موجود | جديد Identity UI | verified identity | login/MFA/revoke | PA/PS | API01–03 | P01 | M |

## Merchant Dashboard

| الشاشة | المسار | الملفات | البيانات | الإجراء | الصلاحية | API | Phase | الجاهزية |
|---|---|---|---|---|---|---|---|---|
| Overview | MD`?m=m_cafe&view=home` | MD + NQ.metrics | transactions/memberships/rewards | period/branch filters/correction review | MO/MM branch scope | API26,23 | minimal P04/P05،كامل P07 | R |
| Customer Directory | MD`?m=...&view=customers` | MD | customersOf + idle filters | search/filter/open | MO/MM permitted branch | API26 | P03/P07 | R/J |
| Customer Details | MD`@view=customer,custId` | MD | scoped membership/consent/tx | activity/reward view | MO/MM data_read | API26 | P03/P05/P07 | J |
| Loyalty Programs | MD`?view=programs` | MD | programs + versions | new/edit/end | MO write/MM read | API14 | P02/P03/P05 | R/J editor |
| Program Editor/Preview | MD`@view=programEdit,progDraft` | MD + LC | draft rules | save/publish/end confirm | MO | API14 | P02/P05 | J فتح؛publish C |
| Branches | MD`?view=branches` | MD | branches + stats | فتح تفاصيل | MO/MM scoped | API09,26 | P02/P07 | R؛CRUD ناقص |
| Branch Details | MD`@view=branch,branchId` | MD | staff/materials/counts | materials navigation | MO/MM scope | API09,28 | P02/P08 | C |
| Staff & permissions | MD`?view=team` | MD | staff/grants | invite/edit/disable/resend/log | MO/delegated manager | API10,11 | P02 | R؛resend toast فقط |
| Staff log/dialog | MD`@staffLogId` | MD | transactions | عرض سجل | MO/MM scope | API26 | P04/P07 | C |
| Segments/inactivity | MD`?view=customers` filters + `?view=marketing` | MD + audience | memberships lastActivity | filters/reachable count | MO/MM permitted | API26,27,36 | P07/P11 | R؛no saved segment screen |
| Campaign composer/review | MD`?view=marketing` | MD | segment/channel/budget | preview/send/schedule | MO campaign_send | API36 | P11 | R؛fake delivery stats |
| Delivery reports | MD`?view=marketing` report section | MD | campaigns | عرض counts | MO scoped | API36 | P11 | R؛no provider receipts |
| Branding/live previews | MD`?view=brand` | MD + LC | merchant colors/template | upload mock/change/publish | MO | API12 | P02 | R؛logo fake |
| QR/NFC material center | MD`?view=brand` section | MD | placements/material lifecycle | copy/revoke/replace/verify | MO،CA verify own branch | API28 | P08؛basic link P03 | R؛QR زخرفي |
| Subscription/Billing | MD`?view=subscription` | MD | plans/invoices | plan change confirm | MO billing | API37,38 | manual P02،كامل P12 | R |
| Settings/channels | MD`?view=settings` | MD | merchant contact/terms/capabilities | save/contact updates | MO | API08,12,31 | P02/P11 | R |
| Data export/download | غير موجود | جديد export UI | export job/file | create/status/download | MO data_export | API27 | P07/P13 | M |
| Merchant auth/invite accept | غير موجود | جديد Identity UI | Auth/invitations | verify/accept/recover | MO/MM | API01–04 | P01/P02 | M |

## Cashier Portal

| الشاشة | المسار | الملفات | البيانات | الإجراء | الصلاحية | API | Phase | الجاهزية |
|---|---|---|---|---|---|---|---|---|
| Home/recent operations | CA`?staff=s_youssef&branch=b_zam` | CA | session/requests/tx | scan/queue/correct | CA active assigned branch | API03,25,26 | P04/P06 | R/J |
| Disabled/unauthorized branch | CA params staff=s_omar أو s_mai | CA | staff.status/grants | منع/notice | server active grant | API03,18,22 | P01/P04 | C UI،Mock guards مُختبرة |
| Locked shift/unlock | CA`@locked` | CA | cashier session | PIN0000 demo/unlock | authenticated device staff | API03 + session reauth | P01/P04 | C؛مش login حقيقي |
| Login/allowed branch picker | login غير موجود؛demo controls فقط | جديد identity + CA refactor | authorized grants | login/select allowed only | CA | API01–03 | P01/P02/P04 | M |
| Scanner/camera denied | CA`@screen=scanner` | CA | scanOpts/permission flag | simulate token/manual entry | CA active branch | API17 | P04 | J simulation؛camera M |
| Manual customer lookup | CA`@screen=lookup` | CA | masked customer query | search/select | CA minimal branch scope | API26,17 | P04 | C |
| Membership summary | CA`@screen=member,msid` | CA | membership/program/grants | award/redeem | CA authorized membership/program | API17,18,20 | P04/P05 | J |
| Stamp quantity/receipt | CA`@screen=stamp` | CA | receipt/qty/limits | validate/review | CA qty≤permission | API18 | P04 | J |
| Award review | CA`@screen=review` | CA | attempt/payload | confirm/edit | CA current active scope | API18 | P04 | J |
| Pending/result verification | CA`@screen=pending` | CA.run | attempt | wait/lookup same attempt | original authorized actor | API19 | P04 | J lost response |
| Receipt/success/replay | CA`@screen=receipt` | CA | tx/rewards/replay | same-key retry/next | CA scope | API18,19 | P04/P05 | J duplicate unchanged |
| Error/retry | CA`@screen=error` | CA ERR | failure codes | recover/edit/same attempt | CA scope | API18,19,22,25 | P04–P06 | C؛some errors no recovery |
| Branch request queue | CA`@screen=queue` | CA | branch pending requests | open | CA branch | API25 | P06 | C |
| Request details/approve | CA`@screen=reqDetail,reqId` | CA | code/expiry/receipt/qty | match/approve | CA branch + code verified | API25 | P06 | C UI؛Mock approve tested |
| Request rejection sheet | CA`@rejectOpen` | CA | reason presets | reject | CA branch | API25 | P06 | C |
| Reward selection | CA`@screen=redeemPick` | CA | reward grants | choose/start | CA reward eligible branch | API20 | P05 | C |
| Holder confirmation waiting | CA`@screen=redeemWait` | CA | challenge/status | wait/complete/cancel | CA + separate CU proof | API20–22 | P05 | C؛staff simulate bypass موجود |
| Correction sheet/status | CA`@corr` | CA | tx/delta/reason/mock PIN | request/manager decision | CA request،MM/MO separate approval | API23 | P05 | C؛duplicate correction مثبت |

## Customer Portal

| الشاشة | المسار | الملفات | البيانات | الإجراء | الصلاحية | API | Phase | الجاهزية |
|---|---|---|---|---|---|---|---|---|
| My Cards | CU`?c=c1` أو default | CU + LC | membershipsOfCustomer | open tenant card | CU ownership | API16 | P03 | R |
| Merchant landing | CU`?m=m_cafe&src=qr&b=b_zam&new=1` | CU | brand/terms/programs/branch | join/recover | PU public only | API13 | P03 | J |
| Paused merchant | CU`?m=m_bakery&new=1` | CU | merchant status | notice/support | PU/CU own balance | API13,16 | P03 | C |
| Email/recover email | CU`@screen=email` | CU | form | request code | PU rate limited | API01 | P01/P03 | J؛no email sent |
| OTP | CU`@screen=otp` | CU | fixed123456 | verify/recover | proof verified server | API02 | P01/P03 | J؛fake auth |
| Choose program | CU`@screen=program` | CU | active programs | choose | CU | API13,15 | P03 | C؛محتاج >1 active fixture |
| Terms/marketing consent | CU`@screen=consent` | CU | terms+optional checkboxes | accept/join | CU explicit consent | API15,34 | P03/P11 | J؛optional off default |
| Enrollment success | CU`@screen=success` | CU | register result | open card | CU owns membership | API15,16 | P03 | J + reload persistence |
| Branded card | CU`?m=...` existing أو`@screen=card` | CU + LC | balance/version/rewards | QR/request/history | CU ownership | API16 | P03/P04 | R/J |
| Personal QR/countdown | CU`@screen=qr` | CU QRPAT + NQ.issueQr | unsigned token | refresh/show | CU owns membership | API17 | P03/P04 | C؛decorative QR +forgeable token |
| Stamp request branch picker | CU`@screen=request` | CU | branch options | request | CU + valid placement | API24 | P06 | C |
| Request pending/final | CU`@screen=reqStatus` | CU | request/code/expiry | cancel/retry | CU owns request | API24 | P06 | C |
| Reward detail/history | CU`@screen=reward` + card history | CU | grants/status/expiry | view terms | CU owns grant | API16 | P05 | C |
| Redemption holder dialog | CU overlay holder confirmation | CU | reward.redemption | yes/no | authenticated holder challenge | API21 | P05 | C؛no secure proof |
| Activity log | CU`@screen=history` | CU | txOfMembership | read | CU ownership | API16 | P04/P05 | C |
| Wallet section/buttons | CU card section | CU | ready seed flags | toast simulated add | CU + merchant/provider ready | API32,33 | P10 | C؛integration M |
| Message preferences | CU`@screen=prefs` | CU | consent current map | optin/out | CU ownership | API34 | P03/P11 | C |
| Help/recover/add home | CU`@screen=help` + add-home guidance | CU | static guidance | recover | PU/CU | API01,02,30 | P03/P09 | C؛PWA manifest/service worker M |

## الفجوات المشتركة

فصل persona switches من واجهات الإنتاج، URL validation و 404 boundaries، real Auth و session revoke و branch authorization، realtime/polling من API بدل storage events، loading/error/empty states على شبكة حقيقية، server pagination، accessibility testing، data exports، file uploads، scannable QR والكاميرا، Wallet/paid delivery/payments. مفيش نسبة اكتمال تجارية محسوبة من عدد الشاشات؛ جاهزية الواجهة لا تساوي جاهزية العملية.
