// What a cashier notification says. A lock screen is read by whoever holds the phone, so the text
// carries the customer's first name only (never the full name, phone, card balance or receipt) and the
// branch. Everything else is on the screen the notification opens, behind the cashier's sign-in.
export type PushLanguage = 'ar' | 'en';
export interface PushAction {
  // Handled by the service worker: it opens `url` with ?do=<action>, never acts on its own.
  action: 'revoke' | 'block' | 'reject-block';
  title: string;
}
export interface PushNotice {
  title: string;
  body: string;
  // Where a tap opens. Same-origin /cashier path only; the service worker resolves it itself.
  url: string;
  // One notification per scan, so each keeps its own buttons.
  tag: string;
  lang: PushLanguage;
  dir: 'rtl' | 'ltr';
  // Android/Chrome show them on the notification; iPhone does not, and opens `url` on tap instead.
  actions?: PushAction[];
}
const direction = (lang: PushLanguage) => (lang === 'en' ? 'ltr' : 'rtl');
// "Mona Ahmed" → "Mona". A name that is only digits or symbols (a phone typed as a name) shows nothing.
export function firstName(alias: string | null | undefined) {
  const first = (alias ?? '').trim().split(/\s+/)[0] ?? '';
  return /\p{L}/u.test(first) ? first.slice(0, 24) : '';
}
const titled = (base: string, name: string) => (name ? base + ' · ' + name : base);
export function stampRequestNotice(
  lang: PushLanguage,
  requestId: string,
  branchName: string,
  alias?: string | null,
): PushNotice {
  const en = lang === 'en';
  return {
    title: titled(en ? 'Stamp to approve' : 'ختم محتاج موافقتك', firstName(alias)),
    body:
      branchName.trim().slice(0, 80) +
      (en ? ' · enter the receipt to add it' : ' · اكتب رقم الإيصال علشان يتضاف'),
    url: '/cashier/requests/' + requestId,
    tag: 'stamp-request:' + requestId,
    lang,
    dir: direction(lang),
    actions: [{ action: 'reject-block', title: en ? 'Reject & Block' : 'رفض وحظر' }],
  };
}
export function autoStampNotice(
  lang: PushLanguage,
  transactionId: string,
  branchName: string,
  alias?: string | null,
  quantity?: number | null,
): PushNotice {
  const en = lang === 'en',
    count = quantity && quantity > 1 ? ' +' + quantity : '';
  return {
    title: titled((en ? 'Stamp added' : 'ختم اتضاف') + count, firstName(alias)),
    body: branchName.trim().slice(0, 80),
    url: '/cashier/stamps/' + transactionId,
    tag: 'auto-stamp:' + transactionId,
    lang,
    dir: direction(lang),
    actions: [
      { action: 'revoke', title: en ? 'Revoke this stamp' : 'إلغاء الختم ده' },
      { action: 'block', title: en ? 'Block customer' : 'حظر العميل' },
    ],
  };
}
// A card just filled: the customer's reward is waiting to be handed over at this branch.
export function rewardEarnedNotice(
  lang: PushLanguage,
  rewardId: string,
  branchName: string,
  alias?: string | null,
  title?: string | null,
): PushNotice {
  const en = lang === 'en';
  return {
    title: titled(
      en ? 'Card full · reward ready' : 'الكارت كمل · المكافأة جاهزة',
      firstName(alias),
    ),
    body:
      branchName.trim().slice(0, 80) +
      ' · ' +
      (title?.trim().slice(0, 60) || (en ? 'reward' : 'المكافأة')) +
      (en
        ? ' · they tap Redeem on their phone to claim it'
        : ' · العميل يدوس استبدل من موبايله علشان ياخدها'),
    url: '/cashier',
    tag: 'reward-earned:' + rewardId,
    lang,
    dir: direction(lang),
  };
}
// A reward was handed over; the card has started its next cycle.
export function rewardRedeemedNotice(
  lang: PushLanguage,
  rewardId: string,
  branchName: string,
  alias?: string | null,
  title?: string | null,
  cycle?: number | null,
): PushNotice {
  const en = lang === 'en';
  return {
    title: titled(en ? 'Reward redeemed' : 'المكافأة اتصرفت', firstName(alias)),
    body:
      branchName.trim().slice(0, 80) +
      ' · ' +
      (title?.trim().slice(0, 60) || (en ? 'reward' : 'المكافأة')) +
      (cycle ? (en ? ' · card ' + cycle + ' started' : ' · بدأ كارت ' + cycle) : ''),
    url: '/cashier',
    tag: 'reward-redeemed:' + rewardId,
    lang,
    dir: direction(lang),
  };
}
// A customer tapped Redeem: confirm or reject it on the screen this opens. The match number is the one
// on the customer's phone, so the cashier hands the reward to the right person.
export function rewardRequestNotice(
  lang: PushLanguage,
  requestId: string,
  branchName: string,
  alias?: string | null,
  title?: string | null,
  match?: number | null,
): PushNotice {
  const en = lang === 'en';
  return {
    title: titled(en ? 'Redeem request' : 'طلب استبدال', firstName(alias)),
    body:
      (title?.trim().slice(0, 60) || (en ? 'reward' : 'المكافأة')) +
      (match ? (en ? ' · match ' : ' · رقم ') + match : '') +
      ' · ' +
      branchName.trim().slice(0, 80),
    url: '/cashier/redeem/' + requestId,
    tag: 'reward-request:' + requestId,
    lang,
    dir: direction(lang),
  };
}
export function testNotice(lang: PushLanguage): PushNotice {
  return {
    title: lang === 'en' ? 'Notifications are on' : 'الإشعارات شغالة',
    body:
      lang === 'en'
        ? 'Perks · this device will be told about every customer scan'
        : 'Perks · الجهاز ده هيوصله تنبيه مع كل سكان من العملاء',
    url: '/cashier',
    tag: 'test',
    lang,
    dir: direction(lang),
  };
}
