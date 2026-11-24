import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import type {
  WalletAudience,
  WalletMessagePreview,
} from '../../../../packages/contracts/src/owner-plan.js';
import { api } from '../api.js';
import { intlLocale } from '../locale.js';
import './wallet-reach.css';

export function useWalletMessagePreview(base: string, audience: WalletAudience, days = 30) {
  const path =
    base +
    '/preview?audience=' +
    audience +
    (audience === 'inactive' ? '&inactiveDays=' + days : '');
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    path: string;
    revision: number;
    preview: WalletMessagePreview | null;
    error?: unknown;
  } | null>(null);
  useEffect(() => {
    let live = true;
    void api<WalletMessagePreview>(path)
      .then((preview) => live && setResult({ path, revision, preview }))
      .catch((error: unknown) => live && setResult({ path, revision, preview: null, error }));
    return () => {
      live = false;
    };
  }, [path, revision]);
  const current = result?.path === path && result.revision === revision ? result : null;
  return {
    preview: current?.preview ?? null,
    error: current?.error,
    refresh: () => setRevision((value) => value + 1),
  };
}

export function WalletReachDetails({
  preview,
  lang,
  refresh,
  className,
}: {
  preview: WalletMessagePreview;
  lang: Language;
  refresh: () => void;
  className?: string;
}) {
  if (preview.customers > 0 && preview.customers === preview.groupSize) return null;
  const ar = lang === 'ar';
  const count = new Intl.NumberFormat(intlLocale(lang));
  return (
    <div className={className}>
      {preview.groupSize === 0 ? (
        <p>
          {ar
            ? 'مفيش كروت نشطة مطابقة للمجموعة دي دلوقتي.'
            : 'No active cards match this group right now.'}
        </p>
      ) : (
        <ul>
          {preview.notLinked > 0 && (
            <li>
              {ar
                ? `الـWallet مش متصل بالإرسال عند ${count.format(preview.notLinked)} عميل. يقدروا يضيفوا الكارت من صفحته في Perks.`
                : `No Wallet card is linked for ${count.format(preview.notLinked)} customers. They can add their card from Perks.`}
            </li>
          )}
          {preview.notificationsOff > 0 && (
            <li>
              {ar
                ? `إشعارات Perks مقفولة عند ${count.format(preview.notificationsOff)} عميل عندهم الكارت. يقدروا يشغّلوا «إشعارات المحفظة من المحل» من «حسابي» ← «الرسايل من المحلات».`
                : `Perks notifications are off for ${count.format(preview.notificationsOff)} customers with a linked Wallet card. They can turn on “Wallet notifications from this shop” under My account → Messages from shops.`}
            </li>
          )}
          {preview.recentlyContacted > 0 && (
            <li>
              {ar
                ? `${count.format(preview.recentlyContacted)} اتسجّلت لهم رسالة خلال آخر 24 ساعة.`
                : `${count.format(preview.recentlyContacted)} had a message queued in the last 24 hours.`}
            </li>
          )}
        </ul>
      )}
      <button type="button" className="text-button" onClick={refresh}>
        {ar ? 'حدّث العدد' : 'Refresh count'}
      </button>
    </div>
  );
}

/**
 * When a Wallet message would reach nobody, say why next to the send button, and what fixes
 * each reason, instead of a grey button with no explanation.
 */
export function WalletBlockedHelp({
  preview,
  lang,
  noneLeft,
  whatsapp,
  hint,
  className = 'wallet-blocked',
}: {
  preview: WalletMessagePreview;
  lang: Language;
  noneLeft: boolean;
  /** Customers in this group who can get it on WhatsApp instead, and how to open that. */
  whatsapp?: { count: number; open: () => void } | null;
  /** Shown when this group has no WhatsApp fallback (e.g. "everyone"). */
  hint?: string;
  className?: string;
}) {
  const ar = lang === 'ar';
  const count = new Intl.NumberFormat(intlLocale(lang));
  const n = (v: number) => count.format(v);
  const reasons: { title: string; fix: string }[] = [];
  if (noneLeft)
    reasons.push({
      title: ar ? 'رسايل الشهر ده خلصت.' : 'This month’s messages are used up.',
      fix: ar
        ? 'الرصيد بيتجدد أول الشهر، أو زوّده من «باقتي».'
        : 'They renew next month, or add more from My plan.',
    });
  else if (preview.groupSize === 0)
    reasons.push({
      title: ar ? 'مفيش زباين في المجموعة دي دلوقتي.' : 'Nobody is in this group right now.',
      fix: ar ? 'اختار مجموعة تانية من «مين يوصله؟».' : 'Pick another group in “Who gets it?”.',
    });
  else {
    if (preview.notificationsOff > 0)
      reasons.push({
        title: ar
          ? `${n(preview.notificationsOff)} ضافوا الكارت للـWallet بس قافلين إشعارات محلك.`
          : `${n(preview.notificationsOff)} added the card to Wallet but turned off your notifications.`,
        fix: ar
          ? 'لما ييجوا، قولهم يفتحوا «حسابي» ← «الرسايل من المحلات» ← يشغّلوا «إشعارات المحفظة من المحل».'
          : 'When they visit, ask them to open My account → Messages from shops → turn on “Wallet notifications from this shop”.',
      });
    if (preview.notLinked > 0)
      reasons.push({
        title: ar
          ? `${n(preview.notLinked)} لسه ماضافوش الكارت للـWallet.`
          : `${n(preview.notLinked)} have not added the card to Wallet yet.`,
        fix: ar
          ? 'الرسايل بتظهر على كارت الـWallet. قولهم يفتحوا كارتهم ويدوسوا «إضافة إلى Apple Wallet» أو «Google Wallet».'
          : 'Messages show on the Wallet card. Ask them to open their card and tap “Add to Apple Wallet” or “Google Wallet”.',
      });
    if (preview.recentlyContacted > 0)
      reasons.push({
        title: ar
          ? `${n(preview.recentlyContacted)} وصلتهم رسالة في آخر 24 ساعة.`
          : `${n(preview.recentlyContacted)} got a message in the last 24 hours.`,
        fix: ar
          ? 'رسالة واحدة في اليوم بس، عشان محدش يتضايق. تقدر تبعتلهم تاني بكرة.'
          : 'One message a day at most, so nobody is annoyed. You can message them again tomorrow.',
      });
  }
  return (
    <div className={className} role="status">
      <strong>
        {noneLeft
          ? ar
            ? 'مش هتقدر تبعت دلوقتي'
            : 'You can’t send right now'
          : ar
            ? 'الرسالة دي مش هتوصل لحد دلوقتي'
            : 'This message won’t reach anyone right now'}
      </strong>
      <ul>
        {reasons.map((r) => (
          <li key={r.title}>
            <span>{r.title}</span>
            <small>{r.fix}</small>
          </li>
        ))}
      </ul>
      {whatsapp && whatsapp.count > 0 && (
        <div className="wallet-blocked-alt">
          <span>
            {ar
              ? `${n(whatsapp.count)} منهم موافقين يوصلهم كلام منك على واتساب.`
              : `${n(whatsapp.count)} of them agreed to hear from you on WhatsApp.`}
          </span>
          <button type="button" className="an-wa-button" onClick={whatsapp.open}>
            {ar ? 'ابعتلهم على واتساب' : 'Send on WhatsApp'}
          </button>
        </div>
      )}
      {hint && !(whatsapp && whatsapp.count > 0) && (
        <small className="wallet-blocked-hint">{hint}</small>
      )}
    </div>
  );
}
