# 2026-11-08 — إيميل وباسورد،وتصميم الواجهة والكروت

طلب المستخدم توحيد الدخول لكل الأدوار بالإيميل والباسورد دون OTP/TOTP،وتحسين الواجهة بالكامل. أُضيف password auth وتسجيل وتغيير واستعادة،بـscrypt وpepper وsalt وcredential version وإلغاء الجلسات القديمة. مفيش اختيار role من التسجيل. البيانات والأرصدة السابقة محفوظة.

تصميم جديد للدخول والتنقل والكروت وشاشات الإدارة والعميل والكاشير،بخط عربي محلي ورخصه،وتجاوب RTL/LTR. المستخدم رصد تداخل العين مع نص الباسورد؛اتصلح بعمود مستقل للزر،واختبار4 حالات لغة/عرض يؤكد عدم التداخل وحفظ القيمة عند الإظهار والإخفاء.

التفاصيل الحالية في PASSWORD-AND-DESIGN،والأدلة الحالية في checks.json وbrowser.json. الأرقام والسلوك في الأقسام التالية سجل تاريخي لدفعات سابقة،وليست متطلبات دخول النسخة الحالية.

---

# آخر دفعة محلية — دورة الكارت والتعافي والحركة

اتضافت migrations 009i و009j من غير تعديل migrations سابقة أوالـLedger. رقم دورة الكارت يزيد مرة واحدة عند صرف مكافأة مؤكد؛ العرض يظل كاملًا قبل الصرف، والأختام الزيادة والمكافآت الأخرى محفوظة. الحركة تشمل ختم بتأثير دخول ورسم علامة التأكيد، اكتمال مكافأة، وتجديد كارت، مع reduced-motion وRTL/LTR وتنبيهات screen reader.

اتقفل تسريب عضويات بين فروع نفس العميل، واتصلح سجل الموافقة عند الانضمام لبرنامج ثانٍ مع تصحيح تاريخي بحدث إضافي. Worker ينظف ملفات CSV بعد ساعتين بحدود عمل وقفل نشر مشترك، ويحمي الملفات الصالحة والكتابة الحالية.

قرارات الكاشير تتعافى قبل commit وبعده وعبر reload بنفس الإيصال والتاريخ والكمية والمفتاح ومن غير حفظ كود العميل. إنشاء وتحديث وتفعيل المسودة يتعافوا بعد رد ضائع، وانتهاء MFA يعيد التحقق مع حفظ المدخلات. التعارض الحقيقي يتطلب مراجعة النسختين؛ مفيش overwrite تلقائي لنسخة مختلفة.

عقود Zod مشتركة للمسارات الأساسية، OpenAPI لطلباتها ونتائجها والأخطاء وheaders، وفحوص كمية integer بلا coercion. الواجهة تحافظ على field paths وتوجّه للحقل والخطوة المناسبة. عقود بقية الإدارة الثانوية وSDK شامل بوابة تطوير منفصلة في IMPLEMENTATION.

التحقق النهائي لهذه الدفعة: verify:local ناجح؛7 unit tests و35 integration tests و28 browser checks،وبصمة السورس قبل وبعد متطابقة،مع نجاح build/lint/typecheck/OpenAPI/restore وفحص الأصول والخطة. المرجع checks.json وbrowser.json. السجل التالي تاريخ الدفعات السابقة، وأرقامه تخص وقتها.

---

# Implementation log

## 2026-11-08 — L02 قيد القبول

Nodemailer SMTP وFileSink محلي،وoutbox دائمة لبريد الحسابات دون تخفيف نطاق جداول التاجر. طلب reset والتوكن المشفر في transaction واحدة،وtrigger لإشعار كل تعديل باسورد قائم. SMTP receipt وMessage-ID يحفظان نفس intent؛انقطاع رد DATA أوتعطل تثبيت النتيجة بعد القبول unknown بلا إرسال ثانٍ. تصنيف CONN وحده لا يثبت إن الرسالة لم تُقبل؛الفحص الوهمي أثبت السيناريو واتعدل التصنيف لذلك.

SMTP وهمي TLS محلي أثبت بقاء reset بعد restart وفتح الرابط وتغيير الباسورد وإرسال التأكيد ودعوة التاجر. إضافة فحوص concurrency وعزل الأدوار وتعطل DB بعد القبول،وسيناريو متصفح من Forgot password لصندوق التجربة ثم reset والدخول بالكروت الأصلية. unit snapshots للأنواع الثلاثة باللغتين. انتظار verify:local النهائي؛لا مزود أوDNS أوإرسال حقيقي.

## 2026-11-08 — L00: baseline وقرارات الإطلاق وCI

### L01 قيد القبول

تنفيذ password production وإزالة managed exchange/JWKS/jose،وتصحيح قفل المحاولات لكل IP والإيميل،وضبط الجلسات حسب الدور ومنع تجديد جلسة منتهية/مسحوبة أوترقية عميل لامتياز أطول. TOTP إلزامي للمنصة في staging/production فقط مع enrollment مشفر ومربوط بالجلسة و10 recovery codes أحادية وتدقيق دون أسرار. تجربة المالك المحلية لم تتحول إلى Authenticator.

