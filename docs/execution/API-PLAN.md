# API plan

> تحديث التنفيذ: وصف P00 والـMock في هذا الملف يوثق الأصول عند مراجعتها. السورس الحالي المتصل وحدود قبوله في [IMPLEMENTATION](IMPLEMENTATION.md) و[STATUS](STATUS.md). جدول المراحل هنا خطة قبول، مش إعلان اكتمال إنتاجي.


**كل endpoints هنا PLANNED. الحالي `window.NQ` API داخل المتصفح فقط، ومفيش loyalty HTTP API.** الـprefix المقترح `/api/v1`؛ Apple Wallet web-service بروتوكول مزود مستقل بversion path، مش JSON contract العام.

## قواعد العقود

Cookie session `HttpOnly/Secure/SameSite` وCSRF protection للأوامر، managed identity يتحقق منها server؛ لا `staffId` أو`customerId` في body يُستخدم كهوية. HTTP401 للـunauthenticated،403 للصلاحية المرفوضة داخل scope معلوم،404 لـforeign/private resource منعًا لتسريب وجوده،409 للـbusiness conflict،410 للـexpired/revoked public token حيث آمن،422 للمدخلات،429 للحدود،503 لعدم الجاهزية. Responses فيها `requestId`، وأي mutation مهمة `operationId` و`status`. الأخطاء:

```json
{"error":{"code":"PURCHASE_ALREADY_USED","messageKey":"loyalty.purchase_used","retryable":false,"requestId":"...","operationId":"..."}}
```

pagination cursor ثابت وlimit≤100؛ filters allowlist. كل GET خاص no-store، DTO minimal، masked contact افتراضيًا. timestamps ISO8601 UTC مع reporting timezone/watermark. كل POST/PATCH اقتصادي أوprovisioning يدعم `Idempotency-Key`، وPATCH config معه `If-Match` revision. إعادة الطلب المكتمل ترجع نفس status/body التجاري المحفوظ؛ authorization الحالي يسبق replay. الاستخدام الخاطئ للمفتاح =409. حالة غموض في الاتصال لا تتحول لفشل تجاري في UI؛ lookup/resubmit نفس المفتاح. retention واختبارات التزامن في DATABASE-PLAN.

Actors: `PA` platform admin؛ `PS` support restricted؛ `MO` merchant owner؛ `MM` manager authorized branches؛ `CA` cashier assigned branch؛ `CU` verified customer؛ `PU` public allowlisted data؛ `WH` authenticated provider webhook. scope التاجر في path ثم يطابقه الخادم مع grants. `K` تحت =Idempotency-Key، `R`=If-Match، `—` قراءة/غير مناسب، `E`=external event unique key.

## Endpoint inventory

