import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { portalAssetUrl } from '../portals.js';
import type { Language } from '../../../../packages/contracts/src/index.js';

// iPadOS reports itself as a Mac; touch points tell them apart.
export function canAddToAppleWallet(ua = navigator.userAgent, touch = navigator.maxTouchPoints) {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
}
export function isAndroid(ua = navigator.userAgent) {
  return /Android/.test(ua);
}
export function WalletButton({
  provider,
  membershipId,
  lang,
}: {
  provider: 'apple' | 'google';
  membershipId: string;
  lang: Language;
}) {
  const name = provider === 'apple' ? 'Apple Wallet' : 'Google Wallet';
  return (
    <a
      className={'wallet-badge-button ' + provider + '-wallet-button'}
      href={portalAssetUrl('/api/v1/me/memberships/' + membershipId + '/wallet/' + provider)}
    >
      <img
        src={'/wallet/' + provider + '-add-to-wallet-' + lang + '.svg'}
        height={55}
        alt={(lang === 'ar' ? 'إضافة إلى ' : 'Add to ') + name}
      />
    </a>
  );
}
export function WalletPanel({ membershipId, lang }: { membershipId: string; lang: Language }) {
  const ar = lang === 'ar';
  const [wallets, setWallets] = useState<{ apple: boolean; google: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    api<{ apple: boolean; google?: boolean }>('/wallet/availability', { workspace: 'shared' })
      .then((r) => live && setWallets({ apple: r.apple, google: !!r.google }))
      .catch(() => live && setWallets({ apple: false, google: false }));
    return () => {
      live = false;
    };
  }, []);
  const iphone = canAddToAppleWallet(),
    android = isAndroid();
  const apple = !!wallets?.apple && iphone,
    google = !!wallets?.google && android;
  return (
    <section className="panel wallet-panel">
      <h2>{ar ? 'كارتك في Wallet' : 'Your card in Wallet'}</h2>
      {apple || google ? (
        <>
          <p className="muted">
            {ar
              ? 'احفظ كارتك باسمك، وشوف رصيدك ومكافأتك من المحفظة. الكارت بيتحدث بعد كل ختم.'
              : 'Keep your named card, stamp balance and reward in your wallet. It updates after every stamp.'}
          </p>
          <div className="wallet-badges">
            {apple && <WalletButton provider="apple" membershipId={membershipId} lang={lang} />}
            {google && <WalletButton provider="google" membershipId={membershipId} lang={lang} />}
          </div>
          <p className="muted small">
            {ar
              ? 'وقت الزيارة، المس ستيكر المحل أو امسح QR بتاعه، وورّي الكود اللي هيظهر للكاشير. رابط كارتك موجود كمان في تفاصيل المحفظة.'
              : 'At the counter, tap the shop tag or scan its QR, then show the fresh code to the cashier. You can also open your card from your wallet’s pass details.'}
          </p>
          <p className="muted small">
            {ar
              ? 'الإضافة بتشارك اسمك وبيانات الكارت مع مزود المحفظة اللي اخترته.'
              : 'Adding shares your name and card details with your chosen wallet provider.'}
          </p>
        </>
      ) : wallets?.apple || wallets?.google ? (
        <p className="muted">
          {ar
            ? 'افتح الكارت من موبايلك علشان تضيفه لـApple Wallet أو Google Wallet. كارت الويب محدث ومحفوظ.'
            : 'Open this card on your phone to add it to Apple Wallet or Google Wallet. Your web card stays current.'}
        </p>
      ) : (
        <p className="muted">
          {ar
            ? 'الإضافة للمحفظة مش متاحة حاليًا. كارت الويب محدث ومحفوظ.'
            : 'Wallet is not available yet. Your web card stays current.'}
        </p>
      )}
    </section>
  );
}
