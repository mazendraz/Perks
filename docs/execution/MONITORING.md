# L07 — مراقبة التشغيل

المراقبة مستقلة عن حسابات المحلات والعملاء. واجهة التشغيل الخاصة بـUptime Kuma متاحة على loopback فقط، والـAPI تعرض قياسات مجمعة بتوكن مستقل. الحسابات والبطاقات والـLedger كما هي.

## تشغيل محلي قابل للإعادة

```powershell
npm run monitoring:setup
npm run monitoring:local
```

افتح `http://127.0.0.1:4301`، واختر حساب التشغيل من شاشة الإعداد الأولى. البيانات والإعدادات محفوظة في`.local/monitoring-console`،والإعادة تحتفظ بالحسابات والمراقبات. لا يوجد تثبيتglobal أوتعديلWindows startup. الإعداد ينزل النسخة الرسمية2.5.9،ويطابقcommit`df601c58d9205562f34cfe5ef35264b341019d19` قبل تنفيذdependencies. المسارات الفعلية تُراجع لمنعjunction أوsymlink خارجworkspace.

التنزيل والتشغيلnative مدعومان في [تعليمات Kuma الرسمية](https://github.com/louislam/uptime-kuma/wiki/%F0%9F%94%A7-How-to-Install). Node24 يطابق requirement الإصدار. لا يوجد حساب خارجي أوإرسال رسالة أثناء التجهيز.

للتجربة المحلية الحقيقية أضفHTTP monitor لـ`http://127.0.0.1:4100/health/ready`،وآخر لتجربة مازن على`http://localhost:4180/health/ready`. لو استخدمت القياسات الداخلية،ضع`MONITORING_TOKEN` مستقلًا بطول32على الأقل في البيئة الخاصة وأعد تشغيلAPI؛نسخه إلىحقلAuthorization فيKuma يكون بصيغة`Bearer …`. قيمةفارغة تقفل المسارات404،والجلسة العادية للمنصة أوالمحل لا تقوم مقام التوكن. لا تستخدمAUTH_PEPPER لهذاالغرض.

## القياسات والحدود

- `/internal/metrics` يعيدJSON مجمعة معCache-Control:no-store. `/internal/health` يعيد503 إذا أي check محتاج متابعة.
- HTTP counts للردود المكتملة داخلAPI. النافذة5دقائق بدقةbucket ثانية واحدة،والإجماليات تبدأ من إقلاعprocess. طلباتhealth والمراقبة نفسها مستبعدة. SSE تُحسب عند الإغلاق،ومدتها مستبعدة منp95.
- p95 هو الحد الأعلى لـhistogram bucket،وليس قياسًا دقيقًا لكلعينة. فوق60ثانية يظهر`p95Above60000ms:true` بدل رقممضلل. التوزيعprocess-local مناسب لنسخةAPI واحدة كما فيCompose الحالي.
- error ratio فوق1% خلالالنافذة يرفع`http_5xx_above_1_percent`. الديسك فوق80% منfilesystem الخاصة بـSTORAGE_ROOT يرفع`disk_above_80_percent`.
- الـoutbox مجمعة منjobs وauth mail:pending/running/failed/blocked/unknown،مع`actionable` للمهام التي ما زالت تحتاج تدخلًا. عمر أقدم مهمة منها فوق15دقيقة يرفع تنبيهًا. الإلغاءات النهائية المعروفة فقط (`INVITATION_NOT_AVAILABLE` و`EXPORT_SCOPE_CHANGED` و`EXPORT_NOT_AVAILABLE` و`AUTH_MAIL_STALE`) مستبعدة من العمر عندما تكون`blocked`؛تظل ظاهرة في العدادات. فشلSMTP والنتائج المبهمة والأسباب المجهولة تظل قابلة للتنبيه. التنبيه لا يعيد إرسال عملية مبهمة تلقائيًا.
- `operational_queue_metrics()` ترجععدادات وعمرًا فقط. nuqta_auth وحدها تستدعيها؛runtime وworker ممنوعان،ولا توجدSELECT جديدة علىبياناتauth mail لهما.
- ملفاتالباك أب تحتBACKUP_STATUS_ROOT/database/status.json وfiles/status.json،ومركبةread-only داخلAPI. فحصDB:heartbeat خلال5دقائق،وآخرbackup خلال26ساعة وWAL خلال30دقيقة. الملفات:backup ناجحة خلال26ساعة لأنجدولها يومي. غيابالملف أوفشلJSON أوsymlink أوتقريرقديـم يظهـرunhealthy،بلاعرض محتواه أوخطئهالخاص.

## اللوجز

API وworker يخرجانJSON علىstdout/stderr. سطرHTTP يحتويالمسارالمعرّف مثل`/merchants/:m/...`،والحالة والمدة وUUID مولّدة للطلب. المسارالمجهول يظهر`[unmatched]`. لا تُسجلالعناوينالخام أوquery أوIP أوhost أوheaders أوbody أوأسماء/أرقام/إيميلاتالعملاء.

سجلاتAPI تمر عبرallowlist لرسائلHTTP والفشل. النصوص والـbindings غيرالمعروفة منplugins تتحول إلى`framework.event` معlevel ومعرفطلب آمن؛لا تُكتبmessage أوstack قد تحملبيانات. الكاتب يستخدمroot logger حتى لا تتسربchild bindings. أخطاءبدءAPI/worker والـworker loop لهاevents ثابتة،ولا تُطبعDB URLs أوأخطاءالإعداد الخام. استخدمrequestId معoperation tracing والدعم للتحقيق.

كلخدماتCompose،ومنهاالمراقبة،تستخدمjson-file rotation بحد20m وخمسةملفات. سياسةالعمر30يوم تتبعL09 ولا تُعتبرمتحققة منحدالحجم وحده.

## Compose والتنبيهات

الخدمة`monitoring` مثبتة على`louislam/uptime-kuma:2.5.9-slim-rootless`،UID1000،read-only وcap_drop:ALL،منغيرDocker socket أوDB/Auth/SMTP secrets فيبيئتها. Port4301 مربوط بـ127.0.0.1،والدخولالبعيد للمشغل عنطريقSSH tunnel الخاص به. Caddy ترفض`/internal` و`/internal/*` صراحةً،والـAPI نفسها ليسلهاhost port.

أضف monitors لـAPI readiness،ولـ`http://api:4100/internal/health` بتوكنالتشغيل،ولـHTTPS علىالدومينالحقيقي معTLS verification وcertificate expiry notifications. القيم7/14/21يوم مدعومة منKuma. الدومين وقناةTelegram أوSMTP والإرسالالحقيقي منتظريناختيارالمالك. إعدادالتوكن وحسابKuma خاصان بالتشغيل؛احتفظ بنسخةآمنة منهما معإعداداتالمراقبة.

`deploy/init-secrets.sh` يولدتسعةأسرارمستقلة الآن،منهاMONITORING_TOKEN،ويرفضاستبدالملفموجود. لوكانعندكملفإعدادأقدم،أضفالتوكنالجديد يدويًا معالحفاظعلىالأسرارالقائمة. لا تُنشرملفاتالبيئة أوSQLite الخاصة بالمراقبة فيGit.

## إثباتالتنفيذ

`npm run test:monitoring` يشغّلKuma الحقيقية علىportمحلية مؤقتة وDB خاصة به،وAPI وPostgreSQL صناعية منفصلة. ينشئحسابًا صناعيًا للتجربة ويوقفالخدمات ويحذفDB المحددة التي أنشأها فقط عندالانتهاء. استقبالالتنبيهات HTTP فعلي على127.0.0.1،بلاTelegram أوإيميلحقيقي.

الفحوص تشملسقوطالخدمة واستعادتها،backup قديمة،job متوقفة16دقيقة،disk probe صناعية81%،5xx حقيقية منمسارtest فقط،وشهادةTLS موثوقةللتجربة تنتهيخلال5أيام معverification شغالة. فحصالديسك الحقيقي منفصل فيintegration؛لم نملأديسكالجهاز. الرسائل الواصلة تُفحص للتأكدمنغيابbearer token وكلمةمرورKuma. المتصفح يسجلدخولًا فعليًا ويصورdashboard.

الأدلة مولدة في`evidence/implementation/monitoring.json` و`monitoring-dashboard.png`. اختباراتmonitoring integration تثبتالعزل ورفضالجلسةبدلالتوكن وتنقيحlog messages وchild bindings وstartup failures. الاختبارات الجديدة ضمن`verify:local`،وCI تجهزKuma وتعيدالتمرين،لكنلاremote حاليًا لإثباتتشغيلCI خارجي.

`npm run test:deploy -- --config-only` يثبتCompose والعزل والـrotation منغيرالاتصالبـDocker engine. تقريره`deployment-config.json` حالته`CONFIG_VERIFIED_RUNTIME_NOT_RUN`؛لايحل محلتمرينstack/gateway. Docker المحلي متعطل منL04،ولم نعيدمحاولةتشغيله أوreset بياناته. تشغيلCompose علىسيرفر،والـTLS الحقيقي والتنبيه علىالقناةالحقيقية،تظلBLOCKED_OWNER حتىتجهيزالموارد.