اختبارات production الجديدة تغطي cookie/CSRF وغياب local mail وexchange،الباسورد/reset/session epochs،MFA للدورين ومنع replay واستخدام recovery متزامن،ومدد وتجديد الجلسات وترقية الدور وحد20محاولة موزعة. حالة قبول L01 النهائية مرجعها تشغيل verify:local المطابق للسورس؛لا ادعاء إرسال بريد فعلي في هذه المرحلة.

تهيئة Git بأمر صريح من LAUNCH-PLAN،وفحص قائمة الملفات قبل commit:لا .env أو.local أومفاتيح خاصة ضمن التتبع. baseline ناجح بكل مراحل verify:local:14 unit و48 integration و53 browser checks وrestore؛بصمة 0060a07210418d78fbb15e4638db42b6b28ed22e0e17bb53e74af24ac5c81826. الملفات الستة الأصلية unchanged.

تسجيل D29–D36،وحفظ القرارات السابقة المتعارضة في الأرقام باسم D29-LEGACY وD30-LEGACY. P11 قنوات مدفوعة/حملات OUT_OF_SCOPE،والـconsent الحالية محفوظة. المالك اختار استكمال المحلي دون حسابات/اختيارات استضافة حاليًا.

CI يثبت Playwright Chromium،ويشغّل خادمين يملكهما runner على قاعدة nuqta_ci فقط،وينتظر readiness ثم الرحلة ويقفل عملياته فقط. بيانات واختبارات المتصفح الصناعية منفصلة عن تجربة مازن. لا remote؛لا ندّعي نجاح GitHub Actions على branch. نهاية L00 تُعتمد بنتيجة checks.json التالية،مع تحديث الجدول في LAUNCH-PLAN.

## 2026-11-07 — المسار الداخلي وأدلة القبول

اتنفذ P01–P07 محليًا، وأجزاء البرامج من P08/P09، وفحوص مستقلة من P13. آخر suite قبل التحقق الجامع: 5 unit tests و31 integration tests. رحلة Edge المتصلة نجحت في حفظ واستكمال draft، تجهيز فرعين وكاشير مقيد بفرع، كارت وQR، lost-response recovery بعد reload، إصدار مكافأة واستبدالها بتأكيد صاحبها، طلب ختم مع استرجاع اعتماد ضاع رده، تقارير وتصدير وشرائح، قطعة QR واستبدالها، دعم وتتبع عملية.

اختبارات الجدوى تشمل expiry بعد انتظار lock، نفس الإيصال عبر A/B، تفعيل واعتمادات متزامنة، disable قبل replay، تصحيح تعويضي واحد، شروط برامج محفوظة، صلاحيات Contacts، CSV خاص، worker fencing، ورفض unknown-provider retry. القياس المحلي 50 شراءً بتزامن20 مع حفظ invariant. snapshot restore نجحت في DB منفصلة. النتائج الحالية فيevidence/implementation،والأرقام النهائية مرجعهاchecks.json.

فحص المتصفح كشف تجميع الطلبات على IP؛ اتصلح للحساب المتحقق منه، واتضاف اختبار NAT وحد الحساب. كذلك اتصلح INSERT RETURNING مع RLS للتذاكر، وصلاحية row lock على العضويات، وحماية فروع نسخ البرامج من توسعة seed غير المقصودة. كل إصلاح schema في migration إضافية؛ الملفات المطبقة لا تتعدل.

المالك أكد عدم وجود حسابات خارجية. المراحل الخارجية والـPilot والإطلاق لم تُعتبر ناجحة، ولا توجد رسائل مدفوعة أوتحصيل أونشر. STATUS وTASKS وRUNBOOK اتحدثوا؛مراجعةP00 والـexports محفوظين.

## 2026-11-07 — P01 وP02

بدأ تنفيذ الخطة بعد موافقة المالك على تنفيذ المراحل بالترتيب. ملفات standalone محفوظة كمرجع. اتضاف npm workspace معReact/TypeScript/Vite وFastify وPostgreSQL17.7 مستقلة على55432،بأدوار migrations/runtime/auth/worker منفصلة. الأسرار المحلية مولدة عشوائيًا في.env وممنوعة منالتتبع والطباعة.

التحقق في أول دفعة: typecheck ناجحة؛unit tests3/3؛integration tests5/5 علىDB مؤقتة مستقلة اتشالت بعدالتشغيل؛build نجحت. آخرlint كشفإنمسارdist الفرعي لازم يتستثنى؛الإعداداتاتصلحت وإعادةالفحصمطلوبة. audit بعدoverride لـminimatch:0 vulnerabilities.

P01: local OTP عشوائي محدودالصلاحية والمحاولات،cookie sessions وCSRF وTOTP MFA للمدير،tenant/branch RLS،ورفضlocal Auth فيstaging/production. Supabase JWT adapter موجودخلفإعدادات؛الحسابوالتحقق الخارجي وتدفقproduction لسهغيرمعتمدين،ومشهنسميهمجاهزين.

