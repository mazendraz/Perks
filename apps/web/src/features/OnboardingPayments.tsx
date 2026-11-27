import { useEffect, useState, type FormEvent } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';

const endpoint = '/platform/onboarding-payments';
type Payment = {
  id: string;
  amount_minor: number;
  recipient_account: string;
  submitted_reference: string;
  receipt_key: string;
  receipt_submitted_at: string | null;
  shop_name: string;
  plan_name_ar: string;
  plan_name_en: string;
  owner_name: string | null;
  owner_email: string | null;
  /** The shop was already published: rejecting pauses a live shop. */
  live: boolean;
  /** A corrected transfer after an earlier rejection. */
  correction: boolean;
};

export function OnboardingPayments({ lang }: { lang: Language }) {
  const ar = lang === 'ar';
  const [orders, setOrders] = useState<Payment[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState(false);
  useEffect(() => {
    let active = true;
    void api<{ orders: Payment[] }>(endpoint)
      .then((result) => {
        if (active) setOrders(result.orders);
      })
      .catch((failure: unknown) => {
        if (active) setError(failure);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  return (
    <section aria-labelledby="onboarding-reviews">
      <h1 id="onboarding-reviews">
        {ar ? 'مراجعة تحويلات InstaPay' : 'Review InstaPay transfers'}
      </h1>
      {notice && <p role="status">{ar ? 'قرار المراجعة اتحفظ.' : 'Review decision saved.'}</p>}
      {error != null && (
        <p role="alert" className="notice error">
          {errorText(error, lang)}
        </p>
      )}
      <button
        type="button"
        className="secondary"
        onClick={() => {
          setError(null);
          setOrders(null);
          setNotice(false);
          setAttempt((value) => value + 1);
        }}
      >
        {ar ? 'حدّث القائمة' : 'Refresh list'}
      </button>
      {!orders && error == null && (
        <p role="status">{ar ? 'بنحمّل التحويلات…' : 'Loading transfers…'}</p>
      )}
      {orders?.length === 0 && (
        <p>{ar ? 'مفيش تحويلات قيد المراجعة.' : 'No transfers awaiting review.'}</p>
      )}
      {orders?.map((order) => (
        <PaymentReview
          key={order.receipt_key}
          order={order}
          lang={lang}
          onConfirmed={() => {
            setOrders((previous) => previous?.filter((row) => row.id !== order.id) ?? null);
            setNotice(true);
          }}
        />
      ))}
    </section>
  );
}

function PaymentReview({
  order,
  lang,
  onConfirmed,
}: {
  order: Payment;
  lang: Language;
  onConfirmed: () => void;
}) {
  const ar = lang === 'ar';
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const expected = new Intl.NumberFormat(ar ? 'ar-EG-u-nu-latn' : 'en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 0,
  }).format(order.amount_minor / 100);
  const receiptUrl =
    '/api/v1' +
    endpoint +
    '/' +
    order.id +
    '/receipt?__portal=platform&version=' +
    order.receipt_key;
  const sentAt = order.receipt_submitted_at
    ? new Intl.DateTimeFormat(ar ? 'ar-EG-u-nu-latn' : 'en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(order.receipt_submitted_at))
    : null;

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(endpoint + '/' + order.id + '/confirm', {
        method: 'POST',
        body: {
          receiptKey: order.receipt_key,
          recipientAccountId: order.recipient_account,
          reference,
          amountMinor: Math.round(Number(amount) * 100),
        },
      });
      onConfirmed();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  async function reject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api(endpoint + '/' + order.id + '/reject', {
        method: 'POST',
        body: { receiptKey: order.receipt_key, reason },
      });
      onConfirmed();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="panel payment-review">
      <div className="payment-review-head">
        <h2>
          <bdi>{order.shop_name}</bdi>
        </h2>
        <span className="payment-review-badges">
          {order.live && <span className="badge">{ar ? 'المحل شغال' : 'Shop is live'}</span>}
          {order.correction && (
            <span className="badge">{ar ? 'تحويل مصحّح' : 'Corrected transfer'}</span>
          )}
        </span>
      </div>
      <div className="payment-review-body">
        <dl className="onboarding-summary">
          <dt>{ar ? 'الباقة' : 'Plan'}</dt>
          <dd>
            <bdi>{ar ? order.plan_name_ar : order.plan_name_en}</bdi> · {expected}{' '}
            {ar ? 'شهريًا' : 'a month'}
          </dd>
          <dt>{ar ? 'صاحب المحل' : 'Owner'}</dt>
          <dd>
            <bdi>{order.owner_name}</bdi>
            {order.owner_email && (
              <>
                {' · '}
                <a href={'mailto:' + order.owner_email} dir="ltr">
                  {order.owner_email}
                </a>
              </>
            )}
          </dd>
          {sentAt && (
            <>
              <dt>{ar ? 'وصل الإيصال' : 'Receipt sent'}</dt>
              <dd>{sentAt}</dd>
            </>
          )}
          <dt>{ar ? 'حساب الاستلام' : 'Receiving account'}</dt>
          <dd>
            <bdi dir="ltr">{order.recipient_account}</bdi>
          </dd>
          <dt>{ar ? 'رقم العملية من التاجر' : 'Owner’s reference'}</dt>
          <dd>
            <bdi dir="ltr">{order.submitted_reference}</bdi>
          </dd>
        </dl>
        <a className="payment-review-receipt" href={receiptUrl} target="_blank" rel="noreferrer">
          <img src={receiptUrl} alt={ar ? 'صورة الإيصال' : 'Receipt image'} loading="lazy" />
          <span>{ar ? 'افتح الإيصال بالحجم الكامل' : 'Open full-size receipt'}</span>
        </a>
      </div>
      <form onSubmit={confirm} aria-busy={busy}>
        <p>
          {ar
            ? 'طابق التحويل مع كشف حساب الاستلام قبل التأكيد.'
            : 'Match the incoming transfer against the receiving account statement before confirming.'}
        </p>
        <label>
          {ar ? 'رقم العملية في كشف الحساب' : 'Statement reference'}
          <input
            dir="ltr"
            required
            minLength={3}
            maxLength={120}
            disabled={busy}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <label>
          {ar ? 'المبلغ الوارد بالجنيه' : 'Received amount in EGP'}
          <input
            type="number"
            min="0.01"
            step="0.01"
            required
            disabled={busy}
            placeholder={String(order.amount_minor / 100)}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        {error != null && (
          <p role="alert" className="notice error">
            {errorText(error, lang)}
          </p>
        )}
        <div className="form-actions">
          <button className="primary" disabled={busy}>
            {busy ? (ar ? 'بنأكد…' : 'Confirming…') : ar ? 'أكد التحويل' : 'Confirm transfer'}
          </button>
        </div>
      </form>
      <details className="payment-review-reject">
        <summary>{ar ? 'التحويل مش مظبوط؟ ارفضه' : 'Transfer not right? Reject it'}</summary>
        <form onSubmit={reject} aria-busy={busy}>
          <p className={order.live ? 'notice error' : 'muted'}>
            {order.live
              ? ar
                ? 'المحل ده شغال دلوقتي. الرفض هيوقفه لحد ما التاجر يصحّح التحويل، وهيوصله إيميل بالسبب.'
                : 'This shop is live. Rejecting pauses it until the owner corrects the transfer; they get an email with the reason.'
              : ar
                ? 'التاجر هيوصله إيميل بالسبب ويقدر يصحّح التحويل.'
                : 'The owner gets an email with the reason and can correct the transfer.'}
          </p>
          <label>
            {ar ? 'سبب الرفض اللي هيظهر للتاجر' : 'Rejection reason shown to the merchant'}
            <textarea
              required
              minLength={4}
              maxLength={500}
              disabled={busy}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="form-actions">
            <button className="danger" disabled={busy || reason.trim().length < 4}>
              {order.live
                ? ar
                  ? 'ارفض ووقّف المحل'
                  : 'Reject and pause shop'
                : ar
                  ? 'ارفض التحويل'
                  : 'Reject transfer'}
            </button>
          </div>
        </form>
      </details>
    </article>
  );
}