| ID / Phase | Method + path بعد prefix | Actor / Authorization | Request → Response | Idempotency | أخطاء أساسية | Side effects |
|---|---|---|---|---|---|---|
| API01 / P01 | POST `/auth/challenges` | PU، rate-limit identity/IP/device | normalized email + intent + merchant context → generic challengeId/expires | K + resend cooldown | RATE_LIMITED, CHANNEL_UNAVAILABLE | Auth email intent؛ لا كشف وجود حساب |
| API02 / P01 | POST `/auth/challenges/{id}/verify` | PU + challenge binding | code → session + allowed contexts | K، one-use challenge | INVALID_CODE, EXPIRED, LOCKED | Session إنشاء، attempt count، audit؛ OTP لا يظهر logs |
| API03 / P01 | GET `/session`; POST `/auth/logout` | signed-in actor | — → actor/context grants؛ logout→204 | session revoke idempotent | SESSION_REVOKED | invalidate server session؛ no tenant role from browser |
| API04 / P02 | POST `/invitations/{token}/accept` | verified invited identity | token + verified subject → staff membership | K/token one-use | EXPIRED, REVOKED, IDENTITY_MISMATCH | accept invite + grant + audit |
| API05 / P02 | GET/POST `/platform/provisioning-drafts`; GET/PATCH `/platform/provisioning-drafts/{id}` | PA | business/brand/card/program/branches/branch-scoped invites/plan/provider opts → draft/revision/validation | K create، R patch | VALIDATION_FAILED, REVISION_CONFLICT | saved draft + audit؛ no external send |
| API06 / P02 | POST `/platform/provisioning-drafts/{id}/activate` | PA + MFA | draftRevision →202 activationId/merchantId/steps | K + unique(draft,revision) | DRAFT_INCOMPLETE, PLAN_LIMIT, REVISION_CONFLICT | merchant/resources واحدة + invite/outbox jobs؛ web ready مستقل |
| API07 / P02 | GET `/platform/activations/{id}`; POST `/platform/activations/{id}/steps/{key}/retry` | PA، step capability | — أوreason →state + stable resource refs | — / K | NOT_RETRYABLE, PROVIDER_BLOCKED | safe step retry job؛ no duplicate invitation/assets |
| API08 / P02,P09 | GET `/platform/merchants`; GET/PATCH `/platform/merchants/{m}`; POST `/platform/merchants/{m}/status` | PA، PS read subset | filters/patch أوstatus/reason → merchant/state | — / K+R | SUSPENSION_REASON_REQUIRED, REVISION_CONFLICT | lifecycle audit، cache/session invalidation؛ لا حذف الحقوق |
| API09 / P02 | GET/POST `/merchants/{m}/branches`; PATCH `/merchants/{m}/branches/{b}` | MO write؛ MM scoped read | name/address/timezone/status → branch/revision | K/R | TENANT_MISMATCH, BRANCH_LIMIT | audit + projection invalidation |
| API10 / P02 | GET `/merchants/{m}/staff`; POST `/merchants/{m}/invitations`; POST `/merchants/{m}/invitations/{i}/resend`; DELETE same | MO؛ MM لا يدعو owner ولا يوسع scope | email,role,branchIds,maxQty → invite state | K، token rotation tracked | ROLE_NOT_ALLOWED, INVITE_PENDING, PLAN_LIMIT | email outbox؛ revoke old link |
| API11 / P02 | PATCH `/merchants/{m}/staff/{s}` | MO أوdelegated staff admin، no self escalation | grants/status/maxQty + reason →revision | K/R | LAST_OWNER, ROLE_NOT_ALLOWED | active session permissions invalidated فورًا؛ audit |
| API12 / P02 | GET/PATCH `/merchants/{m}/branding`; POST `/merchants/{m}/assets/upload-intents`; POST `/merchants/{m}/assets/{id}/complete` | MO، PA delegated | brand revision أوmime/size → private upload + approved asset state | K/R | UNSAFE_FILE, ASSET_NOT_OWNED, REVISION_CONFLICT | validate/scan asset، brand publish event، no Wallet promise |
| API13 / P03 | GET `/public/merchants/{slug}`; GET `/public/placements/{code}` | PU، active/public fields only | public code →brand/program terms/branch + capability | — | NOT_FOUND, PLACEMENT_REVOKED, MERCHANT_PAUSED | resolve analytics event فقط؛ **لا award/visit** |
| API14 / P02,P03 | GET/POST `/merchants/{m}/programs`; POST `/merchants/{m}/programs/{p}/versions`; POST `.../versions/{v}/publish`; POST `.../end-earning` | MO؛ MM read | rules/eligible branches/terms →immutable version | K/R | INVALID_RULE, NO_ELIGIBLE_BRANCH, REVISION_CONFLICT | publish audit، existing memberships pinned D10 |
| API15 / P03 | POST `/me/memberships` | CU owns verified subject | merchantId,programId,termsVersion,sourceContext,optional consents →201 membership/card or200 existing | K + unique membership | TERMS_REQUIRED, PROGRAM_INACTIVE, MERCHANT_PAUSED | profile/membership/acceptance + outbox؛ no duplicate balance |
| API16 / P03 | GET `/me/memberships`; GET `/me/memberships/{id}`; GET `.../activity`; GET `.../rewards` | CU ownership | cursor/range →brand+balance+reward snapshots/revision | — | NOT_FOUND, SESSION_REVOKED | none؛ لا تعد زيارة |
| API17 / P03,P04 | POST `/me/memberships/{id}/presentation-tokens`; POST `/cashier/scans/resolve` | CU owns card؛ CA active+authorized branch | membership→token/expiry؛ token+branch→masked membership/program/actions | K issuance، resolve no effect | TOKEN_INVALID, TOKEN_EXPIRED, FOREIGN_MEMBERSHIP, BRANCH_UNAUTHORIZED | scan access audit/rate-limit؛ لا أختام |
| API18 / P04 | POST `/merchants/{m}/stamp-awards` | CA/MM/MO active tenant+branch+qty+program entitlement | branchId,membershipId,quantity,purchaseReference,presentationContext →committed operation/result | K + canonical purchase unique | STAFF_DISABLED, BRANCH_UNAUTHORIZED, QTY_INVALID, PURCHASE_ALREADY_USED, PROGRAM_INACTIVE | atomic ledger/projection/grants/audit/outbox |
| API19 / P04 | GET `/operations/{id}`; GET `/operations/by-key?command=...&key=...` | original actor أوtenant read permission؛ PS restricted | stable ref →pending/committed/failed/unknown + stored result | — | NOT_FOUND, SESSION_REVOKED | safe lookup؛ no new commercial attempt |
| API20 / P05 | POST `/merchants/{m}/rewards/{r}/redemption-challenges` | CA authorized branch + eligible reward | branchId,presentationContext →challengeId/code/expires | K + active challenge unique | REWARD_EXPIRED, REWARD_REDEEMED, BRANCH_UNAUTHORIZED | challenge/audit؛ no redemption yet |
| API21 / P05 | GET `/me/redemption-challenges`; POST `/me/redemption-challenges/{id}/decision` | CU authenticated reward holder | approve/decline + bound challenge →state | K + once-only decision | HOLDER_MISMATCH, CHALLENGE_EXPIRED | holder proof/audit، not simulated staff button |
| API22 / P05 | POST `/merchants/{m}/redemption-challenges/{id}/complete`; POST `.../cancel` | original CA session or authorized recovery actor | branch/session binding →redemption receipt or cancellation | K + unique reward redemption | HOLDER_NOT_CONFIRMED, CHALLENGE_EXPIRED, REWARD_EXPIRED, ALREADY_REDEEMED, STAFF_DISABLED | atomic redeem/event/ledger business tx/audit/outbox |
| API23 / P05 | POST `/merchants/{m}/corrections`; GET same; POST `/merchants/{m}/corrections/{id}/decision` | CA request original scoped tx؛ MM/MO approve، separate actor | txId,reason,evidence,requested delta؛ approve/reject →applied/needs_review/rejected | K + unique compensation | SUBSEQUENT_ACTIVITY, REWARD_ALREADY_USED, SELF_APPROVAL_FORBIDDEN | compensating ledger + grant events، original remains |
| API24 / P06 | POST `/me/memberships/{id}/stamp-requests`; GET `/me/stamp-requests/{r}`; POST `.../cancel` | CU owns membership + valid placement/branch | branchId/placementContext →request/match code/expires | K + pending unique | REQUEST_EXISTS, PROGRAM_INACTIVE, PLACEMENT_REVOKED | request فقط؛ لا award |
| API25 / P06 | GET `/merchants/{m}/branches/{b}/stamp-requests`; POST `.../{r}/approve`; POST `.../{r}/reject` | CA active branch | matchedCode,quantity,purchaseReference أوreason →decision + operation | K + lock request | REQUEST_EXPIRED, REQUEST_FINAL, MATCH_CODE_INVALID, PURCHASE_ALREADY_USED | approve نفس award service transaction؛ notify portal |
| API26 / P04,P07 | GET `/merchants/{m}/overview`; GET `/merchants/{m}/customers`; GET `/merchants/{m}/customers/{id}`; GET `.../transactions` | MO all allowed؛ MM authorized branches؛ CA lookup minimal | timeWindow/branch/program/cursor/q →DTO + definitions/watermark | — | FILTER_SCOPE_FORBIDDEN, RANGE_INVALID | masked query audit، no global customer enrichment |
| API27 / P07 | GET `/merchants/{m}/segments`; POST `/merchants/{m}/exports`; GET `/merchants/{m}/exports/{id}`; GET `.../{id}/download` | MO data_export؛ MM explicit scope | filter+format →202 job أوauthorized signed URL | K | EXPORT_LIMIT, ACCESS_REVOKED, EXPORT_EXPIRED | private scoped export job + access audit |
| API28 / P08 | GET/POST `/merchants/{m}/placements`; POST `.../{id}/revoke`; POST `.../{id}/replace`; POST `.../{id}/verify`; POST `.../{id}/fulfillment-transition` | MO order/revoke؛ CA verify assigned branch؛ PA ops fulfillment | branch/kind/URL policy/reason/device check →placement + QR artifact | K/R | INVALID_TRANSITION, PLACEMENT_REVOKED, UNAUTHORIZED_BRANCH | stable URL/real QR generation، audit physical attestation |
| API29 / P09 | GET `/platform/overview`; GET `/platform/operations/{ref}`; GET `/platform/jobs`; GET `/platform/jobs/{id}`; POST `.../retry`; GET `/platform/audit` | PA؛ PS allowlisted refs/safe retry | filters/ref/retryReason →timeline/jobs/audit | — / K retry | UNSAFE_RETRY, UNKNOWN_OUTCOME, NOT_AUTHORIZED | job lease respecting retry + audit؛ no arbitrary provider payload |
| API30 / P09 | GET/POST `/merchants/{m}/tickets`; GET/POST `/merchants/{m}/tickets/{id}/messages`; PATCH `.../{id}` | MO scoped؛ PS assigned tickets via platform path | subject/message/status/operationRef →thread | K/R | OPERATION_NOT_IN_SCOPE, INVALID_STATUS | persisted support message، optional email outbox |
| API31 / P09,P10,P11 | GET `/platform/integrations`; GET `/platform/merchants/{m}/capabilities`; POST `/platform/integrations/{id}/checks`; POST `.../credential-rotation-intents` | PA integration_admin، MFA for rotation؛ PS read redacted | provider/secret reference/check request →health/status/no secret | K | ACCOUNT_NOT_ELIGIBLE, SECRET_UNAVAILABLE, CHECK_FAILED | safe provider check/job + audit؛ secret upload عبر controlled store |
| API32 / P10 | POST `/me/memberships/{id}/wallet/{provider}/issuance`; GET `/me/wallet-issuances/{id}` | CU owns membership + provider+merchant ready | provider/device context →202 operation ثم pass URL/save JWT | K + unique pass identity | PROVIDER_NOT_READY, AUTHORIZATION_REQUIRED | outbox create/update pass؛ no reward balance mutation |
| API33 / P10 | provider-specific `/wallet/apple/v1/...` routes؛ Google callback/status handler | Apple per-pass auth token أوverified callback | registration/unregistration/update list/pass fetch/log →provider protocol status | E/registration unique | 401,404,429؛ provider-specific | register device، signed pass fetch، token redaction |
| API34 / P11 | GET/PATCH `/me/merchants/{m}/preferences`; POST `/public/opt-outs/{token}` | CU owns consent أوpurpose-bound optout token | channel/purpose/version decision →current preferences | K/event unique | TOKEN_INVALID, CONSENT_VERSION_REQUIRED | append consent event، cancel queued eligible delivery |
| API35 / P11 | POST `/me/push-subscriptions`; DELETE `.../{id}` | CU authenticated origin | push endpoint/keys →subscription | K + endpoint unique | ORIGIN_INVALID, SUBSCRIPTION_INVALID | encrypted endpoint storage؛ notification permission from browser |
| API36 / P11 | GET/POST `/merchants/{m}/campaigns`; POST `.../{id}/preview`; POST `.../{id}/schedule`; POST `.../{id}/cancel`; GET `.../{id}/deliveries` | MO campaign_send، budget/plan gates | segment/channel/template/timezone/budget →audience reachable/cost quote/state | K/R | OPT_OUT, BUDGET_EXCEEDED, CHANNEL_NOT_READY, QUOTE_STALE | budget reservation/outbox؛ recheck consent at send |
| API37 / P12 | GET `/merchants/{m}/subscription`; GET `/merchants/{m}/invoices`; POST `/merchants/{m}/billing-checkout`; POST `/merchants/{m}/subscription-changes` | MO billing_manage | planVersion/effective date →checkout URL/pending change | K | PLAN_LIMIT, PROVIDER_UNAVAILABLE, CHANGE_CONFLICT | provider request + local pending intent؛ no browser-paid flag |
| API38 / P02,P12 | GET/PATCH `/platform/merchants/{m}/entitlements` | PA billing_admin | feature/limit/reason/expiry/revision →effective entitlements | K/R | INVALID_OVERRIDE, LIMIT_BELOW_USAGE | audit + server limits/caches invalidation |
| API39 / P11,P12 | POST `/webhooks/{provider}` | WH signature/raw-body/time validation | provider event →202/200 durable receipt | E unique(provider,eventId) | INVALID_SIGNATURE, REPLAY_REJECTED, PAYLOAD_TOO_LARGE | inbox persist then process/reconcile asynchronously |
| API40 / P01,P13 | GET `/health/live`; GET `/health/ready` | internal allowlist، public minimal if needed | — →healthy/not-ready no sensitive dependency config | — | 503 | telemetry only |