P02: migration ثانيةللمسودات والتفعيلوالبرامجوالدعوات وoutbox/jobs. الاختبارأثبتإنالتفعيلالمتوازيبيرجعنفسالتاجرونفسresources،واختيارالفروعفيالدعواتبيتطبقفعليًا،ومالكB مابيقبلشدعوةA. الواجهةtyped للـwizard قيدالربطوالتحقق. تخزيناللوجوالمحلييعيدترميزالصورةبـSharp؛تخزينcloud محتاجprovider قبلالنشر.

مفيشpaid provider أوproduction deployment اتنفذ. حالةالمهامالنهائيةتتحدثبعدفحصUI وباقيالرحلات،مشبمجردكتابةالكود.

## استكمال نفس الجلسة

اتضافت إدارة برامج متعددة من واجهة التاجر،مع حدودنشطة وإيقاف/استئناف صريحين. اختبار أثبت كارتين مستقلين ورفض نفسالإيصال عبر برنامجين،ومنعتنشيط برنامج ضمنيًا عن طريقنشر version. مراجعة الاسترجاع والملفات أضافت authorization حسبالأمرلـGET operations وبصمةنطاقللتصدير،وفشلصف CSV المتأثر بالصلاحيات بيتسجلصراحة. migration009g تلغي روابطالملفاتالقديمة مجهولةالنطاق فقط،منغيرمساسبالـLedger.

## التحقق النهائي المثبت

verify:local ناجح بكل مراحله: 5 unit،31 integration،20 browser checks،build/lint/typecheck،OpenAPI inventory،isolated restore،وفحص الخطة والأصول. sourceFingerprintBefore/After متطابقتان فيchecks.json. مصادقة التسجيل مرتبطة ببصمة النص،والـ31 اختبارات تشمل رفض شروط اتغيرت أثناء التسجيل ومنع مسارDB القديم غير المحمي. بوابات الإنتاج المعلقة كما هي فيSTATUS؛لا حساب خارجي أوإنفاق أونشر.


### قبول L00

verify:local النهائي passed على Chromium:14 unit،48 integration،53 browser checks،وكل مراحل build/lint/typecheck/OpenAPI/manual-demo/restore/verify:plan ناجحة. sourceFingerprint=0882fd165b2563d9d518743a768add0eafca2613b9ec3bf75e82d33e58496670،مطابقة قبل وبعد. مهام L00 الأربع DONE؛عدم وجود remote موثق حسب قبول L00-04.


### قبول L01

verify:local passed بكل المراحل:16 unit،52 integration،54 browser checks،مع build/lint/typecheck/OpenAPI/manual-demo/restore/verify:plan. بصمة ed3dfaf8b909b6dfae57c7de137a4ae3d0679055d49a78f63b9bcb11283fb14d متطابقة قبل وبعد. إصلاح تزامن اختبارات التركيز وانتظار commit قبل محاكاة فقد الرد؛لا تخطي لأي فحص. ترقية تجربة مازن حافظت على2محل و3حسابات و2staff و1customer وكل hashes/versions/roles؛4180 ready وlogin password local. L01 DONE محليًا؛SMTP ضمن L02،ومفيش نشر إنتاجي.


### قبول L02 المحلي

verify:local passed:18 unit و56 integration و55 browser checks وكل مراحل build/lint/typecheck/OpenAPI/manual-demo/restore/verify:plan. بصمة 524a46317dbb3d7f0d317a4cbc729708cf1d06a39b90b338323dcd7b9ed3e52a متطابقة قبل وبعد. إصلاح قراءة رقم العميل المتأخرة مع StrictMode وحماية أحدث رد لتفضيلات الموافقة،مع فحص متصفح يوقف GET قبل إتاحة الكتابة. حفظ دليل التحقق atomic مع retry لأخطاء FS المؤقتة،وحجب روابط reset في أخطاء الاختبارات. المحلات والحسابات اليدوية محفوظة؛لا إرسال حقيقي. L02-01..04 DONE و05 BLOCKED_OWNER؛L03 مستقل ويستكمل حسب قاعدة6.

### قبول L03 — 2026-11-09

L03 DONE محليًا — 2026-11-09:FileStore بكتابة ذرية وkeys محدودة،وSTORAGE_ROOT إنتاجي خارج الكود،وتنظيف وصورPNG1024 بلاmetadata. ترحيل التطوير راجع51صورة ونقل39مسودة و18CSV بلا ملفات مفقودة؛تجربة مازن راجعت2صورة واحتفظت بالحسابات واللوجو المنشور. verify:local passed:20 unit و58 integration و55 browser؛اختبار symlink متخطى على Windows ويعمل على Linux CI. sourceFingerprint a5d36028fe15a58bc6efcf53883555ba32dc92ae96694815f1933cc72fc3e8b6 متطابق قبل وبعد. D37–D42 اتثبتوا حسب إضافات الخطة،والتنفيذ الوظيفي لهم في L06A/L06B.

### قبول L04 المحلي وحدود التشغيل

