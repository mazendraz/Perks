export type MailKind =
  | 'invitation'
  | 'password_reset'
  | 'password_changed'
  | 'merchant_welcome'
  | 'onboarding_payment_confirmed'
  | 'onboarding_payment_rejected'
  | 'onboarding_receipt_submitted';
export type MailLocale = 'ar' | 'en';
export interface MailData {
  link?: string;
  /** Business or shop name. */
  business?: string;
  /** Why a transfer was rejected, written by the reviewer. */
  reason?: string;
  /** The rejected shop was already live and is now paused. */
  suspended?: boolean;
  /** The confirmed shop is already published (otherwise the owner still has to publish it). */
  live?: boolean;
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
type Copy = { title: string; message: string; action: string; detail?: string };
function copy(kind: MailKind, ar: boolean, data: MailData): Copy {
  const shop = data.business || (ar ? 'محلك' : 'your shop');
  switch (kind) {
    case 'invitation':
      return {
        title: ar ? 'دعوتك للمحل جاهزة' : 'Your business invitation',
        message:
          (ar ? 'عندك دعوة تنضم لفريق ' : 'You have been invited to join ') +
          (data.business || (ar ? 'المحل' : 'the business')) +
          '.',
        action: ar ? 'قبول الدعوة' : 'Accept invitation',
      };
    case 'password_reset':
      return {
        title: ar ? 'اختار باسورد جديد' : 'Reset your password',
        message: ar
          ? 'لو طلبت تغيير الباسورد، افتح الرابط واختار واحد جديد. الرابط مؤقت وبيشتغل مرة واحدة.'
          : 'If you requested a password reset, open this temporary, single-use link and choose a new password.',
        action: ar ? 'تغيير الباسورد' : 'Reset password',
      };
    case 'password_changed':
      return {
        title: ar ? 'باسورد حسابك اتغيّر' : 'Your password was changed',
        message: ar
          ? 'باسورد حسابك اتغيّر، والجلسات القديمة اتقفلت. لو مش أنت اللي عملت ده، اطلب استعادة حسابك وراجع مسؤول الحساب.'
          : 'Your account password was changed and previous sessions were signed out. If this was not you, recover your account and contact your account administrator.',
        action: ar ? 'استعادة الحساب' : 'Recover account',
      };
    // No greeting by name: sign-up is unauthenticated, so a name typed there must never be mailed
    // to whatever address was entered with it.
    case 'merchant_welcome':
      return {
        title: ar ? 'أهلًا بيك! حسابك جاهز' : 'Welcome! Your account is ready',
        message: ar
          ? 'فاضل خطوة واحدة: اختار باسورد لحسابك من الزرار اللي تحت، وبعدها هتكمّل تجهيز محلك على طول. الرابط بيشتغل مرة واحدة ولمدة 24 ساعة.'
          : 'One step left: choose a password with the button below, then carry straight on with setting up your shop. The link works once, for 24 hours.',
        action: ar ? 'اختار الباسورد وكمّل' : 'Choose a password',
      };
    case 'onboarding_payment_confirmed':
      return data.live
        ? {
            title: ar ? 'التحويل اتأكد' : 'Payment confirmed',
            message: ar
              ? `استلمنا تحويل اشتراك ${shop}، واشتراكك شغال. تقدر تكمّل من لوحة المحل.`
              : `We received the subscription transfer for ${shop} and your subscription is active. Carry on from your shop dashboard.`,
            action: ar ? 'افتح لوحة المحل' : 'Open shop dashboard',
          }
        : {
            title: ar ? 'التحويل اتأكد' : 'Payment confirmed',
            message: ar
              ? `استلمنا تحويل اشتراك ${shop}. فاضل تنشر محلك عشان زباينك يبدأوا ياخدوا أختام.`
              : `We received the subscription transfer for ${shop}. Publish your shop so customers can start collecting stamps.`,
            action: ar ? 'انشر محلك' : 'Publish your shop',
          };
    case 'onboarding_payment_rejected':
      return {
        title: ar ? 'مقدرناش نأكد التحويل' : 'We could not confirm your transfer',
        message: data.suspended
          ? ar
            ? `مقدرناش نأكد تحويل اشتراك ${shop}، فالمحل اتوقف مؤقتًا لحد ما بيانات التحويل تتصحّح. كروت العملاء وأختامهم محفوظة.`
            : `We could not confirm the subscription transfer for ${shop}, so the shop is paused until the transfer details are corrected. Customer cards and stamps are kept.`
          : ar
            ? `مقدرناش نأكد تحويل اشتراك ${shop}. صحّح بيانات التحويل عشان نكمّل تفعيل محلك.`
            : `We could not confirm the subscription transfer for ${shop}. Correct the transfer details so we can finish activating your shop.`,
        detail: data.reason ? (ar ? 'السبب: ' : 'Reason: ') + data.reason : undefined,
        action: ar ? 'صحّح بيانات التحويل' : 'Correct transfer details',
      };
    case 'onboarding_receipt_submitted':
      return {
        title: ar ? 'إيصال InstaPay جديد للمراجعة' : 'New InstaPay receipt to review',
        message: ar
          ? `${shop} رفع إيصال تحويل الاشتراك ومستني المراجعة.`
          : `${shop} uploaded a subscription transfer receipt that is waiting for review.`,
        action: ar ? 'راجع التحويل' : 'Review transfer',
      };
  }
}
export function mailTemplate(kind: MailKind, locale: MailLocale, data: MailData) {
  const ar = locale === 'ar';
  const { title, message, action, detail } = copy(kind, ar, data);
  const footer = ar
    ? 'Perks — الرسالة دي لحسابك فقط. ما تشاركش رابطها.'
    : 'Perks — this message is for your account. Keep its link private.';
  const link = data.link;
  if (link && !/^https?:\/\//.test(link)) throw new Error('Mail links must use HTTP or HTTPS.');
  const text = [
    title,
    message,
    ...(detail ? [detail] : []),
    ...(link ? [action + ': ' + link] : []),
    footer,
  ].join('\n\n');
  const html = `<!doctype html><html lang="${locale}" dir="${ar ? 'rtl' : 'ltr'}"><body style="margin:0;background:#f5f5f1;color:#181b38;font-family:Arial,sans-serif"><main style="max-width:560px;margin:32px auto;padding:32px;background:#fff;border-radius:20px"><p style="color:#181b38;font-weight:bold;letter-spacing:1px">PERKS</p><h1 style="font-size:26px">${escape(title)}</h1><p style="font-size:16px;line-height:1.8">${escape(message)}</p>${detail ? `<p style="font-size:16px;line-height:1.8;padding:12px 16px;background:#fff4f2;border-radius:12px">${escape(detail)}</p>` : ''}${link ? `<p style="margin:28px 0"><a href="${escape(link)}" style="display:inline-block;background:#181b38;color:#fff;text-decoration:none;padding:14px 22px;border-radius:12px">${escape(action)}</a></p><p style="font-size:12px;overflow-wrap:anywhere" dir="ltr">${escape(link)}</p>` : ''}<p style="font-size:12px;color:#6b6e80">${escape(footer)}</p></main></body></html>`;
  return { subject: title + ' · Perks', text, html };
}
