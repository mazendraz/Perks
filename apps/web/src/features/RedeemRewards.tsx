import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActionLabel } from '../../../../packages/ui/src/Icon.js';
import type { Language, Reward, SavedCard } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
import { useLiveRefresh } from '../live-events.js';
import { intlLocale } from '../locale.js';

// The customer's rewards and redeeming them: tap Redeem, wait for the cashier (with the 2-digit match
// number the cashier also sees), then Redeemed or Rejected. No QR to show and nothing to scan.
export interface RedeemRequest {
  id: string;
  reward_id: string;
  membership_id: string;
  status: 'requested' | 'completed' | 'rejected' | 'cancelled' | 'expired' | string;
  match_number: number;
  expires_at: string;
  title: string;
}
export interface RewardAction {
  membershipId: string;
  available: boolean;
  pending: boolean;
  busy: boolean;
  request: () => void;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The branch the customer came through (the shop's sticker adds ?b=), so that branch is rung first.
const branchHint = () => {
  try {
    const b = new URLSearchParams(location.search).get('b');
    return b && uuid.test(b) ? b : undefined;
  } catch {
    return undefined;
  }
};

export function RedeemRewards({
  card,
  rewards = [],
  loading,
  lang,
  onChanged,
  onAction,
}: {
  card: SavedCard;
  rewards?: Reward[];
  loading: boolean;
  lang: Language;
  onChanged: () => Promise<void> | void;
  onAction?: (action: RewardAction | null) => void;
}) {
  const ar = lang === 'ar';
  const [show, setShow] = useState(false);
  const titleId = useId();
  const [requests, setRequests] = useState<RedeemRequest[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [dismissed, setDismissed] = useState<string[]>([]);
  // Requests this screen saw waiting: only their outcome is announced (not an old one on reload).
  const watched = useRef(new Set<string>());
  const generation = useRef(0);
  const seen = useRef(new Map<string, string>());
  const load = async () => {
    const mine = ++generation.current;
    try {
      const r = await api<{ requests: RedeemRequest[] }>('/me/redeem-requests', {
        timeoutMs: 8000,
      });
      if (mine !== generation.current) return;
      const list = r.requests.filter((x) => x.membership_id === card.id);
      for (const x of list) if (x.status === 'requested') watched.current.add(x.id);
      // The card moves on (or keeps its reward) once the cashier decided: read it again.
      const decided = list.some(
        (x) => x.status !== 'requested' && seen.current.get(x.id) === 'requested',
      );
      seen.current = new Map(list.map((x) => [x.id, x.status]));
      setRequests(list);
      if (decided) void onChanged();
    } catch {
      /* The next live event or poll tries again; the card itself is unaffected. */
    }
  };
  useLiveRefresh('/me/events', load);
  useEffect(() => {
    watched.current = new Set();
    seen.current = new Map();
    setRequests([]);
    void load();
    return () => {
      generation.current++;
    };
  }, [card.id]);
  const open = requests.find(
    (r) => r.status === 'requested' && Date.parse(r.expires_at) > Date.now(),
  );
  // While waiting, ask directly every few seconds too: a dimmed screen can stall the live stream.
  useEffect(() => {
    if (!open) return;
    const poll = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 3000);
    const expire = window.setTimeout(
      () =>
        setRequests((current) =>
          current.map((r) => (r.id === open.id ? { ...r, status: 'expired' } : r)),
        ),
      Math.max(0, Date.parse(open.expires_at) - Date.now()),
    );
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(expire);
    };
  }, [open?.id, open?.expires_at]);
  const outcome = !open
    ? requests.find(
        (r) =>
          watched.current.has(r.id) &&
          !dismissed.includes(r.id) &&
          ['completed', 'rejected', 'expired'].includes(r.status),
      )
    : undefined;
  const asking = useRef(false);
  const ask = async (reward: Reward) => {
    // A double tap sends one request (the server also returns the open one for a reward).
    if (asking.current) return;
    asking.current = true;
    setBusy(true);
    setError('');
    try {
      const hint = branchHint();
      const r = await api<RedeemRequest & { id: string; matchNumber: number; expiresAt: string }>(
        '/me/rewards/' + reward.id + '/redeem-requests',
        { method: 'POST', key: crypto.randomUUID(), body: hint ? { branchId: hint } : {} },
      );
      watched.current.add(r.id);
      setRequests((current) => [
        {
          id: r.id,
          reward_id: reward.id,
          membership_id: card.id,
          status: 'requested',
          match_number: r.matchNumber,
          expires_at: r.expiresAt,
          title: reward.title,
        },
        ...current.filter((x) => x.id !== r.id),
      ]);
      void load();
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      asking.current = false;
      setBusy(false);
    }
  };
  const cancel = async (request: RedeemRequest) => {
    setBusy(true);
    setError('');
    try {
      await api('/me/redeem-requests/' + request.id + '/cancel', { method: 'POST', body: {} });
      setDismissed((d) => [...d, request.id]);
      await load();
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  // The page's bottom button follows this card: Request Reward while one is available, then a
  // waiting state until the cashier decides. Approval alone redeems it (server side).
  const next = rewards.find(
    (r) => r.status === 'available' && Date.parse(r.expires_at) > Date.now(),
  );
  const askRef = useRef(ask);
  askRef.current = ask;
  useEffect(() => {
    onAction?.({
      membershipId: card.id,
      available: !!next,
      pending: !!open,
      busy,
      request: () => {
        if (next) void askRef.current(next);
      },
    });
  }, [card.id, next?.id, open?.id, busy]);
  useEffect(() => () => onAction?.(null), [card.id]);
  const available = rewards.some((r) => r.status === 'available');
  return (
    <>
      <button
        type="button"
        className="secondary small customer-rewards-link"
        aria-haspopup="dialog"
        onClick={() => setShow(true)}
      >
        <ActionLabel icon="gift">{ar ? 'شوف مكافآتك' : 'View rewards'}</ActionLabel>
      </button>
      {show &&
        createPortal(
          <div
            className="modal-backdrop customer-action-backdrop"
            data-portal="customer"
            onClick={(event) => {
              if (event.target === event.currentTarget) setShow(false);
            }}
          >
            <section
              className="dialog customer-action-dialog redeem-rewards"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
            >
              <div className="customer-action-heading">
                <h2 id={titleId}>{ar ? 'مكافآتك' : 'Your rewards'}</h2>
                <button
                  type="button"
                  className="text-button"
                  data-dialog-close
                  onClick={() => setShow(false)}
                >
                  {ar ? 'إغلاق' : 'Close'}
                </button>
              </div>
              {error && (
                <p className="error-text" role="alert">
                  {error}
                </p>
              )}
              {open ? (
                <div
                  className="redeem-waiting"
                  role="status"
                  aria-live="polite"
                  aria-label={ar ? 'طلب استبدال' : 'Redeem request'}
                >
                  <span className="badge">{ar ? 'طلب استبدال' : 'Redeem request'}</span>
                  <h3>{open.title}</h3>
                  <p className="redeem-waiting-text">
                    {ar ? 'مستني الكاشير…' : 'Waiting for cashier…'}
                  </p>
                  <small>{ar ? 'رقمك' : 'Your number'}</small>
                  <div className="match-code" data-match-number>
                    {open.match_number}
                  </div>
                  <p className="muted">
                    {ar
                      ? 'قول الرقم ده للكاشير لو سألك. الطلب مفتوح لحد '
                      : 'Tell the cashier this number if they ask. Open until '}
                    {new Date(open.expires_at).toLocaleTimeString(intlLocale(lang), {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                    .
                  </p>
                  <button
                    className="text-button"
                    disabled={busy}
                    aria-busy={busy}
                    onClick={() => void cancel(open)}
                  >
                    <ActionLabel icon="close">{ar ? 'إلغاء الطلب' : 'Cancel request'}</ActionLabel>
                  </button>
                </div>
              ) : outcome ? (
                <div
                  className={'redeem-outcome ' + outcome.status}
                  role="status"
                  aria-live="polite"
                >
                  <h3>
                    {outcome.status === 'completed'
                      ? ar
                        ? 'اتصرفت ✅'
                        : 'Redeemed ✅'
                      : outcome.status === 'rejected'
                        ? ar
                          ? 'اترفض'
                          : 'Rejected'
                        : ar
                          ? 'الكاشير مردّش'
                          : 'No answer from the cashier'}
                  </h3>
                  <p>
                    {outcome.status === 'completed'
                      ? ar
                        ? 'بالهنا والشفا: ' + outcome.title + '. بدأ كارت جديد.'
                        : 'Enjoy your ' + outcome.title + '. Your new card has started.'
                      : outcome.status === 'rejected'
                        ? ar
                          ? 'الكاشير ماأكدش الطلب. مكافأتك لسه متاحة.'
                          : 'The cashier did not confirm it. Your reward is still available.'
                        : ar
                          ? 'الطلب خلص وقته بعد 10 دقايق. دوس استبدل تاني.'
                          : 'The request timed out after 10 minutes. Tap Redeem to try again.'}
                  </p>
                  <button
                    className="secondary small"
                    onClick={() => setDismissed((d) => [...d, outcome.id])}
                  >
                    {ar ? 'تمام' : 'OK'}
                  </button>
                </div>
              ) : (
                available && (
                  <p className="muted">
                    {ar
                      ? 'دوس استبدل وإنت عند الكاشير. الكاشير هيأكد من موبايله ويبدأ كارت جديد.'
                      : 'Tap Redeem at the counter. The cashier confirms it on their phone and a new card starts.'}
                  </p>
                )
              )}
              {rewards.length
                ? rewards.map((r) => (
                    <div className="reward-row" key={r.id}>
                      <div>
                        <strong>{r.title}</strong>
                        <small>{r.terms}</small>
                        <small>
                          {ar ? 'صالحة لحد ' : 'Valid until '}
                          {new Date(r.expires_at).toLocaleDateString(intlLocale(lang))}
                        </small>
                      </div>
                      {r.status === 'available' && open?.reward_id !== r.id && (
                        <button
                          className="primary small"
                          disabled={busy || !!open}
                          aria-busy={busy}
                          onClick={() => void ask(r)}
                        >
                          <ActionLabel icon="gift">{ar ? 'استبدل' : 'Redeem'}</ActionLabel>
                        </button>
                      )}
                      <span className="badge">
                        {r.status === 'available'
                          ? open?.reward_id === r.id
                            ? ar
                              ? 'مستني الكاشير'
                              : 'Waiting'
                            : ar
                              ? 'متاحة'
                              : 'Available'
                          : r.status === 'redeemed'
                            ? ar
                              ? 'اتصرفت'
                              : 'Redeemed'
                            : r.status === 'expired'
                              ? ar
                                ? 'انتهت'
                                : 'Expired'
                              : ar
                                ? 'اتلغت'
                                : 'Voided'}
                      </span>
                    </div>
                  ))
                : null}
              {!rewards.length && !open && !outcome && !error && (
                <p className="muted" role="status">
                  {loading
                    ? ar
                      ? 'بنحمّل المكافآت…'
                      : 'Loading rewards…'
                    : ar
                      ? 'مفيش مكافآت دلوقتي.'
                      : 'No rewards yet.'}
                </p>
              )}
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