L04 LOCAL_IMPLEMENTED / BLOCKED_OWNER — 2026-11-09: Dockerfile وCompose وCaddy وتهيئة الأدوار والأسرار وhardening وREADME اتضافوا. proxy.test يثبت CIDR ورفض spoofing وعزل rate limit وOrigin؛readiness يراجع الدورين runtime/auth ويرفض ownership أوامتيازات زائدة أوتبديل الأدوار. Worker وmigrator لا يحتاجان credentials الأدوار الأخرى. test:deploy-scripts passed علىLinux وCompose config passed بلا طباعة أسرار. Docker Desktop تعطل عند dockerInference قبل بدءLinux engine؛image build/size وstack وheaders وproduction bootstrap غير متحققة،والتقرير deployment.json يسجلBLOCKED_LOCAL_DOCKER. CI اتضاف له job مستقل للتجربة لكن لا remote لتشغيله. verify:local passed:22 unit و61 integration و55 browser،واختبارsymlink متخطى علىWindows؛sourceFingerprint 02bf772bd3ab456353eb2c0de78bf0382be73e67a88e6820c2ef4e504e7884cf متطابق. لا اعتماد إطلاق ولا تعديل host hardening فعلي.

### قبول L05 المحلي وحدود الاستعادة

L05 LOCAL_VERIFIED / BLOCKED_OWNER — 2026-11-09: اتنفذ تمرين فعلي على Linux مع PostgreSQL17 وpgBackRest وrestic، على clone صناعية من nuqta_local ومن غير API أوWorker. full وdiff وPITR قبل شراء تجريبي رجعوا counts وmigrations وSHA-256 للـLedger والمعاملات والأرصدة مطابقة، وبصفر balance drift. اللوجو رجع بنفس البايتات، والمفاتيح الغلط اترفضت. scheduler أول full وWAL check اتجربوا، وSQL migrations كلها اشتغلت بمالك محدود؛كلمات مرور bootstrap غائبة عن logs حتى مع forced statement logging. إعدادات Compose والتشفير والجدولة والمراقبة جاهزة، لكن image/container runtime ونسخة خارج الجهاز والتنبيه الحقيقي لسه غير متحققين. verify:local passed:23 unit و61 integration و55 browser؛اختبار symlink واحد متخطى على Windows. البصمة 23557e12c5e049e8b38c9fa04a6d8e1c23993a73f89b856b4e731c4d1ece0b4e متطابقة قبل وبعد.

الأدلة المولدة:backup-native.json وdeployment-scripts.json وdeployment.json وchecks.json. pgBackRest info لا يكفي exit0 للحكم؛scheduler يفحصstatus،ويقبلفقطحالةstanza صحيحةفارغةلأولfull. التشفير اختُبر بمحاولةrestoreبمفتاحغلط،مش بمجردmetadata. الاستعادة داخلfixtureListenUnixفقط،ولا مزود خارجي اتشغل.

### L06 — تحقق الموبايل والـPWA

تنفيذ legacy targets وCSP hashes وPWA shell وأيقونات placeholder وتحديث باختيار المستخدم،من غير cache للـAPI. بدائل UUID/Popover/ResizeObserver،وقوائم داخل dialogs،وفصل تحميل QR decoder. Camera stream صناعية تثبت cleanup حتى لو الإذن تأخر؛التجربة على الهاردوير الحقيقي تفضل BLOCKED_OWNER في L08. mobile.json نجح في17فحص مع14صورة AR/EN؛Chromium Pixel5 وWebKit iPhone12 ورحلة كاشير فعلية بالإدخال اليدوي. verify:local passed بعد إصلاح fixture لفصل الملفات العامة عنAPI rate limits،بنفس حدودAPI الحالية: 24 unit و62 integration و55 desktop و17 mobile؛skip واحد لـsymlink علىWindows. بصمة السورس 4e2737abb49cd95cb32a3c11665ff186e271bdabfef733ff3a026d2c74cf21b1 متطابقة. تجربة مازن أُعيد تشغيلها على4180 وتأكد تطابق الحسابات واللوجو وready200. التفاصيل في MOBILE-PWA.md. لا تغيير لحسابات أوأرصدة تجربة مازن،ولا نشر خارجي.

### L06A — جارٍ، غير مقبولة بعد

009w/009x: إشعارات IDs فقط داخل نفس transaction للـledger والطلبات وتأكيد الصرف. اتصال LISTEN واحد لكل API process؛SSE يعيد فحص session وRLS والفرع،heartbeat25s،ويغلق عند revocation أوshutdown. Connection:close يمنع انتظار keepalive عند الإغلاق. فحوص HTTP الثلاثة نجحت. العميل يشترك في قناة واحدة مشتركة بين أجزاء الصفحة، مع coalescing75ms وpolling3s عند الفشل؛انقطاع SSE لا يفقد الحالة لأنها تُقرأ منAPI.

009y: 10دقايق،limit يومي10/عميل/محل عبر كل البرامج واليوم المحلي للمحل (DST included)،advisory lock،وتدقيق للمحاولات الزائدة خارج rollback الخطأ؛إعداد المالك محمي بـCSRF/Origin/revision. اختبارات السباق والتكرار والصلاحيات نجحت. 009z: إثبات scan جديد في presentation_tokens مربوط بجلسة الكاشير والفرع وبـcustomer presentation الأصلية؛إلغاؤها/انتهاء جلسة الحامل يبطل الإثبات. lookup برقم لا يجيز ختمًا أوصرفًا. request approval يحتاج cashier_scan؛raw customer QR وحده أوproof جلسة كاشير أخرى مرفوضان. فحوصrequests/rewards نجحت بعدهما.

