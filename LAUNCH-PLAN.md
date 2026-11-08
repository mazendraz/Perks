# Nuqta — خطة الإطلاق للبناء (Launch Plan)

**تاريخ: 2026-11-08 — Africa/Cairo. المالك: مازن. المنفّذ: Codex.**

الملف ده هو المرجع الوحيد لتحويل Nuqta من نسخة شغالة على جهاز التطوير لنسخة تتنشر على سيرفر بتاعنا وتتباع للمحلات. المراحل هنا اسمها `L00`–`L10` عشان متتلخبطش مع `P00`–`P15` في `docs/execution/`. كل مرحلة ليها مهام بـIDs ثابتة ومعايير قبول قابلة للفحص.

---

## 0. اقرأ ده الأول (قواعد التنفيذ)

1. قبل أي كتابة اقرأ: `docs/execution/STATUS.md` ثم `DECISIONS.md` ثم `IMPLEMENTATION.md` ثم الملف ده.
2. **متعدّلش** أي حاجة في `standalone/` ولا في `docs/execution/evidence/` (دي أدلة مش سورس).
3. **متضعّفش أي حماية موجودة**: RLS، فصل أدوار الـDB (runtime/auth/worker/migrator)، CSRF، Origin check، `SameSite=strict`، httpOnly cookies، idempotency، الـLedger الـappend-only، فحص `/health/ready` للـDB role. أي تغيير يلمس الحاجات دي لازم يضيف اختبار سلبي يثبت إنها لسه شغالة.
4. اشتغل مرحلة مرحلة بالترتيب. متبدأش مرحلة قبل ما معايير قبول اللي قبلها تتحقق، إلا لو المرحلة مكتوب إنها مستقلة.
5. في آخر كل مرحلة لازم:
   - `npm run typecheck && npm run lint && npm test && npm run test:integration && npm run build` كلهم يعدّوا.
   - `npm run verify:local` يعدّي، و`checks.json` يتحدث.
   - تحدّث `docs/execution/STATUS.md` و`IMPLEMENTATION-LOG.md`، وتعلّم مهام المرحلة في الجدول تحت بـ`DONE` ومعاها الدليل (اسم الاختبار أو الأمر).
   - commit واحد على الأقل باسم المرحلة، مثلًا `L03: storage adapter`.
6. `DONE` معناها فيه دليل قابل للإعادة. لو حاجة محتاجة حساب أو هاردوير أو قرار من المالك، علّمها `BLOCKED_OWNER` واكتب المطلوب بالظبط، وكمّل الشغل المستقل.
7. أي نص يظهر للمستخدم يبقى بالعربي (مصري بسيط وواضح) والإنجليزي، زي باقي الواجهة. ومفيش نصوص عربي فصحى رسمية من غير سبب.
8. ممنوع إنشاء حسابات أو شراء أو إرسال إيميلات حقيقية أو نشر على سيرفر من غير موافقة صريحة من المالك.

---

## 1. القرارات المقفولة (جديدة — تُضاف لـDECISIONS.md كـD29–D36)

