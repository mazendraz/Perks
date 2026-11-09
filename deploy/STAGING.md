# L08 — بيئة staging منفصلة

**BLOCKED_OWNER** للتشغيل: لم يُخترسيرفر أوdomain أوSMTP. الملفاتمتجهزةللمراجعة،ولا يوجدstaging منشورة أوHTTPS حقيقي متحقق. لا تنقلبياناتمازن أوbackup الإنتاج إلىبيئةالاختبار.

`compose.staging.yml` فوق`compose.yml` يفرضAPP_ENV=staging لكلعملياتالتطبيق،ومنثمpassword/Securecookies وMFA المنصة كمافيproduction. مشروع`nuqta-staging` يملكvolumes وشبكاتمختلفة،ومجالproxy172.30.41.0/28 معtrustCIDR واحد مضبوط. لايشاركملفات أوDB أوbackup أوحساباتKuma معproduction. لوحةالمراقبة4302loopback،والـDB بلاhostport.

## مراجعة محلية

```powershell
npm run staging:prepare
npm run test:staging-config
```

الأولينشئ`.local/staging-review/.env.staging` بأسرارمستقلة ولايستبدلملفًاموجودًا. DOMAIN=staging.nuqta.invalid وSMTP=owner-required.invalid قيممراجعةفقط؛ليستمواردجاهزة. لايطبعالأسرار ولايشغّلشيئًا. الثانييشغّل`docker compose config` فقط،بلاengine،ويثبتعدمإعادةاستخدامvolumes/networks/secrets،وAPP_ENV والأصولوالعناوين. التقرير`staging-config.json` حالته`CONFIG_VERIFIED_RUNTIME_NOT_RUN`،وليسقبولنشر.

الافتراضييربطHTTP18080 وHTTPS18443 على127.0.0.1 فقط،فلايزاحم80/443 للإنتاج. لا يمكنفتحالموقعمنالموبايل بهذهالإعدادات،ولايمكنللـACME أنيصدرشهادةعبرها دونingress معتمد. يحتاجCompose2.24.4+ لدعم`!override`؛أمرconfig يرفضالإصداراتغيرالداعمة.

## عند توفير المضيف واعتماد النشر

1. اخترdomain مثل`staging.<الدومين>` ووجّهDNS إلىسيرفرالاختبار. اضبطDOMAIN وPUBLIC_APP_ORIGIN=https://… بالقيمةنفسها،واضبطSMTP معتمدًا للاختبار،وحسابMFA للمنصة. لا تستخدمأسرارproduction.
2. الأفضل لأولقبولسيرفرمنفصل. عليهفقط اضبطSTAGING_HTTP_BIND=80 وSTAGING_HTTPS_BIND=443،معجدارالحمايةوCaddy والباكأب حسب[README](README.md). علىنفسسيرفرproduction اتركloopback،واخترingress/TLS topology واعتمدها قبلأيup؛هذهالطبقةغيرمتنفذةحاليًا.
3. راجعالتكوينبملفالبيئةالخاصعلىالسيرفر: `docker compose --env-file <private-env> -p nuqta-staging -f deploy/compose.yml -f deploy/compose.staging.yml config --quiet`. ملفالبيئةيحملAPP_ENV=staging،والأصلHTTPS والـSMTP الحقيقيالمعتمد.
4. بعدالاعتمادفقطيشغّلالمشغلنفسملفاتCompose بـ`up -d --build`. لا أمرup أوتعديلhost hardening نُفذفيهذهالجولة. اعتمدتهيئةحسابالمنصة حسبRUNBOOK،واصنعمحلاتوأرقاماختبارصناعية منالواجهة. لا تستعملseed الإنتاجأوcredentials اختبارثابتة.
5. اختبرreadiness والعزل وTLS/MFA والدخولللأدوار،وWAL/restore وتنبيهحقيقي،ثمأعدكلرحلات[DEVICE-TEST](../docs/execution/DEVICE-TEST.md) علىالأجهزةالفعلية. افصلSMTP recipients للاختبار عنالعملاءالحقيقيين.

L08-01 تحتاجموافقةفتحquicktunnel ثمتجربةالمالك منموبايله. L08-02 تحتاجالمضيفوالـDNS وTLS والإعداداتوالتشغيلالفعلي. L08-03 تحتاجالأجهزةوسجلنتائجوتذاكرللأخطاء. غيابالاختياراتلايوقفL09 المحليةالمستقلة،ولايسمحببدءL10 أوإعلانGo-Live.
