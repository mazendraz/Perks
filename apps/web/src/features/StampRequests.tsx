import { Select } from '../controls/Select.js';
import { FieldErrors, fieldProps } from '../FieldErrors.js';
import { useEffect, useState, type FormEvent } from 'react';
import type {
  Grant,
  Language,
  SavedCard,
  AwardResult,
} from '../../../../packages/contracts/src/index.js';
import { api, errorText, ApiError } from '../api.js';
interface CustomerRequest {
  id: string;
  membership_id: string;
  branch_id: string;
  status: string;
  code?: string;
  expires_at: string;
  result?: { reference: string; quantity: number };
  reason?: string;
}
interface QueuedRequest {
  id: string;
  membership_id: string;
  branch_id: string;
  alias: string;
  max_per_tx: number;
  expires_at: string;
}
export function CustomerRequests({ card, lang }: { card: SavedCard; lang: Language }) {
  const ar = lang === 'ar',
    [branches, setBranches] = useState<{ id: string; name: string }[]>([]),
    [branch, setBranch] = useState(''),
    [requests, setRequests] = useState<CustomerRequest[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const load = async () => {
    try {
      const r = await api<{ requests: CustomerRequest[] }>('/me/stamp-requests');
      setRequests(r.requests.filter((r) => r.membership_id === card.id));
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void api<{ branches: typeof branches }>('/public/merchants/' + card.merchant_slug)
      .then((r) => {
        setBranches(r.branches);
        setBranch(new URLSearchParams(location.search).get('b') || r.branches[0]?.id || '');
      })
      .catch((e) => setError(errorText(e, lang)));
    void load();
    const iv = setInterval(() => {
      if (!document.hidden) void load();
    }, 3000);
    return () => clearInterval(iv);
  }, [card.id]);
  const pending = requests.find((r) => r.status === 'pending'),
    latest = requests[0];
  const create = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/me/stamp-requests', {
        method: 'POST',
        key: crypto.randomUUID(),
        body: { membershipId: card.id, branchId: branch },
      });
      await load();
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <h2>{ar ? 'اطلب ختم من الفرع' : 'Request a branch stamp'}</h2>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {pending ? (
        <>
          <div className="match-code">{pending.code}</div>
          <p>
            {ar
              ? 'قول الكود للكاشير بعد ما يتأكد من الشراء. الطلب لوحده مش بيضيف أختام.'
              : 'Show this code to the cashier after they verify the purchase. A request alone awards no stamps.'}
          </p>
          <small>
            {ar ? 'صالح لحد ' : 'Valid until '}
            {new Date(pending.expires_at).toLocaleTimeString(lang)}
          </small>
          <button
            className="text-button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              setBusy(true);
              void api('/me/stamp-requests/' + pending.id + '/cancel', { method: 'POST', body: {} })
                .then(load)
                .catch((e) => setError(errorText(e, lang)))
                .finally(() => setBusy(false));
            }}
          >
            {ar ? 'إلغاء الطلب' : 'Cancel request'}
          </button>
        </>
      ) : (
        <>
          <label>
            {ar ? 'الفرع اللي بتشتري منه' : 'Purchase branch'}
            <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
              {branches.map((b) => (
                <option value={b.id} key={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </label>
          <button
            className="secondary full"
            disabled={busy || !branch || !card.earning_active}
            onClick={() => void create()}
          >
            {ar ? 'طلب ختم' : 'Request stamp'}
          </button>
          {latest && (
            <p className="notice" role="status">
              {latest.status === 'approved'
                ? (ar ? 'الطلب اتوافق عليه: ' : 'Request approved: ') + latest.result?.reference
                : latest.status === 'rejected'
                  ? (ar ? 'الطلب اترفض: ' : 'Request rejected: ') + latest.reason
                  : latest.status === 'cancelled'
                    ? ar
                      ? 'الطلب اتلغى.'
                      : 'Request cancelled.'
                    : ar
                      ? 'انتهت صلاحية الطلب.'
                      : 'Request expired.'}
            </p>
          )}
        </>
      )}
    </section>
  );
}
interface PendingDecision {
  key: string;
  scope: string;
  merchantId: string;
  request: QueuedRequest;
  body:
    | { approve: false; reason: string }
    | {
        approve: true;
        award: {
          membershipId: string;
          branchId: string;
          quantity: number;
          purchaseReference: { namespace: 'manual'; reference: string; businessDate: string };
        };
      };
}
export function CashierRequests({
  grant,
  branch,
  lang,
  onCommitted,
}: {
  grant: Grant;
  branch: string;
  lang: Language;
  onCommitted: () => void;
}) {
  const ar = lang === 'ar',
    storageKey = 'nuqta-request-decision-' + grant.id,
    [requests, setRequests] = useState<QueuedRequest[]>([]),
    [selected, setSelected] = useState<QueuedRequest | null>(null),
    [code, setCode] = useState(''),
    [qty, setQty] = useState(1),
    [receipt, setReceipt] = useState(''),
    [reason, setReason] = useState(''),
    [reject, setReject] = useState(false),
    [key, setKey] = useState(''),
    [pending, setPending] = useState<PendingDecision | null>(null),
    [resumable, setResumable] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<AwardResult | null>(null);
  const [validation, setValidation] = useState<ApiError | null>(null);
  const load = async () => {
    try {
      const r = await api<{ requests: QueuedRequest[] }>(
        '/merchants/' + grant.merchant_id + '/stamp-requests?branchId=' + branch,
      );
      setRequests(r.requests);
    } catch (e) {
      setValidation(e instanceof ApiError ? e : null);
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void load();
    try {
      const p = sessionStorage.getItem(storageKey);
      if (p) setPending(JSON.parse(p));
    } catch {
      /* No write is inferred from unavailable local recovery data. */
    }
    const iv = setInterval(() => {
      if (!document.hidden) void load();
    }, 3000);
    return () => clearInterval(iv);
  }, [branch]);
  const recover = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await api<{ status: string; result: AwardResult }>(
        '/operations/by-key?scope=' + encodeURIComponent(pending.scope) + '&key=' + pending.key,
      );
      if (r.status === 'committed') {
        if (r.result.reference) setResult(r.result);
        setError('');
        setResumable(false);
        setSelected(null);
        setPending(null);
        sessionStorage.removeItem(storageKey);
        onCommitted();
        await load();
      } else if (
        pending.request &&
        pending.body &&
        pending.merchantId === grant.merchant_id &&
        pending.request.branch_id === branch
      ) {
        setSelected(pending.request);
        setKey(pending.key);
        setReject(!pending.body.approve);
        setCode('');
        if (pending.body.approve) {
          setQty(pending.body.award.quantity);
          setReceipt(pending.body.award.purchaseReference.reference);
        } else setReason(pending.body.reason);
        setResumable(true);
        setError(
          ar
            ? 'القرار لسه متسجلش. راجع نفس التفاصيل وأدخل كود العميل لإكماله.'
            : 'No committed decision. Review the saved details and re-enter the customer code to resume.',
        );
      } else
        setError(
          ar
            ? 'اختار الفرع الأصلي للقرار المحفوظ.'
            : 'Select the original branch for this saved decision.',
        );
    } catch (e) {
      setValidation(e instanceof ApiError ? e : null);
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError('');
    const attempt: PendingDecision = pending || {
      key,
      scope: reject ? 'request.reject:' + selected.id : 'stamp.award:' + grant.merchant_id,
      merchantId: grant.merchant_id,
      request: selected,
      body: reject
        ? { approve: false, reason }
        : {
            approve: true,
            award: {
              membershipId: selected.membership_id,
              branchId: branch,
              quantity: qty,
              purchaseReference: {
                namespace: 'manual',
                reference: receipt,
                businessDate: new Intl.DateTimeFormat('en-CA', {
                  timeZone: grant.timezone,
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                }).format(new Date()),
              },
            },
          },
    };
    // The matching code is deliberately never persisted. The original command,
    // business date and idempotency key survive ambiguous responses and reloads.
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(attempt));
      setPending(attempt);
      const result = await api<AwardResult>(
        '/merchants/' + attempt.merchantId + '/stamp-requests/' + attempt.request.id + '/decision',
        {
          method: 'POST',
          key: attempt.key,
          body: attempt.body.approve ? { ...attempt.body, code } : attempt.body,
        },
      );
      if (!reject) setResult(result);
      setSelected(null);
      setPending(null);
      sessionStorage.removeItem(storageKey);
      onCommitted();
      await load();
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        ![401, 403, 429].includes(e.status)
      ) {
        setPending(null);
        sessionStorage.removeItem(storageKey);
      }
      setValidation(e instanceof ApiError ? e : null);
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <h2>
        {ar ? 'طلبات العملاء' : 'Customer requests'}{' '}
        <span className="badge">{requests.length}</span>
      </h2>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {result && (
        <div className="notice success" role="status">
          {ar ? 'اتحفظت العملية: ' : 'Transaction saved: '}
          <bdi>{result.reference}</bdi> ·+{result.quantity}
          <button className="text-button" onClick={() => setResult(null)}>
            {ar ? 'إغلاق' : 'Close'}
          </button>
        </div>
      )}
      {pending && (
        <div className="notice">
          <p>{ar ? 'فيه قرار محتاج تأكيد نتيجته.' : 'A decision needs its outcome confirmed.'}</p>
          <button
            className="secondary"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void recover()}
          >
            {ar ? 'تحقق من نفس القرار' : 'Check the same decision'}
          </button>
        </div>
      )}
      {requests.length ? (
        requests.map((r) => (
          <div className="list-row" key={r.id}>
            <div>
              <strong>{r.alias}</strong>
              <small>{new Date(r.expires_at).toLocaleTimeString(lang)}</small>
            </div>
            <button
              className="secondary small"
              disabled={!!pending}
              onClick={() => {
                setSelected(r);
                setCode('');
                setQty(1);
                setReceipt('');
                setReason('');
                setReject(false);
                setError('');
                setKey(crypto.randomUUID());
              }}
            >
              {ar ? 'مراجعة الطلب' : 'Review request'}
            </button>
          </div>
        ))
      ) : (
        <p className="muted">
          {ar ? 'مفيش طلبات مفتوحة في الفرع.' : 'No open requests at this branch.'}
        </p>
      )}
      {selected && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="request-title"
            onSubmit={(e) => void submit(e)}
          >
            <h2 id="request-title">{selected.alias}</h2>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            <FieldErrors error={validation} lang={lang} />
            {pending && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                aria-busy={busy}
                onClick={() => void recover()}
              >
                {ar ? 'تحقق من نفس القرار' : 'Check the same decision'}
              </button>
            )}
            <fieldset disabled={busy} aria-busy={busy}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={reject}
                  disabled={!!pending}
                  onChange={(e) => setReject(e.target.checked)}
                />
                {ar ? 'رفض الطلب' : 'Reject request'}
              </label>
              {reject ? (
                <label>
                  {ar ? 'سبب الرفض' : 'Rejection reason'}
                  <textarea
                    required
                    minLength={4}
                    readOnly={!!pending}
                    {...fieldProps(validation, 'reason')}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              ) : (
                <>
                  <label>
                    {ar ? 'كود العميل' : 'Customer matching code'}
                    <input
                      autoFocus
                      dir="ltr"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      required
                      {...fieldProps(validation, 'code')}
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </label>
                  <label>
                    {ar ? 'رقم الإيصال' : 'Request receipt number'}
                    <input
                      required
                      maxLength={120}
                      readOnly={!!pending}
                      {...fieldProps(validation, 'award.purchaseReference.reference')}
                      value={receipt}
                      onChange={(e) => setReceipt(e.target.value)}
                    />
                  </label>
                  <label>
                    {ar ? 'عدد الأختام' : 'Stamp quantity'}
                    <input
                      type="number"
                      readOnly={!!pending}
                      min={1}
                      max={Math.min(selected.max_per_tx, grant.max_qty)}
                      {...fieldProps(validation, 'award.quantity')}
                      value={qty}
                      onChange={(e) => setQty(Number(e.target.value))}
                    />
                  </label>
                  <p className="muted">
                    {ar
                      ? 'راجع الشراء بنفسك. الإيصال المستخدم في المسح ما ينفعش يتكرر هنا.'
                      : 'Verify the purchase. A receipt already used by scanning cannot be awarded here again.'}
                  </p>
                </>
              )}
            </fieldset>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                disabled={!!pending}
                data-dialog-close
                onClick={() => setSelected(null)}
              >
                {ar ? 'رجوع' : 'Back'}
              </button>
              <button className="primary" disabled={busy || (!!pending && !resumable)}>
                {reject
                  ? ar
                    ? 'تأكيد الرفض'
                    : 'Confirm rejection'
                  : ar
                    ? 'اعتماد طلب الختم'
                    : 'Approve stamp request'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