| ID | القرار | الأثر على الكود |
|---|---|---|
| D29 | **مفيش SMS خالص.** لا OTP بالـSMS، ولا رسايل تسويق بالـSMS، ولا أي مزود SMS. | امسح أو أغلق أي مهمة SMS في P11. مفيش dependency لمزود SMS. |
| D30 | **العميل المستهدف معاه سمارت فون.** العميل اللي معاهوش سمارت فون مش ضمن النطاق: مفيش كارت مطبوع ثابت للعميل، ولا بحث بالرقم عند الكاشير كبديل للـQR، ولا صرف مكافأة من غير تأكيد من موبايل العميل. | تأكيد الصرف من موبايل العميل (D12) يفضل إجباري. ودعم "المتصفحات القديمة" معناه سمارت فونز قديمة، مش موبايلات عادية. |
| D31 | **قاعدة البيانات عندنا.** PostgreSQL 17 مثبتة ومُدارة مننا على سيرفر بنتحكم فيه (VPS أو سيرفر فعلي)، ومش متاحة على الإنترنت. **ممنوع** Supabase أو Neon أو RDS أو أي managed DB. | اسكربتات إعداد وroles وbackup/restore بتاعتنا (L05). |
| D32 | **تسجيل الدخول بتاعنا.** الدخول بالإيميل والباسورد الموجود في `password-auth.ts` هو مسار الـproduction. Supabase Auth يتشال كمرشح. | `AUTH_PROVIDER` يبقى `password` في production (L01). |
| D33 | **الملفات عندنا.** اللوجوهات والصور وملفات التصدير بتتخزن على ديسك السيرفر بتاعنا، في مسار خارج فولدر الكود، ووراها `FileStore` adapter. | L03. وأي نقل لـobject storage بعدين يبقى adapter جديد، مش تعديل في الـmodules. |
| D34 | **الإيميل عن طريق SMTP عادي.** adapter واحد provider-agnostic. المالك يختار المزود بعدين (أو mail server بتاعنا). | L02. |
| D35 | **التحصيل يدوي** في أول إطلاق (InstaPay / فودافون كاش / تحويل)، والاشتراكات والـentitlements يضبطها admin. مفيش بوابة دفع. | مفيش شغل P12 أونلاين في الخطة دي. |
| D36 | **Apple/Google Wallet بعد أول Pilot**، مش شرط للإطلاق. | L10، ووراه feature flag. |

**خارج النطاق تمامًا:** SMS، عملاء من غير سمارت فون، NFC، حملات تسويق وإرسال جماعي، بوابة دفع أونلاين، managed DB/Auth.

---

## 2. شكل الـproduction المستهدف

```
                Internet (443 فقط)
                       │
                 ┌─────▼─────┐
                 │   Caddy   │  HTTPS تلقائي (Let's Encrypt)، HSTS، gzip
                 └─────┬─────┘
          ┌────────────┼──────────────┐
   static web (dist)   │ /api, /health │
                 ┌─────▼─────┐   ┌────▼─────┐
                 │  API      │   │ Worker   │   Node 24
                 └─────┬─────┘   └────┬─────┘
                       │  شبكة داخلية فقط │
                 ┌─────▼─────────────────▼┐
                 │ PostgreSQL 17 (عندنا) │  مش مكشوفة برّه
                 └─────┬──────────────────┘
                       │ WAL archive + base backups (pgBackRest، مشفّرة)
                 ┌─────▼──────────────┐
                 │ نسخة احتياطية تانية │  مكان يحدده المالك (L05-05)
                 └────────────────────┘
   FileStore: /var/lib/nuqta/files  (volume ليه backup)
```

- **التشغيل:** Docker Compose على سيرفر Ubuntu 24.04 LTS، فيه الخدمات `caddy` و`api` و`worker` و`postgres` و`migrate` (one-shot).
- **الشبكة:** البورتات المفتوحة 80 و443 بس (و22 للـSSH بمفتاح). Postgres على شبكة Docker داخلية من غير `ports:`.
- **السيرفر:** يا إما VPS بنتحكم فيه بالكامل، يا إما سيرفر فعلي عندنا. نفس الـcompose بيشتغل على الاتنين. القرار عند المالك (L04-01).

---

## 3. المراحل

### L00 — نقطة البداية والحماية

**الهدف:** أساس نظيف نقدر نرجعله.

| ID | المهمة | معيار القبول |
|---|---|---|
| L00-01 | `git init`، والتأكد إن `.gitignore` بيستبعد `.env` و`.local/` و`dist/` و`node_modules/`. بعدين commit أساسي. | `git status` نضيف، و`git ls-files` مفيهوش `.env` ولا أي حاجة من `.local/`. |
| L00-02 | تشغيل `npm run verify:local` على الحالة الحالية وحفظ النتيجة كـbaseline. | `checks.json` حالته `passed`. |
| L00-03 | إضافة D29–D36 لـ`DECISIONS.md`، وتعليم مهام P11 الخاصة بالـSMS والقنوات المدفوعة `OUT_OF_SCOPE` بالإشارة لـD29. | الملفات اتحدثت والـlinks سليمة (`npm run verify:plan`). |
| L00-04 | الـCI (`.github/workflows/checks.yml`) يشغّل كمان `npm run test:e2e` بـPlaywright chromium. | الـworkflow بيعدّي على branch تجريبي، أو موثّق لو مفيش remote. |

