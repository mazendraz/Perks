# Pilot runbook — awaiting owner approval

This is the operator procedure for the implemented local system. It does not authorize launch or certify a physical device test. Hosting, devices, legal text, prices and a named reviewer remain approval gates. See [DEVICE-TEST](DEVICE-TEST.md) and [PRIVACY-AND-PILOT](PRIVACY-AND-PILOT.md).

## تجهيز محل في 15 دقيقة

الوقت هدف للتجهيز بعد توفر الحسابات واللوجو وشروط المكافأة وبيئة جاهزة؛ مش قياس اتعمل على محل حقيقي.

| الوقت | المسؤول | الخطوة والنتيجة المطلوبة |
|---|---|---|
| 0–3 دقائق | سوبر أدمن | أنشئ المحل وبيانات صاحبه وإيميل وباسورد لحساب العمل. راجع الفرع والمنطقة الزمنية ووسيلة التواصل. استخدم Preview للتأكد من اكتمال البيانات. |
| 3–6 دقائق | صاحب المحل | ارفع اللوجو، اختر قالب كافيه/مطعم/حلاق، واضبط الألوان بالاختيار أو HEX. راجع حجم اللوجو وخلفيته وعدد وشكل الأختام، ثم انشر بعد المعاينة. |
| 6–8 دقائق | صاحب المحل | راجع المكافأة وعدد الأختام والصلاحية وشروط الاستحقاق. تغيير البرنامج المنشور يعمل نسخة جديدة؛ لا يغير حقوق العضويات القديمة بأثر رجعي. |
| 8–10 دقائق | صاحب المحل | أنشئ الكاشير بإيميل وباسورد ودور وفروع محددة. اختبر دخوله على الوردية وعدم ظهور إدارة المنصة أو محلات أخرى. |
| 10–12 دقيقة | سوبر أدمن | بعد التأكد من دفع حقيقي فقط، سجل المبلغ والطريقة والمرجع والفترة في الاشتراك. راجع المدة والمنطقة الزمنية. |
| 12–15 دقيقة | صاحب المحل والكاشير | أنشئ قطعة QR للفرع، نزّلها واطبعها بجوار الكاشير. اختبر التسجيل والختم والصرف والتجديد بعميل اختبار منفصل. سجّل نتيجة الجهاز الفعلي قبل التسليم. |

حسابات العمل ينشئها المسؤول المختص؛ الدخول واحد بالإيميل والباسورد ويوجه للدور. العميل الجديد يدخل من QR المحل بالاسم والرقم وموافقة الشروط، ثم يفتح كارته من جهازه. مسؤول المنصة على staging/production يستخدم حماية التحقق الإضافية المقررة في L01. لا تبعت باسوردًا أو رابط استرجاع في جروب دعم مشترك.

## تدريب الكاشير

1. اختار الفرع وافتح الوردية. اطلب QR الشخصي من العميل، أو راجع طلب الختم الظاهر وعملية الشراء.
2. سجّل مرجع الإيصال المتفق عليه كما هو؛ نفس الشراء لا يتسجل تاني بمرجع مختلف. سكان قطعة المحل وحده لا يضيف ختمًا.
3. اتأكد من تأكيد النجاح والرصيد. لو الرد اتأخر استخدم استعادة نتيجة العملية/إعادة المحاولة الموجودة بالشاشة، ولا تنشئ شراءً جديدًا لتجربة الحظ.
4. عند اكتمال الأختام، اطلب صرف المكافأة. العميل يؤكد من موبايله، وبعد إتمام الكاشير للصرف تبدأ دورة جديدة. أي رصيد زائد يستمر حسب البرنامج.
5. انتهاء الاشتراك أو إيقاف الكسب يمنع أختامًا جديدة؛ مشاهدة الكارت وصرف مكافأة مكتسبة سارية يظلان متاحين. التعليق الأمني للمحل مسار مستقل.
6. للتصحيح استخدم العملية الأصلية والمسار التعويضي. الحالات غير الآمنة تدخل `needs_review`؛ ممنوع تعديل الرصيد أو حذف Ledger يدويًا.

## متابعة يومية ودعم المحل

ابدأ من Preview في إدارة المحلات: راجع الكارت والبراند وحساب المالك والفريق والعملاء والاشتراك، ثم افتح التفاصيل المناسبة. لا تشارك جلسة المسؤول مع المحل. راجع آخر نشاط والعمليات المعلقة وطلبات المراجعة؛ صاحب المحل يراجع عمليات الوردية ومراجع إيصالاتها.

راقب readiness ونسخة الباك أب ومدة انتظار jobs ومساحة القرص وأخطاء الخدمة من لوحة التشغيل الخاصة. قناة التنبيه الفعلية ومواعيد التغطية لم تُعتمد. لو النسخة قديمة أو ظهر Ledger drift أوقف التوسع وارجع للتحقيق والاستعادة، ولا تصحح الأرقام مباشرة.

عند بلاغ سجل المحل والفرع والتوقيت وoperation/request reference والخطوة المتوقعة والنتيجة، مع إخفاء الأرقام الشخصية في الصور. راجع audit والصلاحيات ونتيجة العملية قبل تكرارها. حالة `unknown` بالبريد أو `needs_review` المالية تحتاج تحقيقًا؛ لا blind resend ولا تعويض عشوائي.

أزرار واتساب للمحل والعملاء تجهز رسالة للمراجعة والإرسال اليدوي. تأكد من الرقم وطلب العميل وتفضيلات التسويق؛ الدعم بطلبه ليس حملة. لم يتم إرسال رسائل فعلية تلقائيًا.

## قرارات تحتاج اعتماد المالك

