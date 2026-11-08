# Integrations

> تحديث التنفيذ: وصف P00 والـMock في هذا الملف يوثق الأصول عند مراجعتها. السورس الحالي المتصل وحدود قبوله في [IMPLEMENTATION](IMPLEMENTATION.md) و[STATUS](STATUS.md). جدول المراحل هنا خطة قبول، مش إعلان اكتمال إنتاجي.


آخر مراجعة للمصادر العامة: **2026-11-07**. مفيش حساب اتفتح أوcredential اتقرت أوعملية مدفوعة اتنفذت. حالات `ready` الموجودة في الـDemo كلها Seed. المتطلبات دي للتنفيذ المقبل، والجاهزية التجارية تحتاج دليل على حساب الشركة ونموذج الإصدار الفعلي.

## حالات الجاهزية

لكل provider ولكل merchant سجل مستقل: `not_configured → awaiting_authorization → testing → ready`، مع `action_required / degraded / disabled`. نفصل قدرات `web_card`, `pass_issue`, `pass_update`, `wallet_user_notification`, `marketing_send`. سلامة حساب المنصة مش بتخلي كل التجار جاهزين تلقائيًا. نحفظ آخر اختبار وبيئته، والحساب المفوّض، وحالة الشهادة، وآخر خطأ من غير أسرار. زر الإضافة مايتفعّلش قبل تحقق القدرة.

| التكامل | الحالي | اختبار مطلوب | بوابة الإنتاج وصاحبها | Phase |
|---|---|---|---|---|
| Apple Wallet | toast وحالات ومهام محاكاة | pass موقعة على iPhone مع registration/update | مسار إصدار مفوّض وbrand rights وشهادات؛المالك وTech | P10 |
| Google Wallet | Seed جاهزية فقط | issuer Demo Mode وclass/object/save/update | publishing access وربط كل تاجر بالحساب المناسب؛المالك | P10 |
| NFC URL | material records وتعليمات | كتابة تاج وقراءته من جهاز تاني وQR بديل | هاردوير وميزانية ودليل تركيب؛Ops | P08 |
| Email Auth/invites | OTP ثابت ودعوات محلية | mail catcher ثم مزود test | sender/domain verification وحدود إساءة الاستخدام؛المالك | P01/P02 |
| Web Push | مش موجود | service worker وpermission flow على HTTPS | توافق الأجهزة وموافقة العميل وإلغاء الاشتراك؛Tech | P11 |
| WhatsApp/SMS | channel flags وأرقام إرسال مصطنعة | test assets وwebhook fixtures | ملكية الحساب والرقم،قوالب/sender واعتماد وتكلفة؛المالك | P11 |
| Payments | تغيير invoice إلى paid في المخزن | sandbox وsigned webhook replay | أهلية الكيان والبلد والعملة والتحصيل المتكرر؛المالك | P12 |
| Managed Auth | مش موجود | adapter وlocal test identities | region/cost/MFA/recovery؛Tech والمالك | P01 |
| Object Storage | logo boolean فقط | private upload وownership/type checks | tenant paths وscan وsigned downloads؛Tech | P02 |
| Monitoring | browser console فقط | logs/traces محلية من غير أسرار | alerts وon-call وretention؛Ops | P01/P09/P13 |

## Apple Wallet