### L01 — تسجيل الدخول في production

**الهدف:** الدخول بالإيميل والباسورد يشتغل بأمان على السيرفر الحقيقي.

**الوضع الحالي:** `password-auth.ts` فيه `local()` اللي بيرجّع 503 لو `APP_ENV` مش `development` أو `test`. و`config.ts` بيمنع `AUTH_PROVIDER=local` في production، ومحتاج loopback.

| ID | المهمة | معيار القبول |
|---|---|---|
| L01-01 | ضيف `AUTH_PROVIDER='password'` في `config.ts`. القيمة دي مسموحة في staging/production بالشروط: `COOKIE_SECURE=true`، و`PUBLIC_APP_ORIGIN` يبدأ بـ`https://`، و`AUTH_PEPPER` طوله ≥ 32، وأدوار الـDB منفصلة (الشرط الموجود). أما `local` فيفضل للتطوير والاختبار بس، ومربوط بالـloopback زي ما هو. | unit test: `password` في production من غير HTTPS → يرمي error. وفي production بـHTTPS → يشتغل. و`local` في production → يرمي error زي دلوقتي. |
| L01-02 | `local()` في `password-auth.ts` يتغير لـ`passwordEnabled()`، ويسمح لما `AUTH_PROVIDER` يكون `local` (dev/test) أو `password` (أي بيئة). مسارات `/api/v1/local/mail` وأي mail sink تفضل dev/test + local بس. | integration test بـ`APP_ENV=production` + `AUTH_PROVIDER=password` + `COOKIE_SECURE=true`: login وregister وchange وreset شغالين، و`/api/v1/local/mail` بيرجع 404. |
| L01-03 | شيل مسار Supabase (`AUTH_JWKS_URL` و`createRemoteJWKSet` وexchange endpoint) أو اقفله ورا flag مش متفعّل. حدّث `.env.example`. | مفيش كود يستدعي JWKS خارجي في production. و`jose` يتشال لو مبقاش مستخدم. |
| L01-04 | **إصلاح قفل الحسابات:** دلوقتي 5 محاولات غلط على أي إيميل بتقفله 15 دقيقة لأي حد، يعني أي حد يقدر يقفل حساب كاشير. البديل: (أ) عدّاد لكل `(email, ip)` بيقفل بعد 5، (ب) عدّاد لكل `email` بيقفل بعد 20 محاولة من IPs مختلفة، (ج) تأخير متدرج بدل القفل الكامل. ده محتاج migration جديدة. | integration test: 10 محاولات غلط من IP "مهاجم" مش بتمنع نفس المستخدم يدخل من IP تاني بالباسورد الصح. وbrute force من IP واحد يتوقف بعد 5. |
| L01-05 | **MFA إجباري لحسابات المنصة** (`platform_admin` و`platform_support`) عن طريق TOTP. الكود موجود (`totp` في `crypto.js` و`tools/local-admin-mfa.ts`)، فالمطلوب نرجّعه للمنصة بس. التاجر والكاشير والعميل يفضلوا بالباسورد بس (قرار المالك). | admin من غير MFA مش قادر يفتح أي endpoint في `/api/v1/platform/*`. فيه شاشة لإعداد TOTP بـQR وأكواد استرجاع (10 أكواد بتستخدم مرة واحدة). |
| L01-06 | سياسة الجلسات: مدة الجلسة محددة لكل دور (المنصة 12 ساعة، والمالك والكاشير 7 أيام، والعميل 30 يوم مع تجديد عند الاستخدام). وتغيير الباسورد يلغي كل الجلسات (موجود، اتأكد منه). | integration tests للانتهاء والتجديد. |
| L01-07 | سياسة الباسورد: 10 حروف على الأقل، وفحص ضد قائمة أشهر 10,000 باسورد (ملف محلي، من غير API خارجي). | unit test. ورسالة الخطأ بالعربي والإنجليزي. |

### L02 — الإيميل عن طريق SMTP

**الهدف:** الدعوات واسترجاع الباسورد بيوصلوا فعلًا.