| القرار | الوضع الحالي |
|---|---|
| الشخص المخول لحسم `needs_review` وبديله ومدة الرد | **BLOCKED_OWNER — لم يُحدد** |
| مبالغ الباقات وشروط التحصيل والفواتير | **BLOCKED_OWNER — 450/950/1900 أسعار ديمو غير معتمدة** |
| الجهة المسؤولة ووسيلة الشكاوى والنص القانوني | **BLOCKED_OWNER — مسودات فقط** |
| محلات Pilot والأجهزة وموعد البدء ومعيار الإيقاف | **BLOCKED_OWNER — لا Pilot حقيقي حتى الآن** |

المراجع المخول يراجع الأصل وكل نشاط بعده والمكافآت المصروفة، ويسجل قراره وسببه والمراجع. التصحيح يستخدم المسار التعويضي والتدقيق. لو الحالة لا تدعم تصحيحًا آمنًا في الواجهة تظل معلقة وتُصعّد؛ لا SQL يدويًا على Ledger.

## الاشتراك اليدوي

السوبر أدمن يسجل دفعة مستلمة بالفعل بقيمتها بالجنيه وطريقتها وفترتها ومرجعها. الفترة تشمل يوم النهاية بتوقيت المحل. التسجيل لا يحصّل فلوسًا ولا يصدر فاتورة ضريبية. المالك يرى التاريخ للقراءة فقط.

راجع المبلغ والفترة قبل التأكيد. المرجع النشط المكرر بنفس الطريقة يُرفض. للتصحيح أبطل الدفعة بسبب واضح ثم سجل الصحيحة؛ الأصل والإبطال محفوظان. زر السماح بالكسب لا يتجاوز اشتراكًا منتهيًا، ودفعة مستقبلية لا تسد فجوة غير مدفوعة. وضع الاختبار للمحلات المحلية القديمة ليس إعداد اشتراك تجاري مكتملًا.

## الحذف والاستعادة

العميل يقدر يحذف حسابه بعد تحذير وموافقة صريحة. الحذف يشمل كل كروته ووسائل الوصول، مع إبقاء سجل العمليات بلا اسمه ورقمه. الحساب المختلط مع أي عضوية عمل يحتاج فصلًا ومراجعة بدل حذف هوية موظف.

قبل استعادة باك أب، اتبع [RETENTION](../../deploy/RETENTION.md): احفظ أحدث privacy manifest في مكان مستقل مشفر، واستعد والخدمات مغلقة، ثم أعد تطبيق الحذف ونظف التصديرات الملغاة قبل فتح الخدمة. باك أب قديمة لا تتضمن طلبات حذف أحدث منها.

## NFC and QR at the counter

1. Open **QR and NFC** in the merchant workspace and create a piece for the actual branch. Choose NFC tag if appropriate. Download its QR for print and copy the NFC URL; both refer to the same placement and branch.
2. Write the exact `nfcUrl` (`/p/{code}?src=nfc`) as a standard URL record to an NTAG213/215 using a compatible NFC writing app. Use the actual deployment HTTPS origin. Do not store a customer token, password or a loyalty award inside the tag.
3. Open the tag from a supported iPhone and Android phone. On Android, NFC must be enabled. If the device cannot read the tag, scan the printed QR beside it. Physical reading, camera and installation support must be recorded per device in L08; a working link in Playwright is not a physical NFC test.
4. An existing customer opens their card without another button and requests a stamp. A new customer's registration follows L06B. The cashier reads the customer's personal QR, checks the purchase and records its receipt, then taps Stamp request. A placement scan or NFC tap alone never grants stamps.
5. Keep receipt references consistent across ordinary scanning and request approval. The same purchase must not be entered again under a different reference. Undo requests follow the compensating correction and manager-review flow; they do not erase ledger rows.
6. Record Installed only after placing the piece. Record Physical test only after actually testing it, with device/OS and the observed result. These are operator attestations, not server hardware verification.
7. If a tag or printed piece is lost or replaced, use Replace piece. Confirm the old URL returns unavailable before distributing the replacement. Rewrite the NFC URL and replace the printed QR together.

No NFC writing, installation, WhatsApp sending or physical-device attestation has been performed automatically.

## استرجاع بطلب العميل على واتساب

من وردية الكاشير أو «العملاء والشرائح» عند المالك/المدير افتح «رجّع كارت عميل»،واكتب رقمه كاملًا. راجع الاسم والكارت المخفي رقمه،وأكّد إن العميل طلب الاسترجاع. جهّز الرابط ثم افتح واتساب وراجع الرسالة وابعتها بنفسك لنفس الرقم؛السيرفر لا يرسل. العميل يفتح الرابط ويضغط «افتح الكارت»،مع إغلاق الأجهزة القديمة افتراضيًا. الرابط لمرة واحدة خلال24ساعة. لا تستخدم الرابط في حساب دعم مشترك أوتبعته لرقم بديل. تفاصيل الصلاحيات والحدود في [CUSTOMER-IDENTITY](CUSTOMER-IDENTITY.md). التجربة بين جهازين حقيقيين ما زالتL08.

## حفظ الكارت على الموبايل — الخطوات

على Android/Chrome يظهر زر الحفظ عند توفر تنبيه التثبيت. على iPhone افتح المشاركة في Safari من شريط الأدوات أو قائمة الصفحة، ثم «إضافة للشاشة الرئيسية» وبعدها «إضافة». شكل القوائم يختلف حسب النظام. [دليل Apple](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios).

التطبيق يعرض التذكير أول مرة للكارت، ثم بعد أول ختم لو المستخدم قفل التذكير. تعليمات Safari في شيت مرسوم بهوية Nuqta. بعد كده مفيش تذكير تلقائي إضافي، وزر الحفظ اليدوي يفضل متاحًا. التثبيت الفعلي ما زال مطلوبًا على الجهازين في L08.
