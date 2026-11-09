# Pilot runbook — draft

This draft records the NFC/QR procedure required by L06A. Shop onboarding, daily operations, commercial settings and the owner-approved review responsibilities are completed in L09. It does not authorize a production launch or certify a physical device test.

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
