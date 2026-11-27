export type MailKind =
  | 'invitation'
  | 'password_reset'
  | 'password_changed'
  | 'merchant_welcome'
  | 'email_verification'
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
  /** The transfer paid a renewal rather than the first month. */
  renewal?: boolean;
  /** The six-digit email verification code. */
  code?: string;
  /** Public site origin, for the logo image. Without it the header shows the name in text. */
  origin?: string;
}

/** Perks brand: Midnight Navy text and buttons, Electric Lime accents, Off-white page. */
const NAVY = '#181B38';
const LIME = '#CBFF64';
const PAPER = '#F5F5F1';
const MUTED = '#5B5F76';

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
type Copy = { title: string; message: string; action: string; detail?: string; note?: string };
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
        note: ar
          ? 'لو مش أنت اللي طلبت، تجاهل الرسالة دي وباسوردك هيفضل زي ما هو.'
          : 'If you did not ask for this, ignore this email and your password stays as it is.',
      };
    case 'password_changed':
      return {
        title: ar ? 'باسورد حسابك اتغيّر' : 'Your password was changed',
        message: ar
          ? 'باسورد حسابك اتغيّر، والجلسات القديمة اتقفلت. لو مش أنت اللي عملت ده، اطلب استعادة حسابك وراجع مسؤول الحساب.'
          : 'Your account password was changed and previous sessions were signed out. If this was not you, recover your account and contact your account administrator.',
        action: ar ? 'استعادة الحساب' : 'Recover account',
      };
    case 'email_verification':
      return {
        title: ar ? 'كود تأكيد الإيميل' : 'Your verification code',
        message: ar
          ? 'اكتب الكود ده في صفحة التسجيل عشان نتأكد إن الإيميل ده بتاعك. الكود شغال 10 دقايق ومرة واحدة بس.'
          : 'Enter this code on the sign-up page to confirm this email is yours. It works once, for 10 minutes.',
        action: '',
        note: ar
          ? 'ما تشاركش الكود مع حد، وفريق Perks عمره ما هيطلبه منك. لو مش أنت اللي سجّلت، تجاهل الرسالة.'
          : 'Never share this code; the Perks team will never ask for it. If you did not sign up, ignore this email.',
      };
    // No greeting by name: sign-up is unauthenticated, so a name typed there must never be mailed
    // to whatever address was entered with it.
    case 'merchant_welcome':
      return data.link?.includes('/reset-password/')
        ? {
            // Queued before codes replaced the welcome link (072): it still carries that link.
            title: ar ? 'أهلًا بيك! حسابك جاهز' : 'Welcome! Your account is ready',
            message: ar
              ? 'فاضل خطوة واحدة: اختار باسورد لحسابك من الزرار اللي تحت، وبعدها هتكمّل تجهيز محلك على طول. الرابط بيشتغل مرة واحدة ولمدة 24 ساعة.'
              : 'One step left: choose a password with the button below, then carry straight on with setting up your shop. The link works once, for 24 hours.',
            action: ar ? 'اختار الباسورد وكمّل' : 'Choose a password',
          }
        : {
            title: ar ? 'أهلًا بيك في Perks!' : 'Welcome to Perks!',
            message: ar
              ? 'إيميلك اتأكد وحسابك جاهز. كمّل تجهيز محلك: اسم المحل، وكارت الولاء، والباقة. أول ما تبعت إيصال InstaPay محلك هيشتغل على طول.'
              : 'Your email is confirmed and your account is ready. Finish setting up your shop: its name, loyalty card and plan. Your shop goes live as soon as you send the InstaPay receipt.',
            action: ar ? 'كمّل تجهيز المحل' : 'Continue setup',
          };
    case 'onboarding_payment_confirmed':
      return data.live
        ? {
            title: ar ? 'التحويل اتأكد' : 'Payment verified',
            message: data.renewal
              ? ar
                ? `راجعنا تحويل تجديد اشتراك ${shop} واتأكد. اشتراكك مكمّل من غير أي تغيير.`
                : `We verified the renewal transfer for ${shop}. Your subscription carries on unchanged.`
              : ar
                ? `راجعنا تحويل اشتراك ${shop} واتأكد. اشتراكك مكمّل من غير أي تغيير في مدته.`
                : `We verified the subscription transfer for ${shop}. Your subscription carries on with no change to its dates.`,
            action: ar ? 'افتح لوحة المحل' : 'Open shop dashboard',
          }
        : {
            title: ar ? 'التحويل اتأكد' : 'Payment verified',
            message: ar
              ? `راجعنا تحويل اشتراك ${shop} واتأكد. فاضل تنشر محلك عشان زباينك يبدأوا ياخدوا أختام.`
              : `We verified the subscription transfer for ${shop}. Publish your shop so customers can start collecting stamps.`,
            action: ar ? 'انشر محلك' : 'Publish your shop',
          };
    case 'onboarding_payment_rejected':
      return {
        title: ar ? 'مقدرناش نأكد التحويل' : 'We could not verify your transfer',
        message: data.suspended
          ? ar
            ? `مقدرناش نأكد ${data.renewal ? 'تحويل تجديد' : 'تحويل'} اشتراك ${shop}، فالاشتراك اتوقف مؤقتًا لحد ما تصحّح بيانات التحويل ونراجعها. كل بيانات المحل والعملاء والكروت والأختام محفوظة.`
            : `We could not verify the ${data.renewal ? 'renewal ' : ''}transfer for ${shop}, so the subscription is paused until you correct the transfer details and we review them. All shop, customer, card and stamp data is kept.`
          : ar
            ? `مقدرناش نأكد تحويل اشتراك ${shop}. صحّح بيانات التحويل عشان نكمّل تفعيل محلك.`
            : `We could not verify the subscription transfer for ${shop}. Correct the transfer details so we can finish activating your shop.`,
        detail: data.reason ? (ar ? 'السبب: ' : 'Reason: ') + data.reason : undefined,
        action: ar ? 'صحّح بيانات التحويل' : 'Correct transfer details',
      };
    case 'onboarding_receipt_submitted':
      return {
        title: ar ? 'إيصال InstaPay جديد للمراجعة' : 'New InstaPay receipt to review',
        message: data.renewal
          ? ar
            ? `${shop} دفع تجديد الاشتراك، والتجديد اتفعّل ومستني المراجعة.`
            : `${shop} paid a renewal; it is active and waiting for review.`
          : ar
            ? `${shop} رفع إيصال تحويل الاشتراك، والمحل بيشتغل ومستني المراجعة.`
            : `${shop} uploaded a subscription transfer receipt; the shop is running and waiting for review.`,
        action: ar ? 'راجع التحويل' : 'Review transfer',
      };
  }
}

