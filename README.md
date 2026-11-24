# Perks

> اسم المنتج **Perks** (اتعتمد 2026-11-10). "Nuqta" اسم داخلي للكود بس. الهوية والألوان واللوجو في [docs/brand](docs/brand/README.md).

تطبيق تطوير محلي متصل بخادم وقاعدة PostgreSQL، فيه أربع مساحات عمل ونظام ولاء محفوظ. ملفات الـDemo الأصلية محفوظة في standalone. **النسخة لسه مش إطلاقًا تجاريًا.**

- [معاينة المحل وإدارة الحسابات وواتساب](docs/execution/ACCOUNT-PREVIEW-AND-CONTACT.md)
- [تصميم وعدد الأختام وقوالب الكافيه والمطعم والحلاق](docs/execution/STAMP-DESIGN.md)
- [اللوجو والحسابات والقوالب وQR وملف متابعة المحل](docs/execution/ONBOARDING-AND-SUPPORT.md)
- [تجربة مازن من أول شركة](docs/execution/MANUAL-DEMO.md)
- [حالة المراحل والأدلة](docs/execution/STATUS.md)
- [اللي اتنفذ وحدوده](docs/execution/IMPLEMENTATION.md)
- [دليل التشغيل](docs/execution/RUNBOOK.md)
- [تجهيز محل وتدريب الكاشير ومراجعة المشاكل](docs/execution/PILOT-RUNBOOK.md)
- [الخصوصية والاشتراك اليدوي وحدود القبول](docs/execution/PRIVACY-AND-PILOT.md)
- [الاحتفاظ بالبيانات وإعادة الحذف بعد الاستعادة](deploy/RETENTION.md)
- [الخطة والـBacklog](docs/execution/README.md)

## التشغيل السريع — PowerShell

المتطلبات: Node 24 وnpm وPostgreSQL 17 binaries. أداة db:up تستخدم cluster مستقلة على 55432، ولا تعدل أي PostgreSQL أخرى على الجهاز.

```powershell
# من جذر المستودع (المجلد اللي فيه package.json)
npm ci
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

افتح [Nuqta](http://127.0.0.1:5173). وفي terminal تانية شغّل Worker:

```powershell
npm run worker:dev
```

الفريق والمنصة (المالك والمدير والكاشير والإدارة) بيدخلوا بالإيميل وكلمة المرور. حسابات التطوير الأساسية موجودة في .local/seed-logins.txt بعد db:seed، والباسوردات الأولية عشوائية والملف خاص. حسابات المالك والكاشير الجديدة ينشئها المسؤول من تجهيز المحل أو صفحة الفريق. العميل مالوش إيميل ولا باسورد (D40–D42): بيمسح QR المحل أو يفتح لينك الانضمام، يكتب اسمه ورقم موبايله ويوافق على الشروط، والكارت بيتربط بالجهاز ده. لو غيّر الجهاز بيرجّع الكارت من الـWallet أو من الكاشير.

تجربة مازن المنفصلة: افتح http://localhost:4180/platform،الإيميل mazen@nuqta.test والباسورد الأولي في .local/manual-demo/login.txt. خطواتها في [تجربة أول شركة](docs/execution/MANUAL-DEMO.md).

بعد تشغيل Web/API/DB، نفّذ `npm run verify:local` للفحص الكامل. مفيش credentials خارجية مطلوبة للمسار المحلي. اختبار E2E يضيف بيانات QA صناعية. للإيقاف: Ctrl+C للخدمات، ثم `npm run db:down` لإيقاف cluster الخاصة بـNuqta مع حفظ البيانات.

## الـDemo الأصلي — مرجع P00

وقت مراجعة P00 كان الموجود 6 exports مستقلة في `standalone/`. دي نسخة Demo تفاعلية، مش تطبيق SaaS متصل بخادم. أول مراجعة وخطة التنفيذ بتاريخ **2026-11-07 — Africa/Cairo** موجودة في [docs/execution/README.md](docs/execution/README.md).

تشغيل الـDemo من PowerShell، من جذر المجلد:

```powershell
node tools/serve-demo.cjs
```

افتح [Demo Launcher](http://127.0.0.1:4173/). للإيقاف `Ctrl+C`. محتاج Node.js؛ مفيش تثبيت packages للـDemo. البيانات التجريبية محفوظة في متصفحك تحت `nuqta-demo-v2`، والأربع واجهات على نفس الـorigin بتشاركها. استخدم نفس hostname وport؛ `localhost` و`127.0.0.1` مخازن منفصلة. إعادة ضبط التجربة بتمسح بيانات التجربة في كل tabs على نفس الـorigin.

ملفات `standalone/` محفوظة زي ما اتسلّمت. أدوات الفحص بتفك الكود المضمن في `docs/execution/evidence/extracted/` للقراءة والتتبع فقط؛ المخرجات دي مش سورس التطبيق التجاري. المجلد الأصلي مفيهوش `.git`؛ مفيش commits أوremote اتعملوا في التسليم ده.
