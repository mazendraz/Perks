# Runbook

## التطبيق المتصل الحالي

ابدأ من جذر المشروع باستخدام Node 24 وnpm. PostgreSQL 17 binaries مطلوبة؛ المسار الافتراضي C:/Program Files/PostgreSQL/17/bin، أواضبط PG_BIN للمسار المثبت عندك. أداة db:up تتحقق من URL الخاصة بـNuqta وport 55432 واسم nuqta_local، ولا توقف أي cluster تانية.

```powershell
Set-Location -LiteralPath 'F:\Nuqta Demo Build Complete'
npm ci
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

افتح [التطبيق](http://127.0.0.1:5173). API على 4100، وقاعدة Nuqta على 55432. استخدم 127.0.0.1 بنفس الـorigin؛ فتح localhost بدلًا منه يؤدي لرفض الكتابة بحماية Origin. في terminal منفصلة:

```powershell
npm run worker:dev
```

ملف .env بيتولد محليًا بقيم عشوائية من db:up، وممنوع تتبعه أونشره. بيانات seed صناعية، وممنوعة في staging/production. إعادة seed مش reset؛ مابتصفّرش رصيد ولا توسّع فروع برنامج منشور.

### حسابات التطوير

الدخول بالإيميل والباسورد لكل الأدوار. بيانات الدخول الأولية لحسابات seed في .local/seed-logins.txt،ولمازن في .local/manual-demo/login.txt. الملفات خاصة وغير متتبعة،والباسورد لا يُطبع في logs. العملاء الجدد يختارون كلمات مرورهم من Create account؛حسابات الموظفين الجديدة ينشئها المسؤول بإيميل وباسورد ودور وفروع. الحسابات الموجودة مسبقًا تستخدم الدعوات دون تغيير باسوردها.

نسيت كلمة المرور ترسل رابطًا أحادي الاستخدام لمدة 30 دقيقة في البريد المحلي. تغيير/استعادة الباسورد يرفع credential version ويلغي الجلسات القديمة؛تغيير الباسورد من الحساب يتحقق من الحالي وCSRF ويصدر جلسة جديدة. Login له حد IP وقفل مؤقت لكل بريد بعد 5 محاولات خاطئة. scrypt مُملح مع pepper،ولا صلاحية لـruntime لقراءة password_hash من جدول الحسابات. hashes التجهيز المؤقتة مقيدة بالمسؤول صاحب المسودة وتُحذف عند التفعيل. راجع [تغيير الدخول والواجهة](PASSWORD-AND-DESIGN.md).

أوامر TOTP القديمة ليست مطلوبة للتجربة الحالية. endpoints البريد OTP متاحة فقط لاختبارات التراجع القديمة في APP_ENV=test ولحسابات بلا password؛تُرفض في بيئة التطوير وكلمة المرور لا يُمكن تجاوزها بها. بيئة الإنتاج ما زالت ترفض local auth؛يلزم adapter ودورة email recovery خارجية قبل النشر.

### الاختبارات والأدلة

```powershell
npm run verify:local
```

الأمر جامع typecheck/lint/unit/build/integration/Edge E2E/restore/plan. لازم Web/API/DB يكونوا شغالين، ويلزم Microsoft Edge. الأدلة في [IMPLEMENTATION](IMPLEMENTATION.md) و[checks.json](evidence/implementation/checks.json). اختبارات المتصفح تستخدم contexts منفصلة وتضيف تجار QA بأسماء Browser Cafe؛ مفيش كاميرا أوNFC أوWallet أومزوّد خارجي بيتجرب فعليًا.

Integration tests تعمل DB جديدة nuqta_test_... وتطبق كل migrations، ثم تحذف DB الخاصة بنفس التشغيل فقط. test:restore يستخدم snapshot لـnuqta_local ويستعيدها في nuqta_restore_... جديدة، ويقارن counts/digests والـLedger ثم يحذف نسخة الفحص فقط. الـbackup نفسها بتفضل داخل .local/backups. ده فحص logical backup، مش PITR.

لنسخة احتياطية محلية مستقلة: `npm run db:backup`. للإيقاف: Ctrl+C للـAPI/Vite وWorker، ثم `npm run db:down`؛ البيانات لا تُحذف. لاستئناف جلسة توقفت: db:up ثم db:migrate ثم dev وworker:dev؛ مش ضروري seed تاني.

### تشخيص سريع

- ECONNREFUSED على 55432: شغّل db:up؛ ماتوقفش خدمات PostgreSQL الأخرى.
- ready 503: افحص migrations والـruntime role؛ ما تستخدمش migrator في DATABASE_URL.
- pending/unknown في عملية مالية: افتح نفس الحساب ونفس التبويب واسترجع نتيجة المحاولة؛ ماتغيرش رقم الإيصال لتجاوز الحالة.
- Job blocked/unknown: شوف السبب في Platform operations؛ مفيش إعادة عمياء لرسالة مدفوعة. domain_event نجاحه إقرار معالجة داخلية فقط، مش دليل إرسال Wallet أوبريد.
- CSV 403/404 بعد تجهيزه: راجع صلاحية المالك/الفروع وانتهاء صلاحية الملف. التحميل يراجع الصلاحية الحالية.
- Auth staging/production: local provider مرفوض. managed login/MFA/recovery والـcloud storage لسه بوابات غير مكتملة؛ النسخة الحالية غير مؤهلة لإطلاق خارجي.

## تشغيل الـDemo الأصلي — مرجع P00

server اللي كان اتفتح في جلسة المراجعة الأصلية PID بتاعها25644. لإيقافها من PowerShell تانية،الكود ده يتأكد من هوية الـprocess قبل الإيقاف،علشان PID ممكن تتغير بعد إعادة التشغيل:

```powershell
$nuqtaDemoProcess = Get-CimInstance Win32_Process -Filter 'ProcessId=25644'
if ($nuqtaDemoProcess -and $nuqtaDemoProcess.CommandLine -like '*F:\Nuqta Demo Build Complete\tools\serve-demo.cjs*') {
    Stop-Process -Id $nuqtaDemoProcess.ProcessId
}
```

من PowerShell:

```powershell
Set-Location -LiteralPath 'F:\Nuqta Demo Build Complete'
node --version
node tools/serve-demo.cjs
```

افتح [Demo Launcher](http://127.0.0.1:4173/). السيرفر مربوط بـ`127.0.0.1` بس،وبيقدّم الست ملفات الأصلية. بيقبل GET/HEAD فقط ومابيقدّمش محتويات مجلدات أو env. للإيقاف اضغط `Ctrl+C` فينفس terminal.

لو port مش فاضية:

```powershell
$env:DEMO_PORT = '4183'
node tools/serve-demo.cjs
```

افتح port الجديدة. لإزالة override من جلسة PowerShell: `Remove-Item Env:DEMO_PORT`. كل tabs لازم نفس hostname و port و browser profile؛`localhost` و`127.0.0.1` مخازن منفصلة. تشغيل HTTP هو المسار المجرّب. أسماء`.dc.html` في server مجرد aliases إضافية؛launcher بيستخدم أسماء HTML الأصلية.

الـDemo الأصلي وحده لايحتاجnpm أوDB أو.env. التطبيق الجديد لهdependencies وDB وأوامر مستقلة موضحة بالأعلى. `DEMO_PORT` تخص أداةالتشغيل المضافة فقط. البيانات تجريبية بالكامل و OTP ثابت و personas متاحة. زر reset في launcher بيمسح state التجريبية فيكل tabs على نفس origin؛خدبالكمنأي Demo عايز تحافظ عليها.

## إعادة الفحص

```powershell
node tools/audit/extract-demo.cjs
node --check tools/serve-demo.cjs
node --check tools/audit/extract-demo.cjs
node --check tools/audit/browser-smoke.cjs
node --check tools/audit/browser-journeys.cjs
node --check tools/audit/verify-plan.cjs
```

Browser runners تحتاج Playwright و Microsoft Edge. أدواتP00 استخدمتruntime الجهاز. دلوقتيPlaywright مثبتة كـdev dependency فيpackage-lock؛الفحص الجديد هوnpm run test:e2e. الأوامر التالية مرجع لتكرار فحصexports:

```powershell
$env:NUQTA_AUDIT_NODE_MODULES = 'C:\Users\CM\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'
node tools/audit/browser-smoke.cjs
node tools/audit/browser-journeys.cjs
node tools/audit/verify-plan.cjs
```

المسار ده يتعدللو runtime اتنقلت. كل runner بتشغّل server داخلها،وبتقفل server و browser في النهاية،وبتستخدم profile مؤقتة منفصلة عن profile المستخدم. ports الافتراضية 4174/4175 لازم تكون فاضية؛`DEMO_PORT` لومتضبطة لهاالأولوية. ماتشغّلش runner ين على نفس port.

لو Playwright مش موجودة على جهاز تاني،يتوثق نقص أداة الفحص؛ده مش فشل للـDemo. Playwright اتثبتت بالفعل معlockfile فيالتنفيذ الحالي. ممكن فحص يدوي مع ذكر حدود التغطية،من غير ادعاء نجاح اختبارات مااتنفذتش.

المخرجات بتتكتب فوق evidence اللي بنفس الاسم؛احفظتقرير release مهمفي revision directory قبل إعادة التشغيل. التقرير الحالي النهائي هو`browser-journeys.json`؛initial تقرير harness أقدم بأخطاء selectors اتصلحت. `REPRODUCED` معناها خلل أعيد إنتاجه،مش متطلب إنتاج ناجح. شغّل`verify-plan.cjs` في الآخر علشان يحدّث`evidence/verification.json` ويتأكد من الروابط و IDs و hashes الأصول.

## تشخيص أعطال محلية

| العرض | العمل |
|---|---|
| EADDRINUSE | اختار port تانية أووقّفال server اللي إنت شغّلته؛لاتقتل process مجهولة |
|404 بعدضغط | راجع وجود الأسماء الست والـbase URL؛الروابط relative |
|Unpacking/Rendering معلّق | راجع console و manifest و DecompressionStream support والـoriginal hash؛جرّب Edge حديث |
|query ID غلط وواجهة فاضية | ارجعلـlauncher default؛ده نقص validation/error boundary موثق؛ماتمسحش بيانات من غير سبب |
|tabs مابتتزامنش | راجع hostname/port/profile و storage permissions؛الـsync الحالية مش cross-device |
|Wallet/charge/OTP تظهر success | دي محاكاة؛مفيش signing أو payment أو email delivery فعلي |
|Edge داخل sandbox لا يبدأ | الفحص نجح بتشغيل server+Edge معًاخارج sandbox بعد إذن الأداة؛بـprofile مؤقتة |
|browser خارجهلايصل server داخله | استخدم runner بتشغّل الاتنين في نفس السياق؛ده قيد بيئة فحص |

## أوامر SaaS المتاحة الآن

الأوامر دي متنفذة للتطبيق الجديد،من جذرالمجلد. راجعالتشغيل السريع بالأعلى قبلها:

```powershell
npm ci
npm run env:check
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
npm run worker:dev
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run test:e2e
npm run build
```

التشغيل المحلي يستخدمPostgreSQL17 native مستقلة على55432؛Docker مش مطلوب. `.env.example` أسماءو placeholders فقط؛الأسرار في secret manager أو local env غيرمتتبعة. migrator role منفصلة عن runtime. production seed ممنوعة. Dev/Staging/Production لها DB و buckets و Auth و credentials منفصلين؛production يرفض demo flags.

إيقاف الخدمات: وقف requests و worker claims الجديدة؛اسمحللـin-flight transaction تكملأوتنتهي lease؛ثماوقف processes. `db:down` مايمسحش volumes افتراضيًا؛أي حذف بيانات يتراجع حسب نطاقه وموافقاته.

## استجابة الأعطال بعد التنفيذ

| الحالة | الإجراء |
|---|---|
|balance غير مطابق | امسك operation/purchase/member refs؛pause writes المتأثرة؛قارن projection بالـledger فيفحصمعزول؛لا direct UPDATE لإخفاء الفرق؛correction review |
|رد award ضاع | lookup operation/key بعد Auth؛committed ترجع stored result؛unknown تعيد نفس key؛لا رقم إيصال جديد |
|outbox lag | راجع worker leases و DB locks و 429؛throttle/backoff؛retry لنفس intent مع tenant context |
|Wallet outage/cert | عطّل issuance غير الجاهزة؛web current؛rotation من secret path معتمدة؛reconcile revisions ثم retry |
|paid delivery unknown | hold intent وحجزالتكلفة؛provider lookup/reconciliation أومراجعة؛لا blind resend |
|payment events ترتيبها خطأ | احفظ inbox؛تحقق signature؛راجع provider state؛لا paid من redirect أو مجرد email |
|tenant access incident | وقف route/grants المتأثرة؛احفظ traces؛rotate المفاتيح لو اتكشفت؛راجع query/cache/files/jobs؛incident owner يتابع |
|restore مطلوب | DB معزولة و provider dispatch متوقفة؛تحقق ledger/grants/purchases و RPO gap؛صالح external state قبل cutover |
|export requester اتوقف | امنع download signing؛ارفض الهوية القديمة؛expire/revoke URL حسب storage؛audit |

تنبيهات مبدئية:API5xx>1% لخمسدقائق،تجاوز p95 target لعشردقائق،outbox oldest>60s بصورةمستمرة،dead-letter jobs أو unknown paid outcome>0،شهادةمتبقي لها<30days،أو backup أقدم من السياسة. الحدود تتراجع في P13 بالقياس؛كل alert له owner و runbook link. logs فيها IDs فقط من غير tokens أو PII كاملة.

Deploy: backup/readiness →expand migration→compatible artifact→scoped health/E2E smoke→توسع cohort تدريجي. التراجع غالبًا previous compatible artifact أو feature flag. لا schema DROP أو استرجاع DB قديمة فوق live loyalty من غير خطة حقوق ومصالحة. restore drill شهري مقترح وقبل تغيير مزود backup؛القياس يتسجل في STATUS بعد التنفيذ.


## سياسة الملفات والتعافي المحلي الحالية

روابط CSV تنتهي بعد ساعة. worker يمسح الملف الفعلي بعد مرور ساعتين على آخر كتابة لو انتهى/اتلغى أوأصبح يتيمًا؛ sweep كل دقيقة، بحد أقصى 200 ملف و2000 عنصر directory لكل جولة، وcursor يستكمل الجولة التالية. الملفات ذات reference جاهز صالح أوlease حي محفوظة. الحذف لملفات CSV بأسماء UUID تحت .local/exports فقط، بدون recursive delete، وتحت نفس advisory lock لنشر الملف. المجلدات والروابط الرمزية لا تُحذف. يلزم worker شغالة؛ التخزين السحابي له lifecycle منفصل عند إعداده.

طلب كاشير نتيجته مبهمة: تحقق من نفس القرار؛ لو unknown افتح المحاولة المحفوظة وأعد إدخال كود العميل. نفس المفتاح والإيصال والكمية والفرع وتاريخ الشراء، من غير إنشاء محاولة بديلة عشوائية. قرار قديم اتخزن قبل ترقية recovery ومفيهوش command body يحتاج تتبع مرجعه؛ لا يمكن تخمين بياناته.

مسودة المنصة تستعيد المدخلات والخطوة بعد reload/إعادة الدخول لنفس الحساب في نفس tab. إنشاء وتفعيل مبهمان يعيدان نفس payload/key؛ تحديث له revision مختلف وبيانات مطابقة يعتبر ردًا ضائعًا، أما البيانات المختلفة فتظهر للمراجعة قبل الحفظ. انتهاء MFA يفتح إعادة تحقق ويحافظ على المدخلات.

صرف المكافأة يجدد دورة الكارت مرة واحدة في نفس transaction. لا reset للـLedger أوالعضوية: threshold يُستهلك عند اكتساب reward grant، والرصيد الفائض ينتقل للكارت التالي. لو توجد مكافآت أخرى غير مصروفة، تظل ظاهرة وقابلة للصرف حسب شروطها.

## تجهيز المحل ومتابعته

راجع [ONBOARDING-AND-SUPPORT](ONBOARDING-AND-SUPPORT.md) للوجو والقوالب الـ15 وHEX،إنشاء الحسابات بدل الدعوات المعلقة،QR PNG/SVG،ملف المحل والدعم،واللغة حسب الجهاز. عند تحديث تجربة مازن:نفّذ demo:setup للترقية دون reset،ثم أعد تشغيل demo:start بعد build. لا تعدّل migrations مطبقة.

تخصيص الأختام من الهوية:عدد 2–50،شكل ورمز وعرض ممتلئ/محدد. العدد الجديد يُنشر كنسخة برنامج للتسجيلات الجديدة؛الشكل ينشر من Branding ولا يغيّر الأرصدة. تفاصيل التشغيل والاختبارات في [STAMP-DESIGN](STAMP-DESIGN.md). ترقية 009m additive ولا تتطلب إعادة seed أوreset.

## معاينة المحل وكلمات المرور وواتساب

راجع [ACCOUNT-PREVIEW-AND-CONTACT](ACCOUNT-PREVIEW-AND-CONTACT.md). طبّق db:migrate في التطوير،وdemo:setup لترقية بيئة مازن مع الحفاظ على البيانات،ثم أعد تشغيل demo:start بعد build. 009n تضيف أعمدة ودوال محكومة ولا تتطلب reset. لا تعيد كتابة migration مطبقة. واتساب هنا Click to Chat يدوي؛لا توجد مفاتيح مزود أو إرسال آلي أو ادعاء تسليم. لا تغيّر كلمات مرور المستخدم الحقيقي من أجل اختبار؛استخدم شركات QA المعزولة.
## البريد الدائم وSMTP — L02

المسار الحالي ذاتي الاستضافة حسب [LAUNCH-PLAN](../../LAUNCH-PLAN.md) وD31–D35؛الملاحظات القديمة عن managed Auth وcloud buckets أدناه تاريخية. `npm run dev` يشغّل API وWorker والويب؛`demo:start` يشغّل الثلاثة على4180. استرجاع الباسورد يكتب التوكن كبصمة وطلب البريد مشفرًا في نفس transaction؛إغلاق API لا يفقد الطلب. كل تعديل لباسورد قائم،بما فيه تعديل الإدارة،يضيف إشعارًا دون الباسورد. Worker يراجع صلاحية رابط الدعوة أوالاسترجاع قبل التسليم.

| المتغير | الاستخدام |
|---|---|
| MAIL_TRANSPORT=file | dev/test فقط؛صندوق محلي خاص،مش تسليم بريد خارجي |
| MAIL_FILE_ROOT | افتراضي `.local/mail`؛الـAPI يعرض الأحدث في local/mail فقط عند local Auth +dev/test +file ومن loopback |
| MAIL_TRANSPORT=smtp | مطلوب staging/production |
| SMTP_HOST / SMTP_PORT | مزود SMTP الذي يختاره المالك |
| SMTP_USER / SMTP_PASS / SMTP_FROM | مطلوبة؛FROM عنوان بريد واحد؛لا تُكتب القيم في Git أوالأدلة |
| SMTP_SECURE | true للـTLS المباشر؛465 يُعامل TLS تلقائيًا |
| SMTP_STARTTLS | true؛TLS إجباري في الإنتاج،والشهادات متحققة دائمًا |
| SMTP_CA_FILE | اختياري لشهادة CA خاصة بسيرفر SMTP بتاعنا،مش private key |

إعدادات الإنتاج تُفحص بـ`npm run env:check` دون طباعة الأسرار. لا تُشغّل إرسالًا حقيقيًا قبل اختيار واعتماد المالك. مزود SMTP والدومين وSPF وDKIM وDMARC **BLOCKED_OWNER** حاليًا؛المالك أكد إن مفيش اختيارات بعد. بعد الاختيار يُراجع إعداد DNS الفعلي مع المزود،ثم يُسمح برسالة اختبار حقيقية منفصلة؛مش هنسمي التسليم الخارجي ناجحًا قبلها. مرجع TLS وإعداد transport هو [توثيق Nodemailer الرسمي](https://nodemailer.com/smtp).

SMTP له Message-ID ثابت وإيصال إرسال دائم لكل outbox ID. `sent` يمنع إرسال نفس الرسالة مجددًا؛`unknown` يوقف الإعادة التلقائية إذا انقطع رد قبول الرسالة أوفشل تثبيت النتيجة في DB بعد قبول SMTP. راجع مزود البريد/السجل قبل أي قرار؛لا تغير نفس idempotency key ولا تُحوّل unknown إلىنجاح من غير دليل. طلب استرجاع جديد من المستخدم intent جديد. أخطاء الاتصال المؤكدة قبل التسليم قابلة لإعادة المحاولة؛الرفض الدائم blocked. القوالب text/HTML بالعربي والإنجليزي،ولا يظهر توكن في subject أوlogs.

فحص محلي بلا إرسال حقيقي:`npm run test:integration -- mail.test.ts` يستخدم SMTP وهميًا على127.0.0.1 مع TLS وشهادة مولدة في الذاكرة،ويختبر restart وreset وnotification وdedupe وunknown وعزل أدوار DB. الفحص الجامع `verify:local` يشغّل كل integration tests،مش الملف المختار فقط.
