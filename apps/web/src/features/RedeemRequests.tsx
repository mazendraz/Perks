import { useEffect, useRef, useState } from 'react';
import { Select } from '../controls/Select.js';
import { ActionLabel, Icon } from '../../../../packages/ui/src/Icon.js';
import type { Grant, Language } from '../../../../packages/contracts/src/index.js';
import { api, ApiError, errorText } from '../api.js';
import { useLiveRefresh } from '../live-events.js';
import { useAutoClear } from '../useAutoClear.js';
import { intlLocale } from '../locale.js';

// A customer tapped Redeem on their phone. The cashier sees their name, the reward and the 2-digit
// match number the customer's phone shows, and confirms (the reward is handed over, a new card
// starts) or rejects (the reward stays with the customer). Nothing to scan.
export interface RedeemRequestRow {
  id: string;
  reward_id: string;
  membership_id: string;
  branch_id: string | null;
  status: string;
  match_number: number;
  expires_at: string;
  created_at: string;
  title: string;
  terms: string | null;
  alias: string;
}
interface RedeemRequestDetail extends RedeemRequestRow {
  reward_status: string;
  cycle_number: number;
  blocked: boolean;
}
export type RedeemOutcome =
  | { status: 'redeemed'; title: string; cycleNumber: number; reference: string }
  | { status: 'rejected' };

const time = (value: string, lang: Language) =>
  new Date(value).toLocaleTimeString(intlLocale(lang), { hour: 'numeric', minute: '2-digit' });

export function RedeemDecision({
  grant,
  branch,
  lang,
  request,
  onDone,
}: {
  grant: Grant;
  branch: string;
  lang: Language;
  request: RedeemRequestRow;
  onDone: (outcome: RedeemOutcome) => void;
}) {
  const ar = lang === 'ar';
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  // One key per request and choice, kept across retries: a lost reply retried is the same decision.
  const keys = useRef<Record<string, string>>({});
  const decide = async (approve: boolean) => {
    const choice = approve ? 'confirm' : 'reject';
    keys.current[choice] ??= crypto.randomUUID();
    setBusy(true);
    setError('');
    try {
      const r = await api<{
        status: string;
        title?: string;
        cycleNumber?: number;
        reference?: string;
      }>('/merchants/' + grant.merchant_id + '/redeem-requests/' + request.id + '/decision', {
        method: 'POST',
        key: keys.current[choice],
        body: { approve, branchId: branch },
      });
      onDone(
        approve
          ? {
              status: 'redeemed',
              title: r.title ?? request.title,
              cycleNumber: r.cycleNumber ?? 0,
              reference: r.reference ?? '',
            }
          : { status: 'rejected' },
      );
    } catch (e) {
      setError(errorText(e, lang));
      // Already decided elsewhere (another cashier, or it timed out): the list will drop it.
      if (e instanceof ApiError && [409, 410].includes(e.status)) keys.current = {};
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button
          className="secondary"
          disabled={busy}
          aria-busy={busy}
          onClick={() => void decide(false)}
        >
          {ar ? 'رفض' : 'Reject'}
        </button>
        <button
          className="primary"
          disabled={busy}
          aria-busy={busy}
          onClick={() => void decide(true)}
        >
          <ActionLabel icon="gift">{ar ? 'تأكيد الاستبدال' : 'Confirm redeem'}</ActionLabel>
        </button>
      </div>
    </>
  );
}

export function RedeemResult({ outcome, lang }: { outcome: RedeemOutcome; lang: Language }) {
  const ar = lang === 'ar';
  return outcome.status === 'redeemed' ? (
    <div className="notice success" role="status">
      <strong>{ar ? 'المكافأة اتصرفت ✅' : 'Reward redeemed ✅'}</strong> · {outcome.title} ·{' '}
      {ar ? 'بدأ كارت ' : 'card '}
      {outcome.cycleNumber}
      {ar ? '' : ' started'}. {ar ? 'سلّم المكافأة للعميل.' : 'Hand the reward over.'}
      {outcome.reference && (
        <>
          {' '}
          <bdi className="redeem-reference">{outcome.reference}</bdi>
        </>
      )}
    </div>
  ) : (
    <div className="notice" role="status">
      {ar
        ? 'الطلب اترفض. المكافأة لسه مع العميل.'
        : 'Request rejected. The reward stays with the customer.'}
    </div>
  );
}

function RequestHeading({ request, lang }: { request: RedeemRequestRow; lang: Language }) {
  const ar = lang === 'ar';
  return (
    <div className="redeem-request-heading">
      <div>
        <strong>
          <bdi>{request.alias}</bdi>
        </strong>
        <small>
          {request.title} · {time(request.created_at, lang)}
        </small>
      </div>
      <div className="redeem-match" aria-label={ar ? 'رقم المطابقة' : 'Match number'}>
        <small>{ar ? 'الرقم' : 'Match'}</small>
        <strong className="match-code" data-match-number>
          {request.match_number}
        </strong>
      </div>
    </div>
  );
}

// Requests waiting at this branch, on the cashier's home screen.
export function CashierRedeemQueue({
  grant,
  branch,
  lang,
  onRedeemed,
}: {
  grant: Grant;
  branch: string;
  lang: Language;
  onRedeemed?: () => void;
}) {
  const ar = lang === 'ar';
  const [requests, setRequests] = useState<RedeemRequestRow[]>([]),
    [done, setDone] = useState<{ id: string; outcome: RedeemOutcome } | null>(null),
    [error, setError] = useState('');
  useAutoClear(done, () => setDone(null));
  const generation = useRef(0);
  const load = async () => {
    if (!branch) return;
    const mine = ++generation.current;
    try {
      const r = await api<{ requests: RedeemRequestRow[] }>(
        '/merchants/' + grant.merchant_id + '/redeem-requests?branchId=' + branch,
      );
      if (mine !== generation.current) return;
      setRequests(r.requests);
      setError('');
    } catch (e) {
      if (mine === generation.current) setError(errorText(e, lang));
    }
  };
  useLiveRefresh('/branches/' + branch + '/events', load);
  // A new request does not belong to a branch until it is decided, so the list also asks itself.
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 4000);
    return () => {
      generation.current++;
      window.clearInterval(timer);
    };
  }, [branch, grant.merchant_id]);
  if (!requests.length && !done && !error) return null;
  return (
    <section className="panel redeem-queue" aria-labelledby="redeem-queue-heading">
      <h2 id="redeem-queue-heading">
        <Icon name="gift" size={22} /> {ar ? 'طلبات استبدال' : 'Redeem requests'}{' '}
        {requests.length > 0 && <span className="badge">{requests.length}</span>}
      </h2>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {done && <RedeemResult outcome={done.outcome} lang={lang} />}
      {requests.map((r) => (
        <div className="redeem-request" key={r.id} data-request-id={r.id}>
          <RequestHeading request={r} lang={lang} />
          <RedeemDecision
            grant={grant}
            branch={branch}
            lang={lang}
            request={r}
            onDone={(outcome) => {
              setDone({ id: r.id, outcome });
              setRequests((list) => list.filter((x) => x.id !== r.id));
              if (outcome.status === 'redeemed') onRedeemed?.();
              void load();
            }}
          />
        </div>
      ))}
    </section>
  );
}