010: API يعيد stamp_ink من earned ledger IDs وunit ordinals بعد استبعاد المعكوس،حسب cycle_number؛لا تغيير للأرصدة أوLedger. نحتاج اختبارات ثبات الرسم والصرف معsurplus قبل قبول الحركة. كل migrations أضيفت ولم تُعدَّل بعد تطبيقها. قاعدة التطوير محدثة حتى010؛تجربة مازن ما زالت على إصدارL06 وقاعدتها حتى009v،بلا reset. build الجديد لم يُنشر عليها بعد.

واجهة الطلبات الجديدة بلاreview modal؛الإيصال يظل إجباريًا لحماية purchase dedupe. QRproof وكود المطابقة لا يدخلان sessionStorage؛المحاولة التجارية وحدها تُحفظ،وتحتاج scan جديدًا عند إعادة محاولة غير محفوظة. اختبارات الرد المفقود والتعافي بعدreload نجحت جزئيًا فيtest:e2e. تكرار خمس سكانات نُقل إلىmobile suite بجلسات قصيرة مستقلة،بعد أن استنفد السيناريو الطويل حدAPI300/min الصحيح؛لم تتغير حدودAPI. الجولة الكاملة الجديدة ما زالت مطلوبة. لم تبدأ الحركة نفسها بعد؛المرجع فُتح فيChromium من ملفه الأصلي مع تعطيل تحميل الخطوط الخارجية.

تحديث لاحق L06A: الحركة نفسها اتبنت في StampInk/useCardMotion/stamp-motion وLoyaltyCard وfeatures.css. 24 فريمًا ثابتًا WAAPI (single/three/reward/reduced ×0/120/300/360/480/700ms) اتولدوا جنب المرجع الأصلي،واختبار العدّاد والتوقيت نجح؛صور المقارنة فيevidence/animation. أزيلت card-moment وnuqta-stamp/ring/reward CSS القديمة. rough ink وgrain35% و7specks وزاوية seeded،tool120/180/120/220ms،ink220،ring420 و7flights،stagger350 وcounterبعد300،reward bannerفوقالكارت وcanvas44particle/1300ms. reduced-motion بلاtool/confetti/haptic. اختُبرت المعاينة بصريًا وتصحيح icon geometry باستخدامStampPath المشتركة.

قياس devReact الأول سجل33.3ms،ففصل اختبار الأداء إلى fixture إنتاجية مبنية بنفسlegacy targets وCSP؛لم يُرخَّ الحد32ms. الجولة التاليةpassed:24frames وmax16.8ms تحتCPU4x بلاframes>32،ومعChrome trace. npm run test:animation يعيد كل ذلك،والـfixtures الإنتاجية المؤقتة في.local فقط ولا تُنشر. مع ذلك ما زال قبول فيديو حقيقي من المالك BLOCKED_OWNER،والموبايل/fullverify لم يُعادا بعد بقية تغييراتA.

QR dialog أصبحتfullscreen بخلفيةبيضاء معrefreshقبلانتهاء90s وclose بعدaccount revision/holder challenge؛source scan العادي يقفلstamp_request المطابق تحتنفسtransaction لمنع انتظار/اعتماد مكرر،بنفسترتيبlocks. فحوصlive-events/rewards/requests=12passed بعد ذلك،ومنهاثباتstamp_ink وsurplusللكارتالتالي. InstallCard أضيفت الآن:beforeinstallprompt،وiOSguideبخطوتينSVGوبحدعرضأولين،معstorageداخلtry/catch؛اختبارمنطقها/الأجهزةلميكتملبعد. sourceTreeL06Aلايزالغيرمقبول؛لاcommitمرحلةنهائيوchecks.jsonمازالL06.


### L06A — checkpoint متحقق قبل ربط الجهاز

L06A LOCAL_CHECKPOINT / IN_PROGRESS — 2026-11-09: تنفيذ السكان التلقائي للعميل المسجل،SSE،حدود الطلب،QR proof وواجهة اعتماد inline،حركة v2 وحفظ الكارت وقياسات التجربة متحقق محليًا. verify:local passed:24 unit و68 integration و55 desktop و31 mobile و5 animation checks تشمل24فريم مقارنة؛skip واحد لـsymlink علىWindows. Pixel5/CPU4x:maxFrame=16.8ms وصفرframes>32. بصمة 52003f977d6cf404e17fca45d8c91313ce5006c4bd7e41f92417bd0de6ec1bdb متطابقة قبل وبعد. تجربة مازن على4180 محدثة حتى010a مع تطابق الحسابات واللوجو وready200. أول شاشة بالاسم والرقم واستعادة الجلسة تعتمد صراحةً علىL06B،فلم تُغلق A01/A12؛الفيديو الحقيقي وموافقة المالك والتثبيت وNFC وstaging تظل BLOCKED_OWNER. التفاصيل في [STAMP-EXPERIENCE](STAMP-EXPERIENCE.md).