| ID | المهمة | معيار القبول |
|---|---|---|
| L02-01 | `apps/api/src/mail/` يبقى فيه interface `Mailer.send({to, subject, text, html, idempotencyKey})`، وimplementations: `FileSinkMailer` (السلوك الحالي في `.local/mail`، للتطوير والاختبار) و`SmtpMailer` (nodemailer). | الاختيار بمتغير `MAIL_TRANSPORT=file|smtp`. ولو `smtp` في production من غير `SMTP_HOST/PORT/USER/PASS/FROM` → config error. |
| L02-02 | نقل إرسال الدعوات في `apps/worker/src/runner.ts` (حالة `invitation_email`) و`resetMail` في `auth.ts` للـMailer. الـreset كمان يعدّي على الـoutbox والـworker بدل الذاكرة (`localMail` Map)، عشان ميضيعش لو الـAPI عمل restart. | الـworker مبقاش بيرجّع `EMAIL_PROVIDER_NOT_CONFIGURED` في production لما SMTP متظبط. والإرسال idempotent: نفس الـoutbox id ميتبعتش مرتين. |
| L02-03 | قوالب إيميل بسيطة (text + HTML inline CSS) بالعربي والإنجليزي، حسب لغة المستخدم: دعوة لمحل، واسترجاع باسورد، وتأكيد تغيير الباسورد. | snapshot tests للقوالب. ومفيش توكن في subject ولا في اللوجز. |
| L02-04 | الاختبار بـSMTP وهمي: `smtp-server` في الـintegration tests، أو Mailpit كـservice في compose التطوير. | test بيستقبل الإيميل ويفتح الرابط ويكمل الرحلة. |
| L02-05 | **BLOCKED_OWNER:** المالك يختار مزود SMTP ويظبط SPF وDKIM وDMARC للدومين. | موثّق في RUNBOOK. ومفيش إرسال حقيقي قبل الموافقة. |

### L03 — تخزين الملفات على سيرفرنا

**الهدف:** مفيش أي مسار `.local/...` في كود الـproduction.

**الأماكن الحالية:** `onboarding.ts` (draft-assets وassets)، و`provisioning.ts` (assets)، و`materials.ts` (assets)، و`customers.ts` (exports)، و`worker/runner.ts` (exports وmail)، و`worker/export-cleanup.ts`.

| ID | المهمة | معيار القبول |
|---|---|---|
| L03-01 | `packages/domain` أو `apps/api/src/storage/` يبقى فيه interface `FileStore { put(key, bytes, {contentType}), get(key), delete(key), exists(key) }`، و`LocalDiskStore(root)` بيكتب atomic (tmp ثم rename) بصلاحيات 0600 للملفات و0700 للفولدرات. الـkeys بتتحقق: من غير `..` ولا مسارات absolute، وبالـformat `{merchantId}/{uuid}.png` أو `exports/{merchantId}/{uuid}.csv`. | unit tests لرفض path traversal وللكتابة الـatomic. |
| L03-02 | `STORAGE_ROOT` في config: في التطوير الافتراضي `.local`، وفي production إجباري يكون absolute وبرّه فولدر الكود (مثلًا `/var/lib/nuqta/files`). | config test. |
| L03-03 | استبدال كل `readFile/writeFile/resolve('.local/...')` في الـmodules والـworker بالـFileStore. | `grep -rn "'.local" apps/` مبيرجعش حاجة غير FileSinkMailer وتعريف الـdefault. وكل الـintegration tests بتعدّي. |
| L03-04 | الـworker مبقاش بيرجّع `OBJECT_STORAGE_NOT_CONFIGURED` في production. والـcleanup الخاص بالـexports بيشتغل على الـFileStore. | integration test بـ`APP_ENV=production`. |
| L03-05 | فحص الصور المرفوعة: `sharp` يعيد encode لـPNG، ويشيل الـmetadata، ويحدد الأبعاد بحد أقصى 1024px والحجم بحد أقصى 2MB. | لو الكود مش بيعمل كده لحد دلوقتي، ضيفه، ومعاه test لملف SVG أو ملف خبيث بامتداد png. |

### L04 — التجهيز للنشر (Docker + Caddy + proxy)

