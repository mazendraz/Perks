import { useEffect, useState } from 'react';
import { api } from '../api.js';
import './wallet-reach.css';
import { WalletButton } from './WalletButton.js';
export { WalletButton };
import type { Language } from '../../../../packages/contracts/src/index.js';

// iPadOS reports itself as a Mac; touch points tell them apart.
export function canAddToAppleWallet(ua = navigator.userAgent, touch = navigator.maxTouchPoints) {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
}
export function isAndroid(ua = navigator.userAgent) {
  return /Android/.test(ua);
}
type WalletAvailability = { apple: boolean; google?: boolean; recoveryRequired?: boolean };

export function useWalletAvailability() {
  const [wallets, setWallets] = useState<WalletAvailability | null>(null);
  useEffect(() => {
    let live = true;
    api<WalletAvailability>('/wallet/availability', { workspace: 'customer' })
      .then((result) => live && setWallets(result))
      .catch(() => live && setWallets({ apple: false, google: false }));
    return () => {
      live = false;
    };
  }, []);
  return wallets;
}

export function WalletPanel({
  membershipId,
  lang,
  wallets,
}: {
  membershipId: string;
  lang: Language;
  wallets: WalletAvailability | null;
}) {
  const ar = lang === 'ar';
  const iphone = canAddToAppleWallet(),
    android = isAndroid();
  const apple = !!wallets?.apple && iphone,
    google = !!wallets?.google && android;
  // Nothing to offer when Wallet is not set up on the server: no panel at all.
  if (!wallets || (!wallets.apple && !wallets.google)) return null;
  if (wallets.recoveryRequired)
    return (
      <section className="panel wallet-panel">
        <h2>{ar ? 'المحفظة' : 'Wallet'}</h2>
        <p className="muted">
          {ar
            ? 'رجّع كل كروتك على الجهاز ده علشان تقدر تضيف كارت للـWallet.'
            : 'Restore all your cards on this device to add a card to Wallet.'}
        </p>
        <a className="secondary small" href="/customer/restore">
          {ar ? 'رجّع كروتك' : 'Restore my cards'}
        </a>
      </section>
    );
  return (
    <section className={'wallet-panel' + (apple || google ? ' wallet-panel-ready' : '')}>
      <h2 className={apple || google ? 'sr-only' : undefined}>{ar ? 'المحفظة' : 'Wallet'}</h2>
      {apple || google ? (
        <>
          <div className="wallet-badges">
            {apple && <WalletButton provider="apple" membershipId={membershipId} lang={lang} />}
            {google && <WalletButton provider="google" membershipId={membershipId} lang={lang} />}
          </div>
          <p className="muted small">
            {ar
              ? 'الإضافة بتشارك اسمك وبيانات كارتك مع مزود المحفظة.'
              : 'Adding shares your name and card details with your wallet provider.'}
          </p>
        </>
      ) : (
        <p className="muted">
          {ar
            ? 'افتح الكارت من موبايلك علشان تضيفه لـApple Wallet أو Google Wallet. كارت الويب محدث ومحفوظ.'
            : 'Open this card on your phone to add it to Apple Wallet or Google Wallet. Your web card stays current.'}
        </p>
      )}
    </section>
  );
}