التفاصيل السابقة في السجل تاريخ تنفيذ وليست الحالة الحالية:root وmanual محدثان حتى010a،والحركة وInstallCard وQR/experience اختُبروا. أول فشلmobile كان fixture:WebKit تجاوز page.route تحتServiceWorker؛أُثبت attempts=0،ثم عُزل SW في fixture أعطالWebKit فقط،واختبار SW الحقيقي مستمر علىChromium. الاختبار يقطع قبل الحفظ وبعده بنفسالمفتاح،ولم تُرخ حدودAPI أوCSP. screenshot الأول ينتظر نهايةreveal بدل حفظopacity أثناءالدخول. آخرverify ناجح ويشمل12خطوة وبصمةمتطابقة. لا إرسال خارجي أوتغيير حسابات مازن أوالنشر.


### L06B — checkpoint هوية العميل والجهاز

L06B LOCAL_CHECKPOINT / IN_PROGRESS — 2026-11-09: اتنفذ تسجيل العميل بالاسم والرقم والشروط، وربط الجهاز HttpOnly/Secure/Lax، واسترجاع واتساب يدوي أحادي بحدود وصلاحيات وتدقيق، وقفل مسار باسورد العميل. verify:local passed:24 unit و79 integration و56 desktop و33 mobile و5 animation checks تشمل24فريمًا؛skip واحد للـsymlink علىWindows. قياس Pixel5/CPU4x علىLinux:live max=16.8ms وtrace max=16.8ms، وصفر فريمات فوق32 في الجولتين، مع3أدوات ورصيد5 فعليًا. بصمة 9e4cc9a74a0e123f17168d53a6af39d8b401dc1908b4d9e23735843ac4c420e5 متطابقة قبل وبعد. root وتجربة مازن محدثتان حتى010e، مع تطابق الحسابات واللوجو وready200. A01/A12 مغلقتان محليًا؛B11 الخاصة بالحذف تنتظرL09-02 بنص اعتمادها عليه. الفيديو والتثبيت وNFC والواتساب من موبايلين وstaging تظل BLOCKED_OWNER فيL08. التفاصيل في [CUSTOMER-IDENTITY](CUSTOMER-IDENTITY.md) و[STAMP-EXPERIENCE](STAMP-EXPERIENCE.md).

010b–010e إضافية ولم تُعدّلmigrations مطبقة. اختبار الترحيل يقارن seed قديمة، والهوية برقم فريد بلاemail/password جديد، وRLS تمنع قراءة hashes. الجهاز لا يتحول إلى صلاحية فريق حتى لو صاحبه صار موظفًا. الاسترجاع لا يلغي جلسة الفريق ذات البوابة الصريحة؛جلسات العميل والقديمة غير المحددة تُلغى افتراضيًا. تكرار رابط الاسترجاع يرفض410، وGET لا يستهلكه. حدود5/ساعة للتسجيل و30/ساعة لبحث الكاشير و10روابط/يومUTC للعميل ثابتة ومختبرة دون تصفيرها.

اختبارات المتصفح تغطي فقد رد تسجيل محفوظ، واستعادة جلسة من credential، و401 أثناءPOST ثم إكمال نفس المفتاح، والحفاظ علىNFC/branch/placement، وأول شاشة بالاسم والرقم والشروط فيAR/EN. مثال واتساب مسودة يرسلها الموظف بنفسه؛لم تُرسل رسالة خارجية. fixture متعدد الملاك أصبح يقارن صلاحيات المالك المختار، مع مالك ثانٍ بفرع واحد، بدل افتراض مالكseed مع اختلاف الفروع.

بعد تقوية benchmark ظهر فشلWindows حتى فيcontrol خارجNuqta؛لم يُرخ حد32ms أويُحذف الفشل. أضيف runner اختياري صريح علىWSL Linux بنفسNode وChromium، ونفسbundle/CSP، ودليلrunId يمنع قبول ملف قديم. الجولتانlive وtrace تشترطان الحد نفسه وثلاث أدوات ورصيد5؛Linux CI تستخدمrunner native. التوقيتات المعتمدة محفوظة معmemo للأجزاء الثابتة وتجميعFX ووقفcolor transition القديم. رقم16.8ms فيA قبل الشرط الجديد تاريخي، وليس دليلًا على أداء الشجرة الجديدة.

تجربةمازن بقيت2محل و3حسابات و2موظف وعميل واحد، وبصمةكلماتالمرور واللوجو كما هي. فشل التحقق الجامع قبل تصحيحfixture الملاك مسجل تاريخيًا؛القبول الحالي هوchecks.json الناجح ببصمةالسورس أعلاه. التاليL07؛لاL10 قبلPilot حقيقي.


### L07 — تحقق محلي مع بوابة الإرسال الخارجي