| ID | المهمة | معيار القبول |
|---|---|---|
| L04-01 | **BLOCKED_OWNER:** VPS ولا سيرفر فعلي، والدومين. والمواصفة الدنيا: 2 vCPU و4GB RAM و80GB SSD وUbuntu 24.04. | القرار متسجل في DECISIONS. |
| L04-02 | `Dockerfile` multi-stage (Node 24 alpine أو slim): مرحلة build ثم runtime بـ`npm ci --omit=dev`، ويشتغل كـnon-root user. image واحدة للـapi والـworker، والفرق في الـcommand. | `docker build` بينجح، والـimage أقل من 300MB، و`docker run` بيعدّي `/health/live`. |
| L04-03 | `deploy/compose.yml`: الخدمات `postgres:17` (volume، ومن غير ports منشورة)، و`migrate` (one-shot بـ`DATABASE_MIGRATOR_URL`)، و`api`، و`worker`، و`caddy`. كل خدمة ليها healthcheck و`restart: unless-stopped`، والـapi والـworker بيستنوا `migrate` يخلص بنجاح. | `docker compose up` على جهاز نضيف بيطلّع النظام كامل، و`/health/ready` بيرجّع `ready`. |
| L04-04 | `deploy/Caddyfile`: HTTPS تلقائي، وHSTS، والـstatic (`apps/web/dist`) مع SPA fallback لـ`index.html`، و`/api/*` و`/health/*` بيروحوا للـapi، والـcache: `assets/*` immutable سنة و`index.html` no-cache. | فحص headers بـcurl. |
| L04-05 | **trustProxy:** متغير `TRUSTED_PROXIES` (CIDR list)، وFastify `trustProxy` بيتظبط عليه بس. وفي compose بيتحط على subnet شبكة Docker. | integration test: الطلب اللي بيوصل بـ`X-Forwarded-For` من proxy موثوق بياخد IP العميل، ومن مصدر مش موثوق الـheader بيتجاهل. والـrate limit بيتحسب لكل عميل لوحده. |
| L04-06 | اسكربت `deploy/init-secrets.sh` بيولّد `AUTH_PEPPER` وباسوردات أدوار الـDB الأربعة عشوائيًا في `deploy/.env.production` (chmod 600، وفي `.gitignore`). | مفيش أي secret في git. و`npm run env:check` بيتأكد من الـproduction env. |
| L04-07 | اسكربت إنشاء أدوار الـDB في production (`nuqta_migrator` و`nuqta_runtime` و`nuqta_auth` و`nuqta_worker`)، بنفس الصلاحيات اللي `tools/local-db.cjs` بيعملها، من غير superuser للتطبيق. | `/health/ready` بيرفض لو runtime role بقى superuser أو عنده bypassrls (الفحص موجود؛ اتأكد إنه شغال في compose). |
| L04-08 | `deploy/README.md`: خطوات من سيرفر فاضي لحد ما النظام يشتغل، وكمان التحديث (pull ثم build ثم migrate ثم restart) والرجوع لنسخة قديمة. | حد تاني يقدر يمشي على الخطوات من غير ما يسأل. |
| L04-09 | تأمين السيرفر (docs + اسكربت): ufw على 22 و80 و443 بس، وSSH بالمفاتيح بس، وfail2ban، وunattended-upgrades. | checklist في deploy/README. |

### L05 — قاعدة البيانات عندنا: باك أب واستعادة

**الهدف:** RPO ≤ 15 دقيقة وRTO ≤ 4 ساعات (D19) على Postgres بتاعنا.

