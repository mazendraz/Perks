import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import type {
  WalletAudience,
  WalletMessagePreview,
} from '../../../../packages/contracts/src/owner-plan.js';
import { api } from '../api.js';
import { intlLocale } from '../locale.js';

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
                ? `إشعارات Perks مقفولة عند ${count.format(preview.notificationsOff)} عميل عندهم الكارت. يقدروا يشغّلوا «إشعارات الـWallet من المحل» من تفضيلات الكارت.`
                : `Perks notifications are off for ${count.format(preview.notificationsOff)} customers with a linked Wallet card. They can turn on “Wallet notifications from this shop” in their card preferences.`}
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