// Opened by a redeem request's notification: /cashier/redeem/<id>
export function CashierRedeemScreen({
  grant,
  lang,
  requestId,
}: {
  grant: Grant;
  lang: Language;
  requestId: string;
}) {
  const ar = lang === 'ar';
  const [request, setRequest] = useState<RedeemRequestDetail | null>(null),
    [error, setError] = useState(''),
    [outcome, setOutcome] = useState<RedeemOutcome | null>(null),
    [branch, setBranch] = useState(grant.branches[0]?.id || '');
  const load = async () => {
    try {
      const data = await api<{ request: RedeemRequestDetail }>(
        '/merchants/' + grant.merchant_id + '/redeem-requests/' + requestId,
      );
      setRequest(data.request);
      // The branch the customer came through, when this cashier works there.
      const at = data.request.branch_id;
      if (at && grant.branches.some((b) => b.id === at)) setBranch(at);
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void load();
  }, [requestId, grant.merchant_id]);
  const back = (
    <a className="text-button" href="/cashier">
      {ar ? '← رجوع لشاشة الكاشير' : '← Back to the cashier screen'}
    </a>
  );
  if (!request)
    return (
      <section className="panel">
        {back}
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : (
          <p className="muted">{ar ? 'بيحمّل…' : 'Loading…'}</p>
        )}
      </section>
    );
  const closed: Record<string, [string, string]> = {
    completed: ['المكافأة دي اتصرفت خلاص.', 'This reward was already redeemed.'],
    rejected: ['الطلب ده اترفض.', 'This request was rejected.'],
    cancelled: ['العميل لغى الطلب.', 'The customer cancelled this request.'],
    expired: [
      'الطلب ده خلص وقته. العميل يقدر يدوس استبدل تاني.',
      'This request timed out. The customer can tap Redeem again.',
    ],
  };
  return (
    <section className="panel scan-detail redeem-screen">
      {back}
      <h2>
        {ar ? 'طلب استبدال' : 'Redeem request'} · <bdi>{request.alias}</bdi>
      </h2>
      <RequestHeading request={request} lang={lang} />
      {request.terms && <p className="muted">{request.terms}</p>}
      {outcome ? (
        <RedeemResult outcome={outcome} lang={lang} />
      ) : request.status === 'requested' && !request.blocked ? (
        <>
          {grant.branches.length > 1 && (
            <label className="branch-picker">
              {ar ? 'الفرع' : 'Branch'}
              <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
                {grant.branches.map((b) => (
                  <option value={b.id} key={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <p>
            {ar
              ? 'اتأكد إن الرقم ده هو اللي على موبايل العميل، وبعدين أكّد.'
              : 'Check this number matches the one on the customer’s phone, then confirm.'}
          </p>
          <RedeemDecision
            grant={grant}
            branch={branch}
            lang={lang}
            request={request}
            onDone={(o) => {
              setOutcome(o);
              void load();
            }}
          />
        </>
      ) : (
        <p className="notice">
          {request.blocked
            ? ar
              ? 'العميل ده محظور. تلاقيه في قائمة السبام.'
              : 'This customer is blocked. See the Spam list.'
            : (closed[request.status] ?? closed.expired!)[ar ? 0 : 1]}
        </p>
      )}
    </section>
  );
}
