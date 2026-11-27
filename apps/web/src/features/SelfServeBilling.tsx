import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
import { CopyField, money, PaymentReceipt, type Order } from './MerchantOnboarding.js';

type Billing = {
  paymentStatus: 'pending_review' | 'verified' | 'rejected' | 'awaiting_transfer';
  purpose: 'activation' | 'renewal';
  amountMinor: number | null;
  reference: string | null;
  submittedAt: string | null;
  rejectionReason: string | null;
  currentPeriodEnd: string | null;
  renewal: 'available' | 'open' | 'too_early' | 'blocked';
  renewalOpensAt: string | null;
  renewalPriceMinor: number | null;
  openRenewal: { id: string; amount_minor: number; recipient_account: string } | null;
};

const day = (ar: boolean, value: string) =>
  new Intl.DateTimeFormat(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { dateStyle: 'medium' }).format(
    new Date(value),
  );

/**
 * Payment status and InstaPay renewal for a shop that signed up by itself. The subscription is
 * active the moment a transfer is sent; this shows where its review stands and opens the next
 * renewal a week before the period ends. Shops set up by the Perks team show nothing here.
 */
export function SelfServeBilling({ merchantId, lang }: { merchantId: string; lang: Language }) {
  const ar = lang === 'ar';
  const [billing, setBilling] = useState<Billing | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void api<{ billing: Billing | null }>(
      '/merchant-onboarding/billing?merchantId=' + encodeURIComponent(merchantId),
    )
      .then((result) => {
        if (active) setBilling(result.billing);
      })
      .catch(() => {
        /* Not a self-service shop, or no access: the regular plan page is enough. */
      });
    return () => {
      active = false;
    };
  }, [merchantId, attempt]);
  if (!billing) return null;

  async function startRenewal() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ billing: Billing }>('/merchant-onboarding/billing/renewal', {
        method: 'POST',
        body: { merchantId },
      });
      setBilling(result.billing);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const status = {
    pending_review: {
      tone: 'notice',
      text: ar
        ? 'اشتراكك شغال، وتحويلك تحت المراجعة. مش محتاج تعمل حاجة؛ هيوصلك إيميل بالنتيجة.'
        : 'Your subscription is active and your transfer is being reviewed. Nothing to do; we will email you the result.',
    },
    verified: {
      tone: 'notice success',
      text: ar
        ? 'آخر تحويل اتأكد. اشتراكك شغال.'
        : 'Your latest transfer is verified. Your subscription is active.',
    },
    rejected: {
      tone: 'notice error',
      text: ar
        ? 'مقدرناش نأكد آخر تحويل، فالاشتراك واقف مؤقتًا. صحّح بيانات التحويل من صفحة تجهيز المحل.'
        : 'We could not verify your latest transfer, so the subscription is paused. Correct the transfer details from the shop setup page.',
    },
    awaiting_transfer: { tone: 'notice', text: '' },
  }[billing.paymentStatus];
  const renewal = billing.openRenewal;
  const renewalOrder: Order | null = renewal
    ? {
        id: renewal.id,
        amount_minor: renewal.amount_minor,
        recipient_account: renewal.recipient_account,
      }
    : null;

  return (
    <section className="panel self-serve-billing" aria-labelledby="self-serve-billing-title">
      <h3 id="self-serve-billing-title">{ar ? 'الدفع بـ InstaPay' : 'InstaPay payments'}</h3>
      {status.text && (
        <p className={status.tone} role="status">
          <strong>
            {billing.purpose === 'renewal'
              ? ar
                ? 'التجديد: '
                : 'Renewal: '
              : ar
                ? 'الاشتراك: '
                : 'Subscription: '}
          </strong>
          {status.text}
          {billing.rejectionReason && (
            <>
              <br />
              <strong>{ar ? 'السبب: ' : 'Reason: '}</strong>
              {billing.rejectionReason}
            </>
          )}
        </p>
      )}
      {billing.paymentStatus === 'rejected' && (
        <a className="primary" href="/onboarding">
          {ar ? 'صحّح بيانات التحويل' : 'Correct transfer details'}
        </a>
      )}
      {billing.currentPeriodEnd && (
        <p className="muted">
          {(ar ? 'الاشتراك شغال لحد ' : 'Subscription runs until ') +
            day(ar, billing.currentPeriodEnd) +
            '.'}
        </p>
      )}
      {error != null && (
        <p className="notice error" role="alert">
          {errorText(error, lang)}
        </p>
      )}
      {billing.renewal === 'available' && (
        <div className="form-actions">
          <button
            className="primary"
            type="button"
            disabled={busy}
            onClick={() => void startRenewal()}
          >
            {ar ? 'جدّد شهر' : 'Renew for a month'}
            {billing.renewalPriceMinor ? ' · ' + money(ar, billing.renewalPriceMinor) : ''}
          </button>
        </div>
      )}
      {billing.renewal === 'too_early' && billing.renewalOpensAt && (
        <p className="muted">
          {(ar ? 'التجديد بيفتح يوم ' : 'Renewal opens on ') +
            day(ar, billing.renewalOpensAt) +
            '.'}
        </p>
      )}
      {renewalOrder && (
        <>
          <ol className="transfer-steps">
            <li>
              <span>
                {ar ? 'حوّل ' : 'Send '}
                <strong>{money(ar, renewalOrder.amount_minor)}</strong>
                {ar ? ' بالظبط على رقم InstaPay ده:' : ' exactly to this InstaPay number:'}
              </span>
              <CopyField value={renewalOrder.recipient_account} lang={lang} />
            </li>
            <li>
              {ar
                ? 'اكتب رقم العملية وارفع صورة الإيصال. الشهر الجديد بيتضاف على طول، وإحنا بنراجع التحويل بعدها.'
                : 'Enter the transaction number and upload the receipt. The new month is added straight away; we review the transfer afterwards.'}
            </li>
          </ol>
          <PaymentReceipt
            order={renewalOrder}
            lang={lang}
            onSaved={() => setAttempt((value) => value + 1)}
          />
        </>
      )}
    </section>
  );
}
