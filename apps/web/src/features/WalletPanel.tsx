import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { portalAssetUrl } from '../portals.js';
import type { Language } from '../../../../packages/contracts/src/index.js';

// iPadOS reports itself as a Mac; touch points tell them apart.
export function canAddToAppleWallet(ua = navigator.userAgent, touch = navigator.maxTouchPoints) {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
}
export function WalletPanel({ membershipId, lang }: { membershipId: string; lang: Language }) {
  const ar = lang === 'ar';
  const [apple, setApple] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    api<{ apple: boolean }>('/wallet/availability', { workspace: 'shared' })
      .then((r) => live && setApple(r.apple))
      .catch(() => live && setApple(false));
    return () => {
      live = false;
    };
  }, []);
  const iphone = canAddToAppleWallet();
  return (
    <section className="panel wallet-panel">
      <h2>Wallet</h2>
      {apple && iphone ? (
        <>
          <p className="muted">
            {ar
              ? 'ضيف الكارت لـApple Wallet علشان تشوف أختامك من غير ما تفتح الموقع. الكارت هيتحدث لوحده بعد كل ختم.'
              : 'Add the card to Apple Wallet to see your stamps without opening the site. It updates itself after every stamp.'}
          </p>
          <a
            className="apple-wallet-button"
            href={portalAssetUrl('/api/v1/me/memberships/' + membershipId + '/wallet/apple')}
          >
            <span aria-hidden="true" className="apple-wallet-glyph" />
            {ar ? 'إضافة إلى Apple Wallet' : 'Add to Apple Wallet'}
          </a>
          <p className="muted small">
            {ar
              ? 'علشان تاخد ختم، افتح الكارت هنا واعرض الكود للكاشير.'
              : 'To get a stamp, open the card here and show the code to the cashier.'}
          </p>
        </>
      ) : apple ? (
        <p className="muted">
          {ar
            ? 'افتح الكارت من الآيفون بتاعك علشان تضيفه لـApple Wallet. كارت الويب محدث ومحفوظ.'
            : 'Open this card on your iPhone to add it to Apple Wallet. Your web card stays current.'}
        </p>
      ) : (
        <p className="muted">
          {ar
            ? 'الإضافة لـApple Wallet مش متاحة حاليًا. كارت الويب محدث ومحفوظ.'
            : 'Apple Wallet is not available yet. Your web card stays current.'}
        </p>
      )}
    </section>
  );
}
