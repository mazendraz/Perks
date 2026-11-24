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
  shop_name: string;
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
  const expected = new Intl.NumberFormat(ar ? 'ar-EG' : 'en-EG', {
    style: 'currency',
    currency: 'EGP',
  }).format(order.amount_minor / 100);

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
    <article className="panel">
      <h2>{order.shop_name}</h2>
      <dl>
        <dt>{ar ? 'المبلغ المطلوب' : 'Expected amount'}</dt>
        <dd>{expected}</dd>
        <dt>{ar ? 'حساب الاستلام' : 'Receiving account'}</dt>
        <dd>
          <bdi>{order.recipient_account}</bdi>
        </dd>
        <dt>{ar ? 'رقم العملية المرسل' : 'Submitted reference'}</dt>
        <dd>
          <bdi>{order.submitted_reference}</bdi>
        </dd>
      </dl>
      <a
        href={
          '/api/v1' +
          endpoint +
          '/' +
          order.id +
          '/receipt?__portal=platform&version=' +
          order.receipt_key
        }
        target="_blank"
        rel="noreferrer"
      >
        {ar ? 'افتح صورة الإيصال' : 'Open receipt image'}
      </a>
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
      <form onSubmit={reject} aria-busy={busy}>
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
          <button className="secondary" disabled={busy || reason.trim().length < 4}>
            {ar ? 'ارفض التحويل' : 'Reject transfer'}
          </button>
        </div>
      </form>
    </article>
  );
}