| ID | المهمة | معيار القبول |
|---|---|---|
| L05-01 | إعدادات `postgresql.conf` للـproduction في `deploy/postgres/`: `wal_level=replica`، و`archive_mode=on`، و`archive_timeout=300`، ولوجز للـslow queries أكتر من 500ms، وmemory مناسبة لـ4GB. | الملف موجود ومتحمّل في compose. |
| L05-02 | pgBackRest (container أو داخل image postgres): full أسبوعي، وdiff يومي، وأرشفة WAL مستمرة. والـrepo **مشفّر** (`repo1-cipher-type=aes-256-cbc`). | `pgbackrest info` بيعرض backups. |
| L05-03 | اسكربت `deploy/restore-drill.sh`: يرجّع آخر backup في container منفصل، ويشغّل migrations check، ويقارن counts والـledger digests (زي `tools/test-restore.ts`). | التمرين بيعدّي، والنتيجة بتتسجل في `docs/execution/evidence/`. والمدة مكتوبة. |
| L05-04 | PITR: استعادة لنقطة زمنية محددة (قبل عملية مقصودة) ومراجعة إن الـLedger مظبوط. | موثّق بأوامر حقيقية في RUNBOOK ومجرّب مرة. |
| L05-05 | **BLOCKED_OWNER:** مكان النسخة التانية برّه السيرفر (سيرفر تاني بتاعنا أو ديسك خارجي أو أي storage). الـbackups مشفرة، فالداتا تفضل بتاعتنا حتى لو المكان عند حد تاني. | repo2 متظبط، وتمرين استعادة منه. |
| L05-06 | ملفات الـFileStore (`STORAGE_ROOT`) بتتعملها نسخة يومية (restic مشفر) لنفس المكان. | تمرين استعادة لوجو. |
| L05-07 | تنبيه لو آخر backup ناجح أقدم من 26 ساعة، أو آخر WAL مأرشف أقدم من 30 دقيقة (مربوط بـL07). | test يدوي موثّق. |

### L06 — الموبايل والمتصفحات القديمة

**الهدف:** أي سمارت فون معقول يفتح الموقع وينزّله على الشاشة الرئيسية. وده من غير ما نخدم موبايلات مش سمارت (D30).

| ID | المهمة | معيار القبول |
|---|---|---|
| L06-01 | `@vitejs/plugin-legacy` في `apps/web/vite.config.ts` بـtargets: `['iOS >= 13', 'Safari >= 13', 'Chrome >= 80', 'Android >= 8', 'Samsung >= 12']`. | الـbuild بيطلّع chunks legacy. |
| L06-02 | **الـCSP:** plugin-legacy بيحقن inline scripts، والـCSP الحالي `scriptSrc 'self'` هيمنعها. الحل: hashes ثابتة للـinline scripts في `helmet` (أو في Caddy لو هو اللي بيخدم index.html)، ومن غير `'unsafe-inline'`. | Playwright على WebKit وChromium: مفيش CSP violations في الـconsole. |
| L06-03 | `manifest.webmanifest` + أيقونات (192 و512 وmaskable 512 و`apple-touch-icon` 180)، و`theme_color` `#2B55CF`، و`display: standalone`، و`lang: ar`، و`dir: rtl`. والأيقونات تتولد من لوجو Nuqta (المالك يسلّمه، وإلا placeholder واضح). | Lighthouse "Installable" بيعدّي. |
| L06-04 | **Service worker:** للـshell بس (index وassets)، ومن غير cache لأي `/api/*`، ومع صفحة "مفيش نت" بسيطة. | تحديث الموقع بيوصل للمستخدم من غير ما يمسح الـcache يدوي (skipWaiting + رسالة "فيه تحديث"). |
| L06-05 | كاميرا الكاشير على iOS: `playsinline` و`muted` على الـvideo، وإيقاف الـstream لما الصفحة تتخفى (`visibilitychange`)، وطلب الكاميرا الخلفية (`facingMode: environment`). الإدخال اليدوي للكود موجود، خليه زي ما هو. | اختبار يدوي على أيفون وأندرويد (L08). |
| L06-06 | Safe areas (`env(safe-area-inset-*)`)، و`viewport-fit=cover`، وأهداف لمس 44px على الأقل، ومفيش scroll أفقي على 360px. | Playwright screenshots على iPhone SE وPixel 5 وGalaxy S8 (emulation) بالعربي والإنجليزي. |
| L06-07 | `test:e2e` يضيف projects موبايل في Playwright (WebKit iPhone 12 وChromium Pixel 5) لرحلتين: تسجيل العميل وعرض الكارت، والكاشير وهو بيدي ختم بالإدخال اليدوي. | بيعدّوا في CI. |
| L06-08 | شاشة "متصفحك قديم" لو `type="module"` و`nomodule` الاتنين فشلوا (أقل من iOS 13). جملة واحدة: "حدّث المتصفح أو افتح من Chrome". | مُختبرة بـUA مزيف. |

### L07 — مراقبة بالحد الأدنى (عندنا برضه)

