import { useEffect, useState, type FormEvent } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import {
  subscriptionPaymentInput,
  subscriptionPauseInput,
  subscriptionVoidInput,
  type SubscriptionState,
} from '../../../../packages/contracts/src/subscriptions.js';
import { moneyMinor } from '../../../../packages/domain/src/subscriptions.js';
import { api, ApiError, errorText } from '../api.js';
import { DateField } from '../controls/DateField.js';
import { Select } from '../controls/Select.js';
type Attempt = {
  kind: 'payment' | 'pause' | 'void';
  key: string;
  revision: number;
  body: unknown;
  paymentId?: string;
};
const today = () => {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
};
function recover(storageKey: string): Attempt | null {
  try {
    const a = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (
      !a ||
      !['payment', 'pause', 'void'].includes(a.kind) ||
      typeof a.key !== 'string' ||
      !Number.isInteger(a.revision) ||
      a.revision < 1
    )
      return null;
    if (a.kind === 'void' && !/^[a-f0-9-]{36}$/.test(a.paymentId)) return null;
    if (
      !(
        a.kind === 'payment'
          ? subscriptionPaymentInput
          : a.kind === 'pause'
            ? subscriptionPauseInput
            : subscriptionVoidInput
      ).safeParse(a.body).success
    )
      return null;
    return a as Attempt;
  } catch {
    return null;
  }
}
export function Subscriptions({
  merchantId,
  lang,
  readOnly = false,
  viewerId = '',
}: {
  merchantId: string;
  lang: Language;
  readOnly?: boolean;
  viewerId?: string;
}) {
  const ar = lang === 'ar',
    storageKey = 'nuqta-subscription-attempt:' + viewerId + ':' + merchantId;
  const [attempt, setAttempt] = useState<Attempt | null>(() =>
      readOnly ? null : recover(storageKey),
    ),
    [data, setData] = useState<SubscriptionState | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState('');
  const saved = attempt?.kind === 'payment' ? subscriptionPaymentInput.parse(attempt.body) : null;
  const [showForm, setShowForm] = useState(!!saved),
    [amount, setAmount] = useState(saved ? (saved.amountMinor / 100).toFixed(2) : ''),
    [method, setMethod] = useState(saved?.method || 'instapay'),
    [start, setStart] = useState(saved?.periodStart || today()),
    [end, setEnd] = useState(saved?.periodEnd || today()),
    [reference, setReference] = useState(saved?.reference || ''),
    [reason, setReason] = useState(saved?.reason || ''),
    [resume, setResume] = useState(saved?.resumeEarning ?? true);
  const [action, setAction] = useState<
      { kind: 'pause'; earningPaused: boolean } | { kind: 'void'; id: string } | null
    >(null),
    [actionReason, setActionReason] = useState('');
  const base = '/platform/merchants/' + merchantId + '/subscription';
  const load = async () => {
    try {
      setData(
        await api<SubscriptionState>(
          (readOnly ? '/merchants/' + merchantId : '/platform/merchants/' + merchantId) +
            '/subscription',
        ),
      );
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void load();
  }, [merchantId, readOnly]);
  const persist = (value: Attempt | null) => {
    setAttempt(value);
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* The current-tab retry still retains the exact command. */
    }
  };
  const execute = async (next: Attempt) => {
    persist(next);
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const path =
        next.kind === 'payment'
          ? base + '/payments'
          : next.kind === 'void'
            ? base + '/payments/' + next.paymentId + '/void'
            : base;
      await api(path, {
        method: next.kind === 'pause' ? 'PATCH' : 'POST',
        key: next.key,
        revision: next.revision,
        body: next.body,
      });
      persist(null);
      setShowForm(false);
      setAction(null);
      setAmount('');
      setReference('');
      setReason('');
      setSuccess(ar ? 'اتحفظ التغيير في سجل الاشتراك.' : 'The subscription change was saved.');
      await load();
    } catch (e) {
      setAction(null);
      setError(errorText(e, lang));
      if (!(e instanceof ApiError) || e.status !== 0) {
        persist(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  };
  const payment = (event: FormEvent) => {
    event.preventDefault();
    if (!data) return;
    if (attempt) {
      void execute(attempt);
      return;
    }
    const minor = moneyMinor(amount);
    if (minor === null) {
      setError(
        ar
          ? 'اكتب مبلغًا صحيحًا بالجنيه، لحد رقمين بعد العلامة.'
          : 'Enter a valid EGP amount with at most two decimal places.',
      );
      return;
    }
    const parsed = subscriptionPaymentInput.safeParse({
      amountMinor: minor,
      method,
      periodStart: start,
      periodEnd: end,
      reference,
      reason,
      resumeEarning: resume,
    });
    if (!parsed.success) {
      setError(
        ar
          ? 'راجع المبلغ والفترة وسبب التسجيل. نهاية الفترة ما تكونش قبل بدايتها.'
          : 'Check the amount, period and recording reason. The end date must not precede the start.',
      );
      return;
    }
    void execute({
      kind: 'payment',
      key: crypto.randomUUID(),
      revision: data.revision,
      body: parsed.data,
    });
  };
  const methodName = (value: string) =>
    ({
      instapay: ar ? 'إنستاباي' : 'InstaPay',
      cash: ar ? 'كاش' : 'Cash',
      bank_transfer: ar ? 'تحويل بنكي' : 'Bank transfer',
      vodafone_cash: ar ? 'فودافون كاش' : 'Vodafone Cash',
    })[value] || value;
  return (
    <section className="subscription-panel">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{ar ? 'اشتراك المحل' : 'SHOP SUBSCRIPTION'}</span>
          <h2>{ar ? 'الاشتراك والمدفوعات' : 'Subscription and payments'}</h2>
        </div>
        {!readOnly && (
          <button
            className="primary"
            disabled={busy || !!attempt}
            onClick={() => {
              setShowForm(true);
              setSuccess('');
            }}
          >
            {ar ? 'سجّل دفعة' : 'Record payment'}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="notice success">
          {success}
        </p>
      )}
      {attempt && (
        <div className="notice">
          <p>
            {ar
              ? 'في تغيير لسه بنتأكد من نتيجته. إعادة المحاولة بتستخدم نفس التسجيل من غير تكرار.'
              : 'A change still needs confirmation. Retrying uses the same command without duplicating it.'}
          </p>
          <button className="secondary" disabled={busy} onClick={() => void execute(attempt)}>
            {ar ? 'كمّل نفس المحاولة' : 'Retry same change'}
          </button>
        </div>
      )}
      {data ? (
        <div className="panel subscription-summary">
          <strong>
            {!data.billingRequired
              ? ar
                ? 'تشغيل تجريبي — الاشتراك التجاري مش مضبوط'
                : 'Test mode — commercial subscription is not configured'
              : data.earningAllowed
                ? ar
                  ? 'الاشتراك ساري'
                  : 'Subscription active'
                : ar
                  ? 'جمع الأختام متوقف'
                  : 'Stamp earning paused'}
          </strong>
          <p className="muted">
            {ar
              ? 'انتهاء الاشتراك أو إيقاف جمع الأختام ما بيمنعش عرض الكارت أو صرف مكافأة مكتسبة سارية.'
              : 'Expiry or an earning pause keeps cards visible and valid earned rewards redeemable.'}
          </p>
          <p>
            {ar ? 'موعد انتهاء التغطية: ' : 'Coverage ends: '}
            {data.expiresAt
              ? new Intl.DateTimeFormat(ar ? 'ar-EG' : 'en', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: data.timeZone,
                }).format(new Date(data.expiresAt))
              : '—'}
          </p>
          {!readOnly && (
            <button
              type="button"
              role="switch"
              className="business-status-switch"
              aria-label={ar ? 'السماح بجمع أختام جديدة' : 'Allow new stamp earning'}
              aria-checked={!data.earningPaused}
              disabled={busy || !!attempt}
              onClick={() => {
                setAction({ kind: 'pause', earningPaused: !data.earningPaused });
                setActionReason('');
              }}
            >
              <span className="ios-switch-track" aria-hidden="true">
                <span />
              </span>
              <span className="switch-caption">
                {data.earningPaused
                  ? ar
                    ? 'موقوف يدويًا'
                    : 'Manually paused'
                  : ar
                    ? 'مسموح مع اشتراك ساري'
                    : 'Allowed with active coverage'}
              </span>
            </button>
          )}
        </div>
      ) : (
        <p role="status">{ar ? 'بنفتح الاشتراك…' : 'Loading subscription…'}</p>
      )}
      {!readOnly && showForm && (
        <form className="panel subscription-form" onSubmit={payment}>
          <h3>{ar ? 'تسجيل دفع يدوي' : 'Record a manual payment'}</h3>
          <p className="muted">
            {ar
              ? 'اكتب المبلغ اللي اتفقتم عليه واتحصل فعلًا. أسعار الديمو مش أسعار بيع معتمدة.'
              : 'Record the agreed amount actually received. Demo prices are not approved selling prices.'}
          </p>
          <div className="form-grid">
            <label>
              {ar ? 'المبلغ بالجنيه' : 'Amount in EGP'}
              <input
                dir="ltr"
                inputMode="decimal"
                required
                value={amount}
                disabled={busy || !!attempt}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="950.00"
              />
            </label>
            <label>
              {ar ? 'طريقة الدفع' : 'Payment method'}
              <Select
                value={method}
                disabled={busy || !!attempt}
                onChange={(e) => setMethod(e.target.value as typeof method)}
              >
                {['instapay', 'cash', 'bank_transfer', 'vodafone_cash'].map((v) => (
                  <option key={v} value={v}>
                    {methodName(v)}
                  </option>
                ))}
              </Select>
            </label>
            <DateField
              label={ar ? 'بداية الفترة' : 'Period starts'}
              lang={lang}
              value={start}
              onChange={setStart}
              disabled={busy || !!attempt}
            />
            <DateField
              label={ar ? 'آخر يوم في الفترة' : 'Last covered day'}
              lang={lang}
              value={end}
              onChange={setEnd}
              disabled={busy || !!attempt}
            />
            <label>
              {ar ? 'مرجع الدفعة (اختياري)' : 'Payment reference (optional)'}
              <input
                dir="ltr"
                maxLength={100}
                value={reference}
                disabled={busy || !!attempt}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
            <label>
              {ar ? 'سبب التسجيل' : 'Recording reason'}
              <textarea
                required
                minLength={4}
                maxLength={500}
                value={reason}
                disabled={busy || !!attempt}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={resume}
              disabled={busy || !!attempt}
              onChange={(e) => setResume(e.target.checked)}
            />
            {ar
              ? 'اسمح بجمع الأختام بعد الحفظ لو الفترة سارية'
              : 'Allow stamp earning after saving if coverage is current'}
          </label>
          <p className="muted">
            {ar
              ? 'الفترة بتتحسب بتوقيت المحل وتشمل آخر يوم اخترته.'
              : 'Dates use the shop timezone and include the last selected day.'}
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy || !!attempt}
              onClick={() => setShowForm(false)}
            >
              {ar ? 'رجوع' : 'Go back'}
            </button>
            <button className="primary" disabled={busy || !data}>
              {busy ? (ar ? 'بنحفظ…' : 'Saving…') : ar ? 'احفظ الدفعة' : 'Save payment'}
            </button>
          </div>
        </form>
      )}
      {data && (
        <section className="panel">
          <h3>{ar ? 'سجل المدفوعات' : 'Payment history'}</h3>
          {data.payments.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      ar ? 'المبلغ' : 'Amount',
                      ar ? 'الطريقة' : 'Method',
                      ar ? 'الفترة' : 'Period',
                      ar ? 'المرجع' : 'Reference',
                      ar ? 'سجّلها' : 'Recorded by',
                      ar ? 'الحالة' : 'Status',
                    ].map((label) => (
                      <th key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <bdi>
                          {new Intl.NumberFormat(ar ? 'ar-EG' : 'en', {
                            style: 'currency',
                            currency: 'EGP',
                          }).format(p.amount_minor / 100)}
                        </bdi>
                      </td>
                      <td>{methodName(p.method)}</td>
                      <td>
                        <bdi>
                          {p.period_start} – {p.period_end}
                        </bdi>
                      </td>
                      <td>
                        <bdi>{p.payment_reference || '—'}</bdi>
                      </td>
                      <td>{p.recorded_by_name}</td>
                      <td>
                        {p.voided_at ? (
                          ar ? (
                            'التسجيل ملغي'
                          ) : (
                            'Voided'
                          )
                        ) : readOnly ? (
                          ar ? (
                            'مسجلة'
                          ) : (
                            'Recorded'
                          )
                        ) : (
                          <button
                            className="text-button"
                            disabled={busy || !!attempt}
                            onClick={() => {
                              setAction({ kind: 'void', id: p.id });
                              setActionReason('');
                            }}
                          >
                            {ar ? 'إلغاء تسجيل الدفعة' : 'Void payment record'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">{ar ? 'مفيش مدفوعات مسجلة لسه.' : 'No payments recorded yet.'}</p>
          )}
        </section>
      )}
      {action && data && !readOnly && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="subscription-action-title"
            onSubmit={(e) => {
              e.preventDefault();
              void execute({
                kind: action.kind,
                key: crypto.randomUUID(),
                revision: data.revision,
                paymentId: action.kind === 'void' ? action.id : undefined,
                body:
                  action.kind === 'pause'
                    ? { earningPaused: action.earningPaused, reason: actionReason }
                    : { reason: actionReason },
              });
            }}
          >
            <h2 id="subscription-action-title">
              {action.kind === 'void'
                ? ar
                  ? 'إلغاء تسجيل الدفعة'
                  : 'Void payment record'
                : ar
                  ? 'تغيير جمع الأختام'
                  : 'Change stamp earning'}
            </h2>
            <p>
              {ar
                ? 'التغيير بيتسجل باسمك. صرف المكافآت المكتسبة بيفضل متاحًا، وإلغاء دفعة بيوقف فترتها لو مفيش تغطية تانية.'
                : 'The change is recorded under your account. Earned rewards remain redeemable; voiding a payment removes its coverage unless another payment covers it.'}
            </p>
            <label>
              {ar ? 'سبب التغيير' : 'Reason for change'}
              <textarea
                required
                minLength={4}
                maxLength={500}
                disabled={busy || !!attempt}
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                disabled={busy}
                onClick={() => setAction(null)}
              >
                {ar ? 'رجوع' : 'Go back'}
              </button>
              <button className="primary" disabled={busy || !!attempt}>
                {ar ? 'احفظ التغيير' : 'Save change'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
