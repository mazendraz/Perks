import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { portalAssetUrl } from '../portals.js';
import './wallet-reach.css';
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
/**
 * Right where the card goes into Wallet, ask once whether the shop may send notifications to it.
 * Sign-up leaves this unticked and most people skip it, so cards ended up in Wallet that no shop
 * message could reach. Still the customer's choice: unticked until they tick it.
 */
function WalletNotifyOptIn({
  merchantId,
  merchantName,
  lang,
}: {
  merchantId: string;
  merchantName: string;
  lang: Language;
}) {
  const ar = lang === 'ar';
  const path = '/me/merchants/' + merchantId + '/preferences';
  const [granted, setGranted] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [justTurnedOn, setJustTurnedOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api<{ preferences: { channel: string; granted: boolean }[] }>(path)
      .then((r) => live && setGranted(!!r.preferences.find((p) => p.channel === 'push')?.granted))
      .catch(() => live && setGranted(null));
    return () => {
      live = false;
    };
  }, [path]);
  // Already on (and not just now): nothing to ask.
  if (granted === null || (granted && !justTurnedOn)) return null;
  const change = async (on: boolean) => {
    setBusy(true);
    setFailed(false);
    try {
      await api(path, { method: 'PATCH', body: { channel: 'push', granted: on } });
      setGranted(on);
      setJustTurnedOn(on);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className="checkbox-label wallet-notify-optin">
      <input
        type="checkbox"
        checked={granted}
        disabled={busy}
        onChange={(e) => void change(e.target.checked)}
      />
      <span>
        <strong>
          {ar ? 'إشعارات من ' : 'Notifications from '}
          <bdi>{merchantName}</bdi>
        </strong>
        <small>
          {ar
            ? 'تنبيه لما مكافأتك تجهز وعروض المحل، بحد أقصى رسالة في اليوم.'
            : 'Reward alerts and shop offers, up to once a day.'}
        </small>
        {failed && (
          <small role="alert">
            {ar ? 'تعذّر حفظ اختيارك. جرّب تاني.' : 'Couldn’t save your choice. Try again.'}
          </small>
        )}
      </span>
    </label>
  );
}

export function WalletPanel({
  membershipId,
  merchantId,
  merchantName,
  lang,
  onPreferences,
}: {
  membershipId: string;
  merchantId?: string;
  merchantName?: string;
  lang: Language;
  onPreferences?: () => void;
}) {
  const ar = lang === 'ar';
  type Availability = { apple: boolean; google?: boolean; recoveryRequired?: boolean };
  const [wallets, setWallets] = useState<Availability | null>(null);
  useEffect(() => {
    let live = true;
    api<Availability>('/wallet/availability', { workspace: 'customer' })
      .then((r) => live && setWallets(r))
      .catch(() => live && setWallets({ apple: false, google: false }));
    return () => {
      live = false;
    };
  }, [membershipId]);
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
    <section className={'panel wallet-panel' + (apple || google ? ' wallet-panel-ready' : '')}>
      <h2 className={apple || google ? 'sr-only' : undefined}>{ar ? 'المحفظة' : 'Wallet'}</h2>
      {apple || google ? (
        <>
          <div className="wallet-badges">
            {apple && <WalletButton provider="apple" membershipId={membershipId} lang={lang} />}
            {google && <WalletButton provider="google" membershipId={membershipId} lang={lang} />}
          </div>
          <p className="muted small">
            {ar
              ? 'بيتحدّث لوحده بعد كل ختم. الإضافة بتشارك اسمك وبيانات الكارت مع مزود المحفظة.'
              : 'It updates after every stamp. Adding shares your name and card details with your wallet provider.'}
          </p>
          {merchantId && merchantName && (
            <WalletNotifyOptIn merchantId={merchantId} merchantName={merchantName} lang={lang} />
          )}
        </>
      ) : (
        <p className="muted">
          {ar
            ? 'افتح الكارت من موبايلك علشان تضيفه لـApple Wallet أو Google Wallet. كارت الويب محدث ومحفوظ.'
            : 'Open this card on your phone to add it to Apple Wallet or Google Wallet. Your web card stays current.'}
        </p>
      )}
      {(wallets.apple || wallets.google) && onPreferences && (
        <button className="text-button" onClick={onPreferences}>
          {ar ? 'إعدادات الإشعارات' : 'Wallet notification settings'}
        </button>
      )}
    </section>
  );
}