| ID | المهمة | معيار القبول |
|---|---|---|
| L07-01 | لوجز JSON من الـapi والـworker على stdout، وDocker logging driver بـrotation (`max-size 20m` و`max-file 5`). | مفيش PII ولا توكنز (الـredaction موجود، ضيف test). |
| L07-02 | Uptime Kuma (self-hosted) كـservice إضافية في compose، بيراقب `/health/ready` والـcert expiry وعمر آخر backup. | فيه dashboard شغال. |
| L07-03 | تنبيهات على Telegram bot (مجاني) أو الإيميل: لو السيرفر وقع، أو أخطاء 5xx أكتر من 1% في 5 دقايق، أو الديسك فوق 80%، أو الـbackup قديم، أو jobs واقفة في الـoutbox أكتر من 15 دقيقة. | تنبيه تجريبي وصل فعلًا. |
| L07-04 | endpoint داخلي (من غير إتاحة عامة) للـmetrics الأساسية: عدد الطلبات، والأخطاء، ومدة الاستجابة p95، وطول الـoutbox. | Uptime Kuma أو اسكربت بيقرأه. |

### L08 — التجربة على الموبايل (قبل وبعد الـstaging)

| ID | المهمة | معيار القبول |
|---|---|---|
| L08-01 | `npm run dev:tunnel`: يشغّل `cloudflared tunnel --url http://127.0.0.1:5173` (quick tunnel، للتجربة بس وفيه بيانات تجريبية بس)، ويحط الرابط في `PUBLIC_APP_ORIGIN` ويعيد تشغيل الـapi. ولازم Vite `server.allowedHosts` يقبل الدومين. | المالك يفتح الرابط من موبايله ويعمل الرحلة كاملة. |
| L08-02 | staging على نفس السيرفر أو سيرفر تاني بـcompose منفصل وdomain فرعي (`staging.`)، وفيه بيانات صناعية بس. | شغال بـHTTPS. |
| L08-03 | checklist الأجهزة الحقيقية في `docs/execution/DEVICE-TEST.md`، والنتيجة لكل جهاز: أيفون حديث (Safari)، وأيفون قديم (iOS 15 أو 16)، وأندرويد حديث (Chrome)، وأندرويد قديم (8 أو 9)، وSamsung Internet. والرحلات: QR المحل → حساب → كارت؛ الكاشير يسكان ويدي ختم في ضوء ضعيف؛ رفض إذن الكاميرا → إدخال يدوي؛ قطع النت أثناء الختم ثم رجوعه → مفيش تكرار؛ صرف المكافأة بتأكيد العميل؛ Add to Home Screen؛ العربي والإنجليزي؛ الوضع الليلي. | كل الخانات متعلّمة، ولكل bug issue متسجل. |

### L09 — الورق وجاهزية الـPilot

| ID | المهمة | معيار القبول |
|---|---|---|
| L09-01 | صفحات `/privacy` و`/terms` بالعربي والإنجليزي، ومربوطة من التسجيل (موافقة الشروط متسجلة أصلًا في migration 009h). المحتوى مسودة من المالك، وعليه علامة "مراجعة قانونية مطلوبة" (قانون حماية البيانات المصري 151/2020). | الصفحات موجودة. **BLOCKED_OWNER** للمحتوى النهائي. |
| L09-02 | حذف حساب العميل من داخل التطبيق: يتعمل anonymize للـPII، والـLedger يفضل (الأرقام من غير هوية). | integration test. ومحتاجة migration. |
| L09-03 | سياسة الاحتفاظ: الـexports تتمسح بعد 24 ساعة (راجع اللي migration `009j_export_retention` بيطبقه دلوقتي وعدّله لو مختلف)، واللوجز 30 يوم، والجلسات المنتهية تتمسح بعد 90 يوم. | jobs في الـworker + tests. |
| L09-04 | `docs/execution/PILOT-RUNBOOK.md`: إزاي تجهّز محل في 15 دقيقة، وتطبع الـQR، وتدرّب الكاشير، وتراجع العمليات يوميًا، وتتعامل مع `needs_review`، ومين بيقرر في الحالات دي (**BLOCKED_OWNER**). | المالك يقرا الملف ويوافق. |
| L09-05 | اشتراك يدوي: شاشة admin لتسجيل الدفع (المبلغ، والطريقة: InstaPay أو كاش أو تحويل، والفترة) وتفعيل أو إيقاف المحل. الأسعار **BLOCKED_OWNER** (أسعار الديمو 450/950/1900 مش معتمدة). | المحل اللي اشتراكه منتهي: الكاشير مش قادر يدي أختام، والعميل لسه يقدر يشوف كارته ويصرف مكافأة مكتسبة (D10). |