Apple بتسمح بتوزيع passes من الويب من غير native app، وبتحتاج توقيع بشهادة Apple مرتبطة بحساب Developer. انتهاء الشهادة يمنع توقيع أوتحديث جديد؛pass المثبت مش بيبطل لمجرد انتهاء الشهادة، والـrevocation حالة مختلفة. ده محتاج renewal وrotation واختبار تحديث فعلي. [المصدر الرسمي](https://developer.apple.com/wallet/get-started/).

شروط Apple بتفرق بين pass الجهة المالكة اللي فيها علامة طرف ثالث بتفويض مناسب، وبين توقيع pass لطرف ثالث، وبتنظم العمل مع Service Provider. **استنتاج التنفيذ:** حساب Nuqta مش تصريح تلقائي لأي علامة، وبرضه مش مثبت إن كل تاجر لازم حساب مستقل. نراجع مسارين: إصدار passes تخص Nuqta بعلامات مفوّضة لو النموذج مؤهل، أوتشغيل كـService Provider لجهة إصدار مفوّضة بحساب وشهادة مناسبين. قبل الإنتاج نوثّق issuer ومالك Pass Type ID وحقوق العلامة ومسار إدارة المفاتيح، ونطلب توضيح من Apple عند الحاجة. [Section2.9 وAttachment5](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/).

فنيًا: adapter يصدر `.pkpass` بـserial ثابت، وtoken فريدة لكل pass، ويدعم تسجيل/إلغاء تسجيل الأجهزة وجلب التحديثات حسب البروتوكول. signing key تفضل في الخادم. outbox بعد commit يحدث pass بـrevision أحدث فقط. pass أوbarcode لوحده مش إثبات كافي لصرف مكافأة؛يلزم holder challenge. [مرجع بروتوكول التحديث](https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes) احتاج JavaScript لعرض النص وقت الفحص؛مراجعة تفاصيل البروتوكول كاملة جزء من P10.

Apple NFC passes خارج النطاق الأول؛NFC URL tag حاجة مختلفة. نستخدم badge وأصول Add to Apple Wallet الرسمية بعد إثبات الجاهزية.

## Google Wallet

المسار يحتاج issuer account وcredentials وPasses Class ثمObject للعضوية. الحساب الجديد يبدأ Demo Mode لحسابات الاختبار؛النشر العام يحتاج publishing access بعد استكمال business profile وclass وأدلة pass. [Onboarding](https://developers.google.com/wallet/retail/loyalty-cards/getting-started/onboarding-guide)،[Publishing access](https://developers.google.com/wallet/retail/loyalty-cards/test-and-go-live/request-publishing-access).

Google بيوثّق parent account مع issuers متعددة وبدرجات فصل مختلفة للـservice accounts،وبيذكر aggregator بيحتفظ بـclasses لعدة تجار. **القرار المقترح:** نفحص aggregator أوparent-managed issuers بحسب الحساب والتفويض؛لا نفرض حسابًا منفصلًا لكل تاجر ولاcredential مشتركة للجميع. نحفظ mapping صريح لكل merchant/provider،وclass لكل merchant/program version،وobject ID ثابت للعضوية. [Wallet FAQ](https://developers.google.com/wallet/docs/faq)،[تعريف aggregator](https://developers.google.com/wallet/smart-tap/introduction/collection-identifiers). Smart Tap نفسه خارج النطاق،ووجود النموذج في الوثائق مش موافقة لحساب Nuqta.

التنفيذ يشمل server REST وsigned save flow وupsert آمن وreconciliation بعد timeout وحماية من تحديث أقدم. مجرد تحديث Object لا يثبت وصول تنبيه تسويقي؛قدرة التنبيهات تتراجع حسب pass type والوثائق الحالية وقت P10/P11،من غير وعد push عام لكل حملة.

## QR وNFC

التاج يفتح `/p/{placementCode}`. كل قطعة لها code عشوائية وتاريخ وإلغاء واستبدال مستقل. الرابط الملغي يعرض حالة واضحة أوصفحة عامة آمنة،ولا يمنح أختامًا أوزيارة مؤكدة. أول دورة تحتاج enrollment QR حقيقي فقط؛التصنيع والشحن وNFC بعدين.

نستخدم QR encoder فعلي مع اختبار encode/decode وquiet zone ومسح مادي؛QRPAT الحالية زخرفية. Ops تكتب NDEF URL بهاردوير متوافق،وتقرأ التاج من جهاز تاني قبل التثبيت،وتسجل الجهاز والوقت والمكان والمنفذ. مايتعملش lock نهائي قبل قبول الفحص. مفيش شراء هاردوير اتعمل؛التكلفة تتعرض قبل الطلب.

## الرسائل والموافقات

الأحداث: reward unlocked/redeemed،inactivity،promotions،نهاية الكسب،وقرب انتهاء المكافأة. domain event ينتج intent بعد commit. worker يعيد فحص consent وopt-out والميزانية وحدود التكرار وجاهزية القناة **وقت الإرسال**. قبول الشروط منفصل عن التسويق؛القنوات اختيارية ومقفولة افتراضيًا. تحديث بيانات Wallet منفصل عن إرسال حملة.

delivery unique على event+recipient+channel+template version. `accepted` مختلف عن `delivered`،والـcallbacks ممكن تتكرر أويختلف ترتيبها. timeout بعد قبول محتمل يتحول `unknown`؛نعمل lookup/reconciliation أومراجعة بشرية،من غير resend مدفوع تلقائي. budget reservation تتسجل قبل الإرسال وتتسوّى بعد النتيجة.

WhatsApp محتاج تحديد ملكية WABA والرقم والتفويض والقوالب وسياسات الموافقات والتكلفة. **المتطلبات الدقيقة لسه محتاجة تحقق:** [صفحة Meta الرسمية](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started) رجّعت Not Logged In وقت الفحص. مفيش سعر أونافذة إرسال ثابتة اعتمدناها من مصدر ثانوي. P11-01 تراجع الوثائق المتاحة لحساب الشركة وتوثق المسار المؤهل. اختيار Email/SMS/payment provider يتوقف على الكيان والبلد والخصائص والتكلفة،ومش مطلوب لبداية local development.

## أسماء الإعدادات المطلوبة مستقبلًا

الـDemo مفيهوش env requirements. `DEMO_PORT` متغير للـstatic server المضاف. التالي **أسماء مقترحة فقط**،مش قيم مقروءة من الجهاز؛الأسرار في secret manager وreferences معزولة حسب الحساب والتاجر.

| Scope | أسماء فقط |
|---|---|
| Core | `APP_ENV`, `PUBLIC_APP_ORIGIN`, `DATABASE_URL`, `DATABASE_MIGRATOR_URL`, `SESSION_SECRET_REF`, `DATA_ENCRYPTION_KEY_REF`, `LOG_LEVEL` |
| Auth | `AUTH_PROVIDER`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URL`, `AUTH_SERVER_CREDENTIAL_REF`, `AUTH_EMAIL_FROM` |
| Storage | `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY_REF`, `OBJECT_STORAGE_SECRET_KEY_REF` |
| Apple | `APPLE_TEAM_ID`, `APPLE_PASS_TYPE_ID`, `APPLE_SIGNING_CERT_SECRET_REF`, `APPLE_SIGNING_KEY_SECRET_REF`, `APPLE_KEY_PASSPHRASE_SECRET_REF`, `APPLE_WWDR_CERT_REF`, `APPLE_PASS_TOKEN_KEY_REF` |
| Google | `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_SECRET_REF`, `GOOGLE_WALLET_ALLOWED_ORIGINS` |
| Messaging | `EMAIL_PROVIDER`, `EMAIL_API_KEY_REF`, `EMAIL_WEBHOOK_SECRET_REF`, `SMS_PROVIDER`, `SMS_API_KEY_REF`, `SMS_SENDER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN_REF`, `META_APP_SECRET_REF`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN_REF`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY_REF` |
| Billing/Ops | `BILLING_PROVIDER`, `BILLING_API_KEY_REF`, `BILLING_WEBHOOK_SECRET_REF`, `ERROR_TRACKING_DSN`, `OTEL_EXPORTER_ENDPOINT`, `BACKUP_STORAGE_SECRET_REF` |

## التكلفة والقرارات الخارجية

قبل أي شراء أواشتراك: نعرض اسم المزود والخطة،ورسوم البداية والشهر والاستخدام،والعملة والضريبة المفترضة والحدود والإلغاء وbudget cap. أسعار الـDemo مش أسعار معتمدة. نقص موافقة مزود يوقف قدرته فقط؛تطوير الولاء على الويب يكمل. لما القدرة تتأهل نحدّث STATUS بمصدر الموافقة وبيئة وتاريخ اختبارها.


## جاهزية التنفيذ الحالي

مؤكد من المالك: مفيش حسابات خارجية. البريد الحالي local sink، والتخزين المحلي يعيد ترميز الصور، وmanaged Auth لم يكتمل كتدفق منتج خارجي. Apple/Google Wallet وWhatsApp/SMS/Web Push والمدفوعات غير مفعلة؛ لا توجد passes موقعة أورسائل مدفوعة أوفواتير محصلة. آخر مراجعة للوثائق الرسمية في نفس الجلسة: [Apple identifiers/certificates](https://developer.apple.com/help/account/capabilities/create-wallet-identifiers-and-certificates)، [Google issuer onboarding](https://developers.google.com/wallet/retail/loyalty-cards/getting-started/issuer-onboarding)، [Google publishing](https://developers.google.com/wallet/retail/loyalty-cards/test-and-go-live/request-publishing-access)، [Google signed issuance](https://developers.google.com/wallet/retail/loyalty-cards/web). مسار الإصدار وتفويض كل علامة يحتاجان تحققًا من حسابات فعلية قبل كتابة واعتبار adapter مؤهل للإنتاج.