L07 LOCAL_VERIFIED / BLOCKED_OWNER — 2026-11-09: JSON logs آمنة من API وworker، وmetrics/health داخلية بتوكن مستقل، وعزل Compose وrotation20m×5. Uptime Kuma2.5.9 الفعلية استقبلت تنبيهات HTTP علىloopback لتوقف الخدمة وbackup قديمة وjob16دقيقة وdisk probe صناعية81% و5xx، وتحذير شهادةTLS موثوقة تنتهي خلال5أيام. لا إرسال خارجي. verify:local passed:26 unit و85 integration و56 desktop و33 mobile و5 animation و9 monitoring؛skip واحد لـsymlink علىWindows. بصمة aa7e2746b28db8b2d168cc945ca1778e2bfe66cdf546ba52f8f68a6dfd83dbd9 متطابقة قبل وبعد. root وتجربة مازن حتى011a؛الحسابات واللوجو محفوظة وready200. القناة الخارجية والدومين وCompose runtime علىسيرفر BLOCKED_OWNER؛Docker المحلي متعطل كماسُجل فيL04،وconfig-only ليس دليل تشغيلstack. التفاصيل في [MONITORING](MONITORING.md).

011 و011a ترحيلات إضافية،لم تُعدّل بعد التطبيق. الأولى توفرcounts فقط بدالةauth؛الثانية تبقيالإلغاءات النهائية المعروفة فيcounts،وتحسبعمرactionable فقط. اختباراتسلبية تثبتأنSMTP_REJECTED والنتائجunknown وfailed والأسبابالمجهولة لا تُستبعد. قياسp95 تقريبي بحدhistogram،والنافذةprocess-local خمسدقائق؛SSE مستبعدة منالمدة.

اللوجز تستخدمallowlist/root logger لحمايةchild bindings،ولا تطبعrequest rawURL أوbody أوIP أوcredential أوخطأخام. Kuma rootless بواجهةloopback،بلاشبكةDB أوسرDB،وCaddy تقفلinternal صراحةً. تسعةأسرارمستقلة واختباراتshell ناجحة؛manifest الرسمي موجود وComposeconfig ناجح،لكنلاengine/image/runtime قبول. التمرينnative يعزلDB والأسرار ويرسللووبback فقط؛صورdashboard وmonitoring.json مولدة.

تحسينالحركة يؤخررسمink الخاناتالمخفية حتىلحظةimpact،معنفسseed/geometry/timing. اختبار24فريمًا ومعيارCPU4x المزدوجلم يُرخ. تاريخالتحقق:فشلتجولةWebKit برسالةaccess-control أثناءرحلةتتضمنجلسةمنتهية؛نجحتالإعادةالمستقلةثمverifyالجامع،بدونتجاهلpageerrors أوتغييرCSP. التحققعلىSafari حقيقي يظلفيL08.

ترقيةتجربةمازن عبرsnapshot أعادت2محل و3حسابات و2موظف وعميلواحد باللوجونفسه،وأعيدتشغيلعملية4180 المحددةفقط. التاليL08،والبنودالخارجيةمعلقةبقرارالمالكالسابقباستكمالالمحلي.


### L08 — تحقق محلي قبل موافقة النشر والأجهزة

L08 LOCAL_VERIFIED / BLOCKED_OWNER — 2026-11-09: أدوات اختبار الموبايل جاهزة بقاعدة وملفات وحسابات صناعية جديدة فقط. cloudflared2026.10.7 الرسمي تم تنزيله والتحقق منSHA-256 وإصداره دونفتحنفق. test:tunnel:7فحوص فعلية لـVite/React وHost والملفاتالخاصة وSecurepassword وOrigin/CSRF وQR؛externalTunnelOpened=false. staging لهاoverlay ومشروع وvolumes وشبكات وأسرارمستقلة،وtest:staging-config أثبتتconfig فقط بلاruntime. verify:local passed:27 unit و85 integration و56 desktop و33 mobile و5 animation و9 monitoring و7 tunnel؛skip واحد للـsymlink علىWindows. بصمة ea35672c9684b3a639d3365d0c8096a8b774e2de3249495e1427ab333fec4086 متطابقة قبل وبعد. فتحالرابطوالأجهزةالفعلية وNFC وstaging/TLS BLOCKED_OWNER. سجل كلجهاز وكلرحلة NOT_RUN في[DEVICE-TEST](DEVICE-TEST.md)،وليسقبولًابالمحاكاة. تجربةمازن على4180 وحساباتهاكماهي. التاليL09 المحليةالمستقلة؛لاL10 قبلPilot.

الأمرdev:tunnel الافتراضي يجهزفقط،والنشر يتطلب --publish-synthetic صراحةً بسببقاعدة8 وخيارالمالك باستكمالالمحلي. لم يُنفذالنشر. prepareTunnel لايستعملقاعدةموجودة،وcleanup فيالاختبار يحذففقطالقاعدةالتيأنشأتهاستدعاؤه. لاكتابةلـroot.env أوحسابمازن. الأسراروحساباتالنسخةالصناعية في.local فقط؛CLI default اشتغلفعليًا،وstaging:prepare أنشأتملفمراجعةدونoverwrite.

