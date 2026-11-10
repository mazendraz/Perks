export type MailKind = 'invitation' | 'password_reset' | 'password_changed';
export type MailLocale = 'ar' | 'en';
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
export function mailTemplate(
  kind: MailKind,
  locale: MailLocale,
  data: { link?: string; business?: string },
) {
  const ar = locale === 'ar';
  const title =
    kind === 'invitation'
      ? ar
        ? 'دعوتك للمحل جاهزة'
        : 'Your business invitation'
      : kind === 'password_reset'
        ? ar
          ? 'اختار باسورد جديد'
          : 'Reset your password'
        : ar
          ? 'باسورد حسابك اتغيّر'
          : 'Your password was changed';
  const message =
    kind === 'invitation'
      ? (ar ? 'عندك دعوة تنضم لفريق ' : 'You have been invited to join ') +
        (data.business || (ar ? 'المحل' : 'the business')) +
        '.'
      : kind === 'password_reset'
        ? ar
          ? 'لو طلبت تغيير الباسورد، افتح الرابط واختار واحد جديد. الرابط مؤقت وبيشتغل مرة واحدة.'
          : 'If you requested a password reset, open this temporary, single-use link and choose a new password.'
        : ar
          ? 'باسورد حسابك اتغيّر، والجلسات القديمة اتقفلت. لو مش أنت اللي عملت ده، اطلب استعادة حسابك وراجع مسؤول الحساب.'
          : 'Your account password was changed and previous sessions were signed out. If this was not you, recover your account and contact your account administrator.';
  const action =
    kind === 'invitation'
      ? ar
        ? 'قبول الدعوة'
        : 'Accept invitation'
      : kind === 'password_reset'
        ? ar
          ? 'تغيير الباسورد'
          : 'Reset password'
        : ar
          ? 'استعادة الحساب'
          : 'Recover account';
  const footer = ar
    ? 'Perks — الرسالة دي لحسابك فقط. ما تشاركش رابطها.'
    : 'Perks — this message is for your account. Keep its link private.';
  const link = data.link;
  if (link && !/^https?:\/\//.test(link)) throw new Error('Mail links must use HTTP or HTTPS.');
  const text = [title, message, ...(link ? [action + ': ' + link] : []), footer].join('\n\n');
  const html = `<!doctype html><html lang="${locale}" dir="${ar ? 'rtl' : 'ltr'}"><body style="margin:0;background:#f5f5f1;color:#181b38;font-family:Arial,sans-serif"><main style="max-width:560px;margin:32px auto;padding:32px;background:#fff;border-radius:20px"><p style="color:#181b38;font-weight:bold;letter-spacing:1px">PERKS</p><h1 style="font-size:26px">${escape(title)}</h1><p style="font-size:16px;line-height:1.8">${escape(message)}</p>${link ? `<p style="margin:28px 0"><a href="${escape(link)}" style="display:inline-block;background:#181b38;color:#fff;text-decoration:none;padding:14px 22px;border-radius:12px">${escape(action)}</a></p><p style="font-size:12px;overflow-wrap:anywhere" dir="ltr">${escape(link)}</p>` : ''}<p style="font-size:12px;color:#6b6e80">${escape(footer)}</p></main></body></html>`;
  return { subject: title + ' · Perks', text, html };
}
