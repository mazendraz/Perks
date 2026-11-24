import { createPortal } from 'react-dom';
import { ActionLabel } from '../../../../packages/ui/src/Icon.js';
import { useLiveRefresh } from '../live-events.js';
import { useAutoStampRequest } from '../useAutoStampRequest.js';
import { useEffect, useState, useRef, useId } from 'react';
import type { Language, SavedCard } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
import { intlLocale } from '../locale.js';
export interface VisitNotice {
  tone: 'info' | 'error';
  text: string;
  retry?: () => void;
}
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
  onAwarded,
  onNotice,
  stampDock,
}: {
  card: SavedCard;
  stampDock?: HTMLElement | null;
  lang: Language;
  onPending?: (pending: boolean) => void;
  onAwarded?: () => Promise<void> | void;
  onNotice?: (notice: VisitNotice | null) => void;
}) {
  const ar = lang === 'ar',
    [branches, setBranches] = useState<{ id: string; name: string }[] | null>(null),
    [branch, setBranch] = useState(''),
    [requests, setRequests] = useState<CustomerRequest[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const submitting = useRef(false);
  const scannedBranch = new URLSearchParams(location.search).get('b');
  const automaticBranch = scannedBranch || branch;
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
  const visit = useAutoStampRequest(
    card,
    automaticBranch,
    !!branches?.some((b) => b.id === automaticBranch),
    lang,
    load,
    async () => {
      await onAwarded?.();
    },
  );
  // The visit result sits under the card, where the customer is already looking.
  useEffect(() => {
    onNotice?.(
      visit.notice
        ? { ...visit.notice, retry: visit.notice.retry ? visit.retry : undefined }
        : null,
    );
  }, [visit.notice]);
  useEffect(() => () => onNotice?.(null), [card.id]);
  useEffect(() => {
    let alive = true;
    setRequests([]);
    void api<{ branches: NonNullable<typeof branches> }>('/public/merchants/' + card.merchant_slug)
      .then((r) => {
        if (!alive) return;
        setBranches(r.branches);
        setBranch(
          r.branches.find((option) => option.id === scannedBranch)?.id ?? r.branches[0]?.id ?? '',
        );
      })
      .catch((e) => {
        if (alive) {
          setBranches([]);
          setError(errorText(e, lang));
        }
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
  const create = async (branchId: string) => {
    if (
      submitting.current ||
      pending ||
      !card.earning_active ||
      !branches?.some((option) => option.id === branchId)
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await api('/me/stamp-requests', {
        method: 'POST',
        key: crypto.randomUUID(),
        body: { membershipId: card.id, branchId },
      });
      await load();
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const requestLabel = pending
    ? ar
      ? 'تابع طلب الختم'
      : 'View stamp request'
    : ar
      ? 'اطلب ختم'
      : 'Request a stamp';
  const launcher = (className: string) => (
    <button
      type="button"
      className={className}
      aria-haspopup="dialog"
      disabled={busy || (!pending && branches === null)}
      aria-busy={busy || branches === null}
      onClick={() => {
        setOpen(true);
        if (!pending && branches?.length === 1) void create(branches[0]!.id);
      }}
    >
      <ActionLabel icon="stamp">{requestLabel}</ActionLabel>
    </button>
  );
  return (
    <>
      {launcher(stampDock ? 'primary customer-stamp-inline' : 'primary')}
      {stampDock && createPortal(launcher('primary'), stampDock)}
      {open &&
        createPortal(
          <div
            className="modal-backdrop customer-action-backdrop"
            data-portal="customer"
            onClick={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <section
              className="dialog customer-action-dialog customer-stamp-request"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
            >
              <div className="customer-action-heading">
                <h2 id={titleId}>{ar ? 'اطلب ختم من الفرع' : 'Request a branch stamp'}</h2>
                <button
                  type="button"
                  className="text-button"
                  data-dialog-close
                  onClick={() => setOpen(false)}
                >
                  {ar ? 'إغلاق' : 'Close'}
                </button>
              </div>
              {error && (
                <p className="error-text" role="alert">
                  {error}
                </p>
              )}
              {pending ? (
                <>
                  <p role="status">
                    {ar
                      ? 'الطلب وصل للكاشير. استنى لحظة لحد ما يأكد الختم من عنده.'
                      : 'Your request reached the cashier. Wait a moment while they confirm the stamp.'}
                  </p>
                  <small>
                    {ar ? 'صالح لحد ' : 'Valid until '}
                    {new Date(pending.expires_at).toLocaleTimeString(intlLocale(lang))}
                  </small>
                  <button
                    className="text-button"
                    disabled={busy}
                    aria-busy={busy}
                    onClick={() => {
                      setBusy(true);
                      void api('/me/stamp-requests/' + pending.id + '/cancel', {
                        method: 'POST',
                        body: {},
                      })
                        .then(load)
                        .catch((e) => setError(errorText(e, lang)))
                        .finally(() => setBusy(false));
                    }}
                  >
                    <ActionLabel icon="close">{ar ? 'إلغاء الطلب' : 'Cancel request'}</ActionLabel>
                  </button>
                </>
              ) : (
                <>
                  {busy ? (
                    <p role="status">{ar ? 'بنبعت طلب الختم…' : 'Sending stamp request…'}</p>
                  ) : branches && branches.length > 1 ? (
                    <>
                      <label>
                        {ar ? 'الفرع اللي بتشتري منه' : 'Purchase branch'}
                        <select value={branch} onChange={(event) => setBranch(event.target.value)}>
                          {branches.map((option) => (
                            <option value={option.id} key={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="secondary full"
                        disabled={!branch || !card.earning_active}
                        onClick={() => void create(branch)}
                      >
                        <ActionLabel icon="stamp">{ar ? 'طلب ختم' : 'Request stamp'}</ActionLabel>
                      </button>
                    </>
                  ) : !error && !branches?.length ? (
                    <p className="muted">{ar ? 'مفيش فروع متاحة.' : 'No branches available.'}</p>
                  ) : !card.earning_active ? (
                    <p className="muted">
                      {ar ? 'جمع الأختام متوقف حاليًا.' : 'Stamp collection is paused.'}
                    </p>
                  ) : null}
                  {!busy && latest && (
                    <p className="notice" role="status">
                      {latest.status === 'approved'
                        ? (ar ? 'الطلب اتوافق عليه: ' : 'Request approved: ') +
                          latest.result?.reference
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
          </div>,
          document.body,
        )}
    </>
  );
}
export { CashierRequests } from './RequestQueue.js';