## عقد أول stamp بالتفصيل

```json
{
  "branchId":"branch_uuid",
  "membershipId":"membership_uuid",
  "quantity":2,
  "purchaseReference":{
    "namespace":"manual-pos-1",
    "reference":"R-2026-1138",
    "businessDate":"2026-11-07"
  },
  "presentationContext":"opaque_context"
}
```

`merchant_id` من path المعتمد، staff من session، date/branch scope من إعداد مصدر الإيصال في الخادم. العرض يرجع `operationId,transactionId,purchaseId,balanceAfter,accountRevision,rewardGrants[],committedAt`؛ rewards فيها earned version+snapshot+expiry. `balanceAfter` نتيجة العملية الأصلية؛ مش current balance وقت replay. إضافة qty3 عملية شراء واحدة وزيارة مؤكدة واحدة. Method B يضيف `requestId` وmatch proof داخل approve contract، ويمر بنفس purchase canonicalizer ونفس uniqueness.

الـOpenAPI والـJSON schemas تتولد وتتراجع في P01، وتتثبت لكل مهمة قبل ربط الشاشة. كل API row لها negative authorization وtenant/branch tests قبل اعتبارها DONE. أسماء الأخطاء مترجمة في UI؛ رسائل السيرفر لا تعرض stack أوsecret values.