QuickTunnels لا تدعمSSE حسبCloudflare،فالـproxy التجريبي يغلقمساراتها503 لتشغيلpolling3s. قبولتحتثانية يظلعلىstaging معSSE،ولا يُنسبللنفق. Vite تعملبـexact allowedHost وجذورواجهةمحدودة،معحجبملفاتالبيئةوالمجلداتالخاصةوالـencodedpaths. dependencycache JS فقطمسموححتىتعملReact؛اختبارالمتصفحيثبتذلك. حدثإغلاقمتكررمنSIGINT/exit لايكررإغلاقpool.

Compose staging تستخدمsubnet جديدةوtrustproxy واحدًا. port bindings الافتراضيةloopback فلايمكنالادعاءبقبولTLS؛اختيارمضيفأوingress وتشغيله فعليًا ينتظرالمالك. DEVICE-TEST تحتويخمسةأنواعأجهزة و13رحلةلكلجهاز،كلهاNOT_RUN؛لاصوركاميراصناعيةتملأخانةهاردوير. الأدلةمولدةفيtunnel.json وstaging-config.json،وCI مهيأةلإعادةالتحققولكنلاremote.


### L09 — خصوصية واشتراك وتشغيل محلي متحقق

L09 LOCAL_VERIFIED / BLOCKED_OWNER — 2026-11-10: صفحات الخصوصية والشروط AR/EN مسودات ظاهرة للمستخدم، والتسجيل يحفظ النص والنسخة واللغة وhash ويرفض الموافقة القديمة. حذف العميل يبطل الأجهزة والجلسات والاسترجاع وQR والتصديرات، مع تطابق Ledger والأرصدة وسجل المكافآت قبل وبعد. الاحتفاظ المحلي: CSV جديدة 24 ساعة، وجلسات منتهية أكثر من90 يومًا بدفعات500. الاشتراك اليدوي يسجل ويُبطل دفعات immutable؛ انتهاء المدة أو pause يمنع أختامًا جديدة ويُبقي عرض الكارت وصرف المكافأة المكتسبة وتجديد الدورة. verify:local passed:28 unit و99 integration و60 desktop و33 mobile و5 animation و9 monitoring و7 tunnel و3 log-config؛skip واحد للـsymlink علىWindows. كل15خطوة نجحت وبصمة 5b3bc4fdd731771623d68a9c4053b5cf79b8be2ae9bac027eacd557ea6b14313 متطابقة قبل وبعد. root وتجربة مازن حتى012e، مع تطابق الحسابات وكلمات المرور واللوجو وready200 ودخولplatform فعلي. سياسة لوجز30يوم CONFIG_VERIFIED_RUNTIME_NOT_RUN فقط ولم تُطبق علىhost؛نسخةmanifest مستقلة مشفرة وجدولتها لم تُجهز. الموافقة القانونية والأسعار ومسؤول needs_review وقراءةrunbook والأجهزة/السيرفر/Pilot تظل BLOCKED_OWNER. لا بدءL10 قبلPilot حقيقي أوطلب صريح. التفاصيل في [PRIVACY-AND-PILOT](PRIVACY-AND-PILOT.md) و[PILOT-RUNBOOK](PILOT-RUNBOOK.md) و[RETENTION](../../deploy/RETENTION.md).

012–012e ترحيلات إضافية، ولم تُعدل بعد تطبيقها. اختبارات الحذف تشمل منع dual-role، سباقات العمليات المنتظرة وترتيب request/account locks، وعدم تأكيد حذف حساب جديد بإيصال حذف قديم. تعافي الدفع بعد رد ضائع وreload يحفظ نفس المفتاح والpayload/revision، مع منع مرجع دفع نشط مكرر والسماح بتصحيحه بعدvoid. اختبار انتهاء الاشتراك ينتظر قفل account فعليًا ثم يثبت منعstamp بعد انقضاء المدة، ويثبت صرف مكافأة سابقة بتأكيد صاحبها وتجديد الكارت.

manifest موقّع ومربوط بهويةdeployment ويعيد anonymize للبيانات المستعادة؛المفتاح الغلط والتلاعب وscope الغلط يترفضوا. الإثبات محاكاة بيانات مستعادة داخلDB اختبار، وليسpg_restore جديدًا. الخدمات تظلoffline حتى إعادة الحذف وتنظيفCSV؛أحدث نسخة مستقلة ومراجعة فجوة الفقد شرط قبلPilot.

فحوص الاحتفاظ تستخدم Compose daemonless وstaging installer وsystemd-analyze فعلية، ولم تغيرjournald أوتمسحlogs أوتعيد إنشاءcontainers. الصورة العربية لاختيار تاريخ الاشتراك تُراجع معassert أن اليوم والشهر والسنة ظاهرة كاملة. الأصولstandalone لم تتغير. لا رسائل خارجية أوtunnel عام أونشر،ولاCI خارجي مثبت لغيابremote. تجربةمازن تحتفظ بمحليْن و3حسابات و2موظف وعميل واحد.

- 2026-11-10 — الجولة ج من رحلة المستخدم: commits 8f0e5e6 و63cd757 و93a1769 و14194d5 وdbed15d. اختبارات جديدة: `redemption-resume.test.ts` و`arabic-copy-spacing.test.ts`.
