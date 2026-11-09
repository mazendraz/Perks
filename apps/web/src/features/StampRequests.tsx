import { Select } from '../controls/Select.js';
import { useLiveRefresh } from '../live-events.js';
import { useAutoStampRequest } from '../useAutoStampRequest.js';
import { useEffect, useState, useRef } from 'react';
import type { Language, SavedCard } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
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
export function CustomerRequests({
  card,
  lang,
  onPending,
}: {
  card: SavedCard;
  lang: Language;
  onPending?: (pending: boolean) => void;
}) {
  const ar = lang === 'ar',
    [branches, setBranches] = useState<{ id: string; name: string }[]>([]),
    [branch, setBranch] = useState(''),
    [requests, setRequests] = useState<CustomerRequest[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const load = async () => {
    const generation = ++loadGeneration.current;
    try {
      const r = await api<{ requests: CustomerRequest[] }>('/me/stamp-requests');
      if (generation !== loadGeneration.current) return;
      setRequests(r.requests.filter((r) => r.membership_id === card.id));
    } catch (e) {
      if (generation === loadGeneration.current) setError(errorText(e, lang));
    }
  };
  const loadGeneration = useRef(0);
  useLiveRefresh('/me/events', load);
  useAutoStampRequest(
    card,
    branch,
    branches.some((b) => b.id === branch),
    lang,
    load,
    setError,
  );
  useEffect(() => {
    let alive = true;
    setRequests([]);
    void api<{ branches: typeof branches }>('/public/merchants/' + card.merchant_slug)
      .then((r) => {
        if (!alive) return;
        setBranches(r.branches);
        setBranch(new URLSearchParams(location.search).get('b') || r.branches[0]?.id || '');
      })
      .catch((e) => {
        if (alive) setError(errorText(e, lang));
      });
    void load();
    return () => {
      alive = false;
      loadGeneration.current++;
    };
  }, [card.id]);
  const pending = requests.find((r) => r.status === 'pending'),
    latest = requests[0];
  useEffect(() => {
    onPending?.(!!pending);
  }, [pending?.id, pending?.status, onPending]);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(
      () =>
        setRequests((current) =>
          current.map((r) => (r.id === pending.id ? { ...r, status: 'expired' } : r)),
        ),
      Math.max(0, new Date(pending.expires_at).getTime() - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [pending?.id, pending?.expires_at]);
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
                      ? 'الطلب خلص، اعمل سكان تاني.'
                      : 'The request expired. Scan the shop code again.'}
            </p>
          )}
        </>
      )}
    </section>
  );
}
export { CashierRequests } from './RequestQueue.js';