العقود الحالية المصدرية يمكن جردها بـnpm run openapi:export. [OpenAPI الحالي](evidence/implementation/openapi.json) يعرض المسارات الفعلية؛schemas الكاملة للـbodies/responses وتوليد client types مازالت IN_PROGRESS فيP01-05.

## التنفيذ المحلي الحالي للعقود — 2026-11-07

مصدر العقود المشتركة: [commands.ts](../../packages/contracts/src/commands.ts)، والتوثيق الآلي: [openapi.ts](../../apps/api/src/openapi.ts). Enrollment وaward وrequest decision وredemption start/holder decision/complete وdraft create/update/activate وpreferences لها request/response schemas من نفس المصدر المستخدم للتحقق. schema بيانات تفعيل التاجر الكاملة موجودة في components. بقية المسارات لها inventory وpath/auth/error metadata؛الـresponse DTO غير المحدد معلّم صراحة ولا يُقدَّم كعقد صارم مكتمل.

التوليد documentation-only، فلا يغيّر AJV قيمة quantity أويسقط خصائص الطلب قبل تحقق Zod. الكميات number integer فعلية، وليست string أوfraction. التغييرات تتطلب مراجعة الطلب والنتيجة معًا وإعادة openapi:export وtests؛عقود النتائج الأساسية تُفحص على ردود API فعلية في integration tests.

كل خطأ تحقق يعيد error.code وrequestId وretryable وfields[{path,code}] دون قيم المستخدم. الواجهة تحفظ الحقول، تعرض أسماء مفهومة، وتضع aria-invalid/aria-describedby وتنتقل لخطوة تجهيز التاجر المناسبة. Cookie authentication وOrigin وCSRF وIdempotency-Key وIf-Match موصوفين حسب الأمر؛authorization الفعلي يظل بالخادم في كل request وإعادة محاولة.

نتيجة صرف المكافأة تشمل cycleNumber وbalanceAfter وaccountRevision. هذا إصدار دورة جديدة داخل نفس membershipId، وليس حذفًا أوإنشاء هوية عميل ثانية. my cards تضيف cycle_number وcycle_renewed_at وpending_rewards وdisplay_balance؛balance يظل projection المحاسبي، وdisplay_balance يظل threshold لو فيه مكافأة متاحة لم تُصرف بعد.
