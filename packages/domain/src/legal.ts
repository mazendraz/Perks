import { createHash } from 'node:crypto';
import type { LegalNotice } from '../../contracts/src/legal.js';
const content = {
  ar: {
    privacy: {
      title: 'الخصوصية',
      sections: [
        {
          title: 'مسودة للتجربة',
          body: 'المحتوى ده مسودة للاختبار المحلي. المراجعة القانونية مطلوبة قبل الإطلاق، بما يشمل قانون حماية البيانات المصري 151 لسنة 2020 والقواعد المطبقة وقت الإطلاق. اسم الجهة المسؤولة ووسيلة التواصل الرسمية لسه محتاجين اعتماد من مالك نقطة. تقدر تطلب المساعدة من المحل أثناء التجربة.',
        },
        {
          title: 'إيه اللي بنحفظه وليه؟',
          body: 'بنحفظ اسمك ورقم موبايلك علشان كارت الولاء واسترجاعه بطلبك. الرقم مش متأكد بكود، والرقم لوحده ما بيفتحش كارتك. بنحفظ سجل الزيارات والأختام والمكافآت وموافقتك على نسخة الشروط اللي شفتها.',
        },
        {
          title: 'الجهاز واسترجاع الكارت',
          body: 'الكارت بيتربط بالمتصفح بملف ارتباط ضروري، محمي من قراءة JavaScript، لمدة متجددة لحد سنة. جلسة الكارت أقصر وبتتجدد من الجهاز. لو غيرت الموبايل، فريق المحل يجهز رابط استرجاع بطلبك، ويراجع الرسالة ويبعتها يدويًا لنفس رقمك على واتساب. الرابط لمرة واحدة خلال 24 ساعة، وبيلغي الأجهزة القديمة افتراضيًا.',
        },
        {
          title: 'مين بيشوف بياناتك؟',
          body: 'الفريق المصرح له بيتابع العملاء والعمليات داخل المحل وفروعه المسموحة. الرقم بيظهر مخفي جزئيًا، إلا بعد البحث الدقيق في شاشة الاسترجاع. إدارة نقطة بتتابع تشغيل النظام والدعم بصلاحيات مستقلة. التسجيل مش موافقة على التسويق؛ تفضيلات التواصل اختيارية وتقدر تغيّرها من كارتك.',
        },
        {
          title: 'الحذف والاحتفاظ',
          body: 'تقدر تطلب حذف حساب العميل من داخل التطبيق. الحذف يشيل الاسم ووسائل التواصل ويلغي الأجهزة والجلسات وروابط الاسترجاع، ويفقدك الوصول لكل كروتك ومكافآتك. أرقام العمليات والأختام بتفضل من غير الاسم والرقم للمراجعة. ملفات التصدير المؤقتة مدتها 24 ساعة، والجلسات المنتهية تُحذف بعد 90 يومًا. سياسة اللوجز 30 يومًا تحتاج تفعيلها على السيرفر قبل الإطلاق. النسخ الاحتياطية المشفرة تتبع مدة احتفاظ يراجعها المالك، والحذف لازم يُعاد تطبيقه عند الاستعادة قبل فتح الخدمة.',
        },
      ],
    },
    terms: {
      title: 'شروط الاستخدام',
      sections: [
        {
          title: 'مراجعة قانونية مطلوبة',
          body: 'دي مسودة للتجربة المحلية، ومش شروط إطلاق معتمدة. بيانات الجهة المسؤولة وسياسة الشكاوى والتواصل والاحتفاظ والالتزامات القانونية لازم تتراجع وتتوافق عليها قبل استخدام بيانات عملاء حقيقيين.',
        },
        {
          title: 'الكارت والمكافأة',
          body: 'كل محل بيحدد شروط برنامجه وعدد الأختام ومكافأته ومدتها. راجع شروط المحل والمكافأة الظاهرة قبل الموافقة. سكان QR أو NFC بيطلب ختمًا بس؛ الختم لازم يعتمد من الكاشير بعد عملية شراء مؤهلة. ما تدخلش نفس الإيصال مرة تانية.',
        },
        {
          title: 'صرف المكافأة',
          body: 'صرف المكافأة يحتاج تأكيد منك على موبايلك. بعد الصرف تبدأ دورة جديدة للكارت، وأي رصيد زائد مستحق بيفضل حسب البرنامج. انتهاء اشتراك المحل يوقف الأختام الجديدة، مع استمرار عرض الكارت وصرف المكافآت المكتسبة السارية. إيقاف المحل لأسباب أمنية ممكن يوقف الخدمة لحين المراجعة.',
        },
        {
          title: 'حافظ على كارتك',
          body: 'ما تشاركش QR الشخصي أو رابط الاسترجاع مع حد. اطلب الاسترجاع من فريق المحل لو غيرت الجهاز. تأكيد الرقم من غير كود معناه إنك مسؤول عن كتابة رقمك صح؛ رقم عميل موجود ما بيديش وصول لكارته.',
        },
        {
          title: 'المساعدة والتعديلات',
          body: 'لو عملية محتاجة مراجعة، اطلب المساعدة من المحل بالمرجع الظاهر للعملية. التصحيحات بتتسجل كعمليات تعويضية، ومش بتمسح السجل الأصلي. أي نسخة شروط جديدة لازم تتعرض بموافقة واضحة، والتسجيل مش اشتراكًا تلقائيًا في رسائل التسويق.',
        },
      ],
    },
  },
  en: {
    privacy: {
      title: 'Privacy',
      sections: [
        {
          title: 'Local test draft',
          body: 'This content is a local testing draft. Legal review is required before launch, including Egypt’s Personal Data Protection Law 151/2020 and the rules applicable at launch. Nuqta’s responsible legal entity and official contact still require owner approval. During testing, ask the shop for help.',
        },
        {
          title: 'What we store and why',
          body: 'We store your name and mobile number for your loyalty card and recovery you request. The number is not verified by a code, and knowing it alone never opens your card. We retain visits, stamps, rewards and your acceptance of the terms version you saw.',
        },
        {
          title: 'Your device and card recovery',
          body: 'A necessary browser cookie links your card to this device. It is protected from JavaScript access and lasts up to a renewable year. A shorter card session renews from that device. If you change phones, shop staff can prepare recovery at your request and manually review and send a WhatsApp message to that same number. The one-use link lasts 24 hours and revokes old devices by default.',
        },
        {
          title: 'Who can access your data',
          body: 'Authorized staff view customers and activity within their shop and permitted branches. Numbers are partially hidden except after an exact search in the recovery screen. Nuqta administrators manage operations and support through separate permissions. Registration does not opt you into marketing; contact preferences are optional and can be changed from your card.',
        },
        {
          title: 'Deletion and retention',
          body: 'You can request customer-account deletion inside the app. Deletion removes your name and contact details and revokes devices, sessions and recovery links. You lose access to all cards and rewards. Transaction and stamp records remain without your name or number for review. Temporary exports last 24 hours; expired sessions are deleted after 90 days. The 30-day log policy needs host activation before launch. Encrypted backups follow an owner-reviewed retention period; deletions must be reapplied after a restore before reopening service.',
        },
      ],
    },
    terms: {
      title: 'Terms of use',
      sections: [
        {
          title: 'Legal review required',
          body: 'These are local testing terms, awaiting approval for launch. The responsible entity, support and complaints process, retention and legal obligations require review and approval before handling real customer data.',
        },
        {
          title: 'Your card and reward',
          body: 'Each shop sets its program terms, stamp target, reward and validity. Review the shop and reward terms shown before accepting. A QR scan or NFC tap only requests a stamp; a cashier must approve it after an eligible purchase. Do not submit the same receipt again.',
        },
        {
          title: 'Redeeming a reward',
          body: 'Redemption requires your confirmation on your phone. A new card cycle starts after redemption, retaining any eligible surplus according to the program. An expired shop subscription stops new stamps while allowing card viewing and redemption of valid earned rewards. A security suspension may pause service pending review.',
        },
        {
          title: 'Keep your card safe',
          body: 'Do not share your personal QR or recovery link. Ask shop staff for recovery when changing devices. With no code verification, you are responsible for entering your own number correctly; entering an existing customer’s number never grants access to their card.',
        },
        {
          title: 'Help and changes',
          body: 'Ask the shop for help using the transaction reference when an operation needs review. Corrections use compensating transactions and preserve the original record. New terms must be shown for explicit acceptance. Registration never automatically subscribes you to marketing messages.',
        },
      ],
    },
  },
};
export function legalNotice(locale: 'ar' | 'en'): LegalNotice {
  const docs = content[locale],
    version = 'pilot-legal-draft-v3:' + locale;
  const text = [docs.privacy, docs.terms]
    .map((doc) => [doc.title, ...doc.sections.map((s) => s.title + '\n' + s.body)].join('\n\n'))
    .join('\n\n');
  return {
    locale,
    reviewRequired: true,
    updatedAt: '2026-11-10',
    ...docs,
    acceptance: { version, hash: createHash('sha256').update(text).digest('hex'), text },
  };
}
