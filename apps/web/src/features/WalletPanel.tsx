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
    android = isAndroid(),
    base = '/api/v1/me/memberships/' + membershipId + '/wallet/';
  const apple = !!wallets?.apple && iphone,
    google = !!wallets?.google && android;
  return (
    <section className="panel wallet-panel">
      <h2>Wallet</h2>
      {apple || google ? (
        <>
          <p className="muted">
            {ar
              ? 'ضيف الكارت للمحفظة علشان تشوف أختامك من غير ما تفتح الموقع. الكارت هيتحدث لوحده بعد كل ختم.'
              : 'Add the card to your wallet to see your stamps without opening the site. It updates itself after every stamp.'}
          </p>
          {apple && (
            <a className="apple-wallet-button" href={portalAssetUrl(base + 'apple')}>
              <span aria-hidden="true" className="apple-wallet-glyph" />
              {ar ? 'إضافة إلى Apple Wallet' : 'Add to Apple Wallet'}
            </a>
          )}
          {google && (
            <a className="google-wallet-button" href={portalAssetUrl(base + 'google')}>
              <span aria-hidden="true" className="google-wallet-glyph" />
              {ar ? 'إضافة إلى Google Wallet' : 'Add to Google Wallet'}
            </a>
          )}
          <p className="muted small">
            {ar
              ? 'علشان تاخد ختم، افتح الكارت هنا واعرض الكود للكاشير.'
              : 'To get a stamp, open the card here and show the code to the cashier.'}
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
