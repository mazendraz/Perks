import { useEffect, useRef } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
export interface CustomerQr {
  token: string;
  qrDataUrl: string;
  expiresAt: string;
}
export function CustomerCode({
  qr,
  lang,
  busy,
  error,
  onRefresh,
  onClose,
}: {
  qr: CustomerQr;
  lang: Language;
  busy: boolean;
  error: string;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const latest = useRef(onRefresh),
    running = useRef(false);
  latest.current = onRefresh;
  useEffect(() => {
    const refresh = () => {
      if (
        document.hidden ||
        running.current ||
        new Date(qr.expiresAt).getTime() - Date.now() > 20000
      )
        return;
      running.current = true;
      void latest.current().finally(() => {
        running.current = false;
      });
    };
    const timer = window.setInterval(refresh, 5000);
    const first = window.setTimeout(
      refresh,
      Math.max(0, new Date(qr.expiresAt).getTime() - Date.now() - 20000),
    );
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [qr.expiresAt]);
  const ar = lang === 'ar';
  return (
    <div className="modal-backdrop customer-code-backdrop">
      <section
        className="dialog customer-code-dialog qr-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-code-title"
      >
        <div className="section-heading">
          <h2 id="customer-code-title">{ar ? 'الكود الشخصي' : 'Personal QR'}</h2>
          <button type="button" className="secondary" data-dialog-close onClick={onClose}>
            {ar ? 'اقفل الكود' : 'Close code'}
          </button>
        </div>
        <p>
          {ar
            ? 'ورّي الكود للكاشير. أول ما الختم يتحفظ هتشوفه على الكارت.'
            : 'Show this code to the cashier. Your card appears when the stamp is saved.'}
        </p>
        <img src={qr.qrDataUrl} alt={ar ? 'QR العضوية للكاشير' : 'Membership QR for the cashier'} />
        <code dir="ltr">{qr.token}</code>
        <small>
          {ar ? 'صالح لحد ' : 'Valid until '}
          {new Date(qr.expiresAt).toLocaleTimeString(lang, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </small>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button className="text-button" onClick={() => void onRefresh()} disabled={busy}>
          {ar ? 'جدّد الكود' : 'Refresh code'}
        </button>
      </section>
    </div>
  );
}