/**
 * One layout for every Perks email: table based with inline styles (Outlook ignores most CSS),
 * a hosted PNG logo (Gmail and Outlook drop SVG and data: images), a "bulletproof" button, a
 * hidden preview line, right-to-left Arabic and a plain-text twin.
 */
export function mailTemplate(kind: MailKind, locale: MailLocale, data: MailData) {
  const ar = locale === 'ar';
  const dir = ar ? 'rtl' : 'ltr';
  const align = ar ? 'right' : 'left';
  const { title, message, action, detail, note } = copy(kind, ar, data);
  const footer = ar
    ? 'Perks — كروت الولاء في محفظة موبايلك. الرسالة دي لحسابك فقط، ما تشاركش رابطها.'
    : 'Perks — loyalty cards in your phone wallet. This message is for your account; keep its link private.';
  const link = data.link;
  if (link && !/^https?:\/\//.test(link)) throw new Error('Mail links must use HTTP or HTTPS.');
  if (data.origin && !/^https?:\/\//.test(data.origin))
    throw new Error('Mail origins must use HTTP or HTTPS.');
  const code = data.code && /^[0-9]{6}$/.test(data.code) ? data.code : undefined;
  const text = [
    title,
    message,
    ...(code ? [(ar ? 'الكود: ' : 'Code: ') + code] : []),
    ...(detail ? [detail] : []),
    ...(link && action ? [action + ': ' + link] : []),
    ...(note ? [note] : []),
    footer,
  ].join('\n\n');
  const font = ar ? "Tahoma,'Segoe UI',Arial,sans-serif" : "'Segoe UI',Helvetica,Arial,sans-serif";
  const logo = data.origin
    ? `<img src="${escape(data.origin)}/brand/perks-email-logo.png" width="115" height="40" alt="Perks" style="display:block;border:0;outline:none;width:115px;height:40px">`
    : `<span style="font-size:22px;font-weight:bold;color:${NAVY};letter-spacing:1px">Perks</span>`;
  const preheader = escape(code ? (ar ? 'الكود: ' : 'Code: ') + code : message).slice(0, 140);
  const codeBlock = code
    ? `<tr><td align="center" style="padding:8px 0 24px"><div dir="ltr" style="display:inline-block;font-family:'Courier New',Consolas,monospace;font-size:34px;font-weight:bold;letter-spacing:10px;color:${NAVY};background:${PAPER};border:2px solid ${LIME};border-radius:14px;padding:14px 22px 14px 32px">${code}</div></td></tr>`
    : '';
  const detailBlock = detail
    ? `<tr><td style="padding:0 0 20px"><div style="font-size:15px;line-height:1.8;color:${NAVY};background:#FFF4F2;border-${ar ? 'right' : 'left'}:4px solid #D64545;border-radius:10px;padding:12px 16px">${escape(detail)}</div></td></tr>`
    : '';
  const button =
    link && action
      ? `<tr><td align="${align}" style="padding:4px 0 24px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${NAVY}" style="border-radius:12px"><a href="${escape(link)}" style="display:inline-block;padding:14px 26px;font-family:${font};font-size:16px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:12px">${escape(action)}</a></td></tr></table></td></tr><tr><td style="padding:0 0 20px;font-size:12px;line-height:1.6;color:${MUTED}">${ar ? 'لو الزرار مش شغال، انسخ الرابط ده:' : 'If the button does not work, copy this link:'}<br><span dir="ltr" style="word-break:break-all;color:${NAVY}">${escape(link)}</span></td></tr>`
      : '';
  const noteBlock = note
    ? `<tr><td style="padding:0 0 8px;font-size:13px;line-height:1.7;color:${MUTED}">${escape(note)}</td></tr>`
    : '';
  const html = `<!doctype html><html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escape(title)}</title></head><body style="margin:0;padding:0;background:${PAPER};-webkit-text-size-adjust:100%"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAPER}">${preheader}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="background:${PAPER}"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="max-width:560px;font-family:${font};color:${NAVY};text-align:${align}"><tr><td align="${align}" style="padding:0 8px 16px">${logo}</td></tr><tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border-radius:20px;border-top:6px solid ${LIME};padding:32px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:0 0 12px;font-size:24px;line-height:1.4;font-weight:bold;color:${NAVY}">${escape(title)}</td></tr><tr><td style="padding:0 0 20px;font-size:16px;line-height:1.8;color:${NAVY}">${escape(message)}</td></tr>${codeBlock}${detailBlock}${button}${noteBlock}</table></td></tr><tr><td style="padding:18px 12px 0;font-size:12px;line-height:1.7;color:${MUTED}">${escape(footer)}</td></tr></table></td></tr></table></body></html>`;
  return { subject: title + ' · Perks', text, html };
}
