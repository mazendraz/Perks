// What a cashier notification says. Deliberately generic: a lock screen is read by whoever holds the
// phone, so the text carries the branch name and nothing about the customer, the card or any figure.
export type PushLanguage = 'ar' | 'en';
export interface PushNotice {
  title: string;
  body: string;
  // Where a tap opens. Same-origin path only; the service worker resolves it against its own origin.
  url: string;
  // One notification per branch: a second request replaces the first on the lock screen and buzzes again.
  tag: string;
  lang: PushLanguage;
  dir: 'rtl' | 'ltr';
}
const direction = (lang: PushLanguage) => (lang === 'en' ? 'ltr' : 'rtl');
export function stampRequestNotice(
  lang: PushLanguage,
  branchId: string,
  branchName: string,
): PushNotice {
  return {
    title: lang === 'en' ? 'New stamp request' : 'طلب ختم جديد',
    body: branchName.trim().slice(0, 80),
    url: '/cashier',
    tag: 'stamp-request:' + branchId,
    lang,
    dir: direction(lang),
  };
}
export function testNotice(lang: PushLanguage): PushNotice {
  return {
    title: lang === 'en' ? 'Notifications are on' : 'الإشعارات شغالة',
    body:
      lang === 'en'
        ? 'Perks · this device will get stamp requests'
        : 'Perks · الجهاز ده هيوصله طلبات الأختام',
    url: '/cashier',
    tag: 'test',
    lang,
    dir: direction(lang),
  };
}