### L10 — Apple Wallet وGoogle Wallet (بعد الـPilot)

متبدأش في المرحلة دي قبل ما L00–L09 يخلصوا ويبدأ Pilot حقيقي، إلا بطلب صريح من المالك.

| ID | المهمة | معيار القبول |
|---|---|---|
| L10-01 | **BLOCKED_OWNER:** حساب Apple Developer (99$ في السنة، والأفضل يكون باسم شركة)، وPass Type ID وشهادته، ومفتاح APNs. وحساب Google Pay & Wallet Console كـissuer وموافقة Google. | الشهادات في secrets بس، ومش في git. |
| L10-02 | `WalletProvider` adapter، وfeature flag لكل محل (`wallet_enabled`). | مقفول افتراضيًا. |
| L10-03 | Apple: إنشاء `.pkpass` (مكتبة `passkit-generator`) بلوجو المحل وألوانه وعدد الأختام. والـbarcode handle محدود حسب D12، يعني مش اعتماد للصرف. وApple Web Service endpoints حسب المواصفة: register وunregister و`passesUpdatedSince` و`latest pass` وlog، ومعاها push عن طريق APNs بعد كل ختم من الـoutbox. | الختم بيظهر في المحفظة خلال دقيقة على أيفون حقيقي. |
| L10-04 | Google: Loyalty class لكل برنامج، وobject لكل عضوية، وزرار "Save to Google Wallet" (JWT موقّع)، وتحديث الـobject من الـoutbox بعد كل ختم. | الختم بيظهر على أندرويد حقيقي. |
| L10-05 | أزرار "أضف للمحفظة" في كارت العميل حسب الجهاز، ولو المحفظة مش متاحة الكارت يفضل شغال من المتصفح. | E2E + اختبار يدوي. |
| L10-06 | سحب الـpass أو إلغاؤه لما الحساب يتمسح أو البرنامج يقف. | test. |

---

## 4. تعريف "جاهز للإطلاق" (Go / No-Go)

الإطلاق لأول محل مسموح لما **كل** ده يبقى صح:

- [ ] L00–L09 كلها `DONE`، ما عدا البنود `BLOCKED_OWNER` اللي المالك وافق عليها كتابةً.
- [ ] `npm run verify:local` + CI + `test:e2e` بمشاريع الموبايل كلهم بيعدّوا على نفس الـcommit اللي اتنشر.
- [ ] تمرين استعادة كامل (L05-03) وPITR (L05-04) اتعملوا على السيرفر الحقيقي خلال آخر 7 أيام.
- [ ] الـcheck list بتاع الأجهزة الحقيقية (L08-03) كامل، ومفيش bug مفتوح بدرجة "يمنع الاستخدام".
- [ ] حساب المنصة عليه TOTP، وكل الـsecrets اتولدت جديدة للـproduction.
- [ ] المراقبة والتنبيهات (L07) اتجربت بتنبيه حقيقي.
- [ ] صفحات الخصوصية والشروط موجودة، والمالك وافق على المحتوى.
- [ ] Postgres مش متاحة من الإنترنت (جرّب `psql` من برّه السيرفر، لازم يفشل).

## 5. قرارات مستنية من المالك (ملخص)

1. السيرفر: VPS ولا سيرفر فعلي عندنا، والدومين. (L04-01)
2. مزود SMTP أو mail server بتاعنا. (L02-05)
3. مكان النسخة الاحتياطية التانية. (L05-05)
4. أسعار الباقات. (L09-05)
5. مين بيراجع حالات `needs_review`. (L09-04)
6. محتوى الخصوصية والشروط ومراجعته القانونية. (L09-01)
7. أول 2–3 محلات Pilot.
8. حساب Apple وGoogle للـWallet، بعد الـPilot. (L10-01)
