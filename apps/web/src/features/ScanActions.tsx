import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Grant, Language } from '../../../../packages/contracts/src/index.js';
import type {
  AutoStampFeedItem,
  SpamListItem,
} from '../../../../packages/contracts/src/commands.js';
import { api, ApiError, errorText } from '../api.js';
import { FieldErrors } from '../FieldErrors.js';
import { intlLocale } from '../locale.js';
import { pushState } from '../push.js';
import {
  DecisionResult,
  RequestDecision,
  type DecisionOutcome,
  type StampRequestRow,
} from './RequestQueue.js';
import { CashierRedeemScreen } from './RedeemRequests.js';

// What a cashier can do about one scan, from the branch screen or from the notification it rang.
// A notification's button only opens these screens (with ?do=<action>); nothing changes until the
// cashier confirms here, signed in.

const time = (value: string, lang: Language) =>
  new Date(value).toLocaleTimeString(intlLocale(lang), { hour: 'numeric', minute: '2-digit' });

export function RevokeDialog({
  grant,
  lang,
  stamp,
  onClose,
  onRevoked,
}: {
  grant: Grant;
  lang: Language;
  stamp: AutoStampFeedItem;
  onClose: () => void;
  onRevoked: () => void;
}) {
  const ar = lang === 'ar';
  const [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [validation, setValidation] = useState<ApiError | null>(null);
  // Fixed when the dialog opens, so a retried tap never revokes twice.
  const key = useRef(crypto.randomUUID());
  const reasons = ar
    ? ['العميل مكانش في المحل', 'ختم مكرر بالغلط']
    : ['Customer was not in the shop', 'Duplicate stamp by mistake'];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setValidation(null);
    setError('');
    try {
      await api(
        '/merchants/' + grant.merchant_id + '/auto-stamps/' + stamp.transactionId + '/revoke',
        {
          method: 'POST',
          key: key.current,
          body: { reason: reason.trim() },
        },
      );
      onRevoked();
    } catch (e) {
      setValidation(e instanceof ApiError ? e : null);
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="revoke-heading"
        onSubmit={(e) => void submit(e)}
      >
        <h2 id="revoke-heading">{ar ? 'إلغاء الختم ده؟' : 'Revoke this stamp?'}</h2>
        <p>
          <bdi>{stamp.alias}</bdi> · +{stamp.quantity} · {time(stamp.at, lang)}
        </p>
        <p className="muted">
          {stamp.rewardEarned
            ? ar
              ? 'الختم ده كمّل الكارت، فالمكافأة اللي جت منه هتتلغي كمان.'
              : 'This stamp completed the card, so the reward it earned is cancelled too.'
            : ar
              ? 'الختم ده بس هيتشال من كارت العميل، وكارت المحفظة هيتحدث.'
              : 'Only this stamp comes off the customer’s card, and their wallet pass updates.'}
        </p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="chip-row">
          {reasons.map((r) => (
            <button type="button" className="secondary small" key={r} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        <label>
          {ar ? 'السبب' : 'Reason'}
          <textarea
            autoFocus
            minLength={4}
            maxLength={1000}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <FieldErrors error={validation} lang={lang} />
        <div className="form-actions">
          <button type="button" className="secondary" data-dialog-close onClick={onClose}>
            {ar ? 'رجوع' : 'Back'}
          </button>
          <button className="danger" disabled={busy} aria-busy={busy}>
            {ar ? 'إلغاء الختم' : 'Revoke stamp'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function BlockDialog({
  grant,
  lang,
  alias,
  membershipId,
  origin,
  originId,
  onClose,
  onBlocked,
}: {
  grant: Grant;
  lang: Language;
  alias: string;
  membershipId: string;
  origin: 'auto_stamp' | 'request' | 'manual';
  originId?: string;
  onClose: () => void;
  onBlocked: () => void;
}) {
  const ar = lang === 'ar';
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const key = useRef(crypto.randomUUID());
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/merchants/' + grant.merchant_id + '/customer-blocks', {
        method: 'POST',
        key: key.current,
        body: { membershipId, origin, ...(originId ? { originId } : {}) },
      });
      onBlocked();
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="block-heading">
        <h2 id="block-heading">{ar ? 'حظر العميل ده؟' : 'Block this customer?'}</h2>
        <p>
          <bdi>{alias}</bdi>
        </p>
        <p className="muted">
          {ar
            ? 'مش هياخد أختام في المحل ده ولا هيوصلك منه إشعارات لحد ما تفك الحظر من قائمة السبام. الأختام اللي خدها قبل كده بتفضل زي ما هي.'
            : 'They get no stamps at this shop and you get no notifications from them until you unblock them in the Spam list. Stamps they already have stay as they are.'}
        </p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="secondary" data-dialog-close onClick={onClose}>
            {ar ? 'رجوع' : 'Back'}
          </button>
          <button className="danger" disabled={busy} aria-busy={busy} onClick={() => void submit()}>
            {ar ? 'احظر العميل' : 'Block customer'}
          </button>
        </div>
      </div>
    </div>
  );
}

const backToCashier = (lang: Language) => (
  <a className="text-button" href="/cashier">
    {lang === 'ar' ? '← رجوع لشاشة الكاشير' : '← Back to the cashier screen'}
  </a>
);

// Opened by an automatic stamp's notification: /cashier/stamps/<transaction>?do=revoke|block
export function CashierStampScreen({
  grant,
  lang,
  transactionId,
  action,
}: {
  grant: Grant;
  lang: Language;
  transactionId: string;
  action: string | null;
}) {
  const ar = lang === 'ar';
  const [stamp, setStamp] = useState<AutoStampFeedItem | null>(null),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [dialog, setDialog] = useState<'revoke' | 'block' | null>(null);
  const load = async () => {
    try {
      const data = await api<{ serverTime: string; stamp: AutoStampFeedItem }>(
        '/merchants/' + grant.merchant_id + '/auto-stamps/' + transactionId,
      );
      setOffset(Date.parse(data.serverTime) - Date.now());
      setStamp(data.stamp);
      return data.stamp;
    } catch (e) {
      setError(errorText(e, lang));
      return null;
    }
  };
  useEffect(() => {
    void load().then((s) => {
      if (!s) return;
      if (action === 'block' && !s.customerBlocked) setDialog('block');
      if (action === 'revoke' && !s.revoked) setDialog('revoke');
    });
  }, [transactionId, grant.merchant_id]);
  if (!stamp)
    return (
      <section className="panel">
        {backToCashier(lang)}
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : (
          <p className="muted">{ar ? 'بيحمّل…' : 'Loading…'}</p>
        )}
      </section>
    );
  const open =
    stamp.revocableUntil !== null && Date.parse(stamp.revocableUntil) > Date.now() + offset;
  return (
    <section className="panel scan-detail">
      {backToCashier(lang)}
      <h2>
        {ar ? 'ختم اتضاف' : 'Stamp added'} · <bdi>{stamp.alias}</bdi>
      </h2>
      <p>
        +{stamp.quantity} · {time(stamp.at, lang)} · {ar ? 'الرصيد' : 'balance'}{' '}
        {stamp.balanceAfter}
        {stamp.rewardEarned ? (ar ? ' · كسب مكافأة 🎁' : ' · earned a reward 🎁') : ''}
      </p>
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {stamp.revoked ? (
        <p className="muted">{ar ? 'الختم ده اتلغى.' : 'This stamp was revoked.'}</p>
      ) : stamp.usedInRedeemedReward ? (
        <p className="notice warning">
          {ar
            ? 'الختم ده اتحسب في هدية الزبون أخدها خلاص، فمينفعش يتلغي.'
            : 'This stamp counted toward a reward the customer already received, so it cannot be revoked.'}
        </p>
      ) : open ? (
        <button className="danger-outline full" onClick={() => setDialog('revoke')}>
          {ar ? 'إلغاء الختم ده' : 'Revoke this stamp'}
        </button>
      ) : (
        <p className="muted">
          {ar ? 'وقت إلغاء الختم ده عدّى.' : 'The time to revoke this stamp has passed.'}
        </p>
      )}
      {stamp.customerBlocked ? (
        <p className="muted">
          {ar
            ? 'العميل ده محظور. تلاقيه في قائمة السبام.'
            : 'This customer is blocked. See the Spam list.'}
        </p>
      ) : (
        <button className="danger-outline full" onClick={() => setDialog('block')}>
          {ar ? 'حظر العميل' : 'Block customer'}
        </button>
      )}
      {dialog === 'revoke' && (
        <RevokeDialog
          grant={grant}
          lang={lang}
          stamp={stamp}
          onClose={() => setDialog(null)}
          onRevoked={() => {
            setDialog(null);
            setNotice(ar ? 'الختم اتلغى والكارت اتحدّث.' : 'Stamp revoked. The card is updated.');
            void load();
          }}
        />
      )}
      {dialog === 'block' && (
        <BlockDialog
          grant={grant}
          lang={lang}
          alias={stamp.alias}
          membershipId={stamp.membershipId}
          origin="auto_stamp"
          originId={stamp.transactionId}
          onClose={() => setDialog(null)}
          onBlocked={() => {
            setDialog(null);
            setNotice(ar ? 'العميل اتحظر.' : 'Customer blocked.');
            void load();
          }}
        />
      )}
    </section>
  );
}

interface RequestDetail extends StampRequestRow {
  branch_name: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired';
  receipt_note: string | null;
  blocked: boolean;
}

// Opened by an approval request's notification: /cashier/requests/<id>?do=reject-block
export function CashierRequestScreen({
  grant,
  lang,
  requestId,
  action,
}: {
  grant: Grant;
  lang: Language;
  requestId: string;
  action: string | null;
}) {
  const ar = lang === 'ar';
  const [request, setRequest] = useState<RequestDetail | null>(null),
    [error, setError] = useState(''),
    [outcome, setOutcome] = useState<DecisionOutcome | null>(null),
    [blocking, setBlocking] = useState(false);
  const load = async () => {
    try {
      const data = await api<{ request: RequestDetail }>(
        '/merchants/' + grant.merchant_id + '/stamp-requests/' + requestId,
      );
      setRequest(data.request);
      return data.request;
    } catch (e) {
      setError(errorText(e, lang));
      return null;
    }
  };
  useEffect(() => {
    void load().then((r) => {
      // The request already closed (timed out, cancelled): "Reject & Block" still blocks.
      if (r && r.status !== 'pending' && action === 'reject-block' && !r.blocked) setBlocking(true);
    });
  }, [requestId, grant.merchant_id]);
  if (!request)
    return (
      <section className="panel">
        {backToCashier(lang)}
        {error ? (
          <p className="error-text" role="alert">
            {error}
          </p>
        ) : (
          <p className="muted">{ar ? 'بيحمّل…' : 'Loading…'}</p>
        )}
      </section>
    );
  const closed: Record<RequestDetail['status'], [string, string]> = {
    pending: ['', ''],
    approved: ['الطلب ده اتوافق عليه خلاص.', 'This request was already approved.'],
    rejected: ['الطلب ده اترفض.', 'This request was rejected.'],
    cancelled: ['العميل لغى الطلب.', 'The customer cancelled this request.'],
    expired: ['الطلب ده خلص وقته.', 'This request timed out.'],
  };
  return (
    <section className="panel scan-detail">
      {backToCashier(lang)}
      <h2>
        {ar ? 'ختم محتاج موافقتك' : 'Stamp to approve'} · <bdi>{request.alias}</bdi>
      </h2>
      <p className="muted">
        <bdi>{request.branch_name}</bdi>
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {outcome ? (
        <DecisionResult outcome={outcome} lang={lang} />
      ) : request.status === 'pending' && !request.blocked ? (
        <RequestDecision
          grant={grant}
          lang={lang}
          request={request}
          confirmBlock={action === 'reject-block'}
          onDone={(o) => {
            setOutcome(o);
            void load();
          }}
        />
      ) : (
        <>
          <p className="notice">
            {request.blocked
              ? ar
                ? 'العميل ده محظور. تلاقيه في قائمة السبام.'
                : 'This customer is blocked. See the Spam list.'
              : closed[request.status][ar ? 0 : 1]}
          </p>
          {!request.blocked && (
            <button className="danger-outline full" onClick={() => setBlocking(true)}>
              {ar ? 'حظر العميل' : 'Block customer'}
            </button>
          )}
        </>
      )}
      {blocking && (
        <BlockDialog
          grant={grant}
          lang={lang}
          alias={request.alias}
          membershipId={request.membership_id}
          origin="request"
          originId={request.id}
          onClose={() => setBlocking(false)}
          onBlocked={() => {
            setBlocking(false);
            void load();
          }}
        />
      )}
    </section>
  );
}

// Customers this shop blocked: their scans give nothing and ring nobody, but each try is counted here.
export function SpamList({ grant, lang }: { grant: Grant; lang: Language }) {
  const ar = lang === 'ar';
  const [blocks, setBlocks] = useState<SpamListItem[] | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [confirming, setConfirming] = useState<SpamListItem | null>(null),
    [busy, setBusy] = useState(false);
  const key = useRef('');
  const load = async () => {
    try {
      setBlocks(
        (
          await api<{ blocks: SpamListItem[] }>(
            '/merchants/' + grant.merchant_id + '/customer-blocks',
          )
        ).blocks,
      );
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void load();
    void pushState(lang).catch(() => {});
  }, [grant.merchant_id]);
  const unblock = async () => {
    if (!confirming) return;
    setBusy(true);
    setError('');
    try {
      await api(
        '/merchants/' + grant.merchant_id + '/customer-blocks/' + confirming.blockId + '/unblock',
        { method: 'POST', key: key.current, body: {} },
      );
      setNotice(
        ar ? 'اتفك الحظر عن ' + confirming.alias + '.' : confirming.alias + ' is unblocked.',
      );
      setConfirming(null);
      await load();
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  const when = (value: string) =>
    new Date(value).toLocaleString(intlLocale(lang), {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
  return (
    <section className="panel spam-list" aria-labelledby="spam-heading">
      <div className="section-heading">
        <h2 id="spam-heading">
          {ar ? 'سبام' : 'Spam'} {blocks && <span className="badge">{blocks.length}</span>}
        </h2>
      </div>
      <p className="muted">
        {ar
          ? 'العملاء المحظورين في المحل. السكان بتاعهم مش بيدّي أختام ومش بيبعتلك إشعارات، بس كل محاولة بتتعد هنا.'
          : 'Customers blocked at this shop. Their scans give no stamps and send you no notifications, but every try is counted here.'}
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      {blocks === null ? (
        <p className="muted">{ar ? 'بيحمّل…' : 'Loading…'}</p>
      ) : blocks.length ? (
        blocks.map((b) => (
          <div className="activity-row" key={b.blockId} data-block-id={b.blockId}>
            <div>
              <strong>
                <bdi>{b.alias || (ar ? 'عميل' : 'Customer')}</bdi>
              </strong>
              <small>
                {ar ? 'محاولات بعد الحظر: ' : 'Tries since blocked: '}
                {b.attempts}
                {' · '}
                {b.lastAttemptAt
                  ? (ar ? 'آخر محاولة ' : 'last try ') + when(b.lastAttemptAt)
                  : (ar ? 'اتحظر ' : 'blocked ') + when(b.blockedAt)}
              </small>
            </div>
            <button
              className="secondary small"
              onClick={() => {
                key.current = crypto.randomUUID();
                setConfirming(b);
              }}
            >
              {ar ? 'فك الحظر' : 'Unblock'}
            </button>
          </div>
        ))
      ) : (
        <p className="muted">{ar ? 'مفيش عملاء محظورين.' : 'No blocked customers.'}</p>
      )}
      {confirming && (
        <div className="modal-backdrop">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="unblock-heading">
            <h2 id="unblock-heading">{ar ? 'فك الحظر؟' : 'Unblock this customer?'}</h2>
            <p>
              <bdi>{confirming.alias}</bdi>
            </p>
            <p className="muted">
              {ar
                ? 'السكان الجاي منه هيدّي ختم ويبعتلك إشعار زي أي عميل.'
                : 'Their next scan collects a stamp and notifies you like any customer.'}
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                onClick={() => setConfirming(null)}
              >
                {ar ? 'رجوع' : 'Back'}
              </button>
              <button
                className="primary"
                disabled={busy}
                aria-busy={busy}
                onClick={() => void unblock()}
              >
                {ar ? 'فك الحظر' : 'Unblock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// A notification's link names the scan, not the shop. Someone on staff at several shops opens it with
// whichever shop is selected, so find the shop the scan belongs to before showing it.
export function CashierScanRoute({
  grants,
  preferred,
  lang,
  kind,
  id,
}: {
  grants: Grant[];
  preferred: Grant;
  lang: Language;
  kind: 'request' | 'stamp' | 'redeem';
  id: string;
}) {
  const [grant, setGrant] = useState<Grant | null>(grants.length === 1 ? preferred : null);
  // Opening the app from a notification re-binds this phone to the current sign-in.
  useEffect(() => {
    void pushState(lang).catch(() => {});
  }, [lang]);
  const action = (() => {
    try {
      return new URLSearchParams(location.search).get('do');
    } catch {
      return null;
    }
  })();
  useEffect(() => {
    if (grants.length === 1) return;
    let live = true;
    void (async () => {
      const ordered = [preferred, ...grants.filter((g) => g.id !== preferred.id)];
      for (const g of ordered) {
        try {
          await api(
            '/merchants/' +
              g.merchant_id +
              (kind === 'request'
                ? '/stamp-requests/'
                : kind === 'redeem'
                  ? '/redeem-requests/'
                  : '/auto-stamps/') +
              id,
          );
          if (live) setGrant(g);
          return;
        } catch {
          /* Not this shop's scan: try the next. */
        }
      }
      // Nobody owns it: the preferred shop's screen shows the not-found message.
      if (live) setGrant(preferred);
    })();
    return () => {
      live = false;
    };
  }, [id, kind, preferred.id]);
  if (!grant) return <p className="muted">{lang === 'ar' ? 'بيحمّل…' : 'Loading…'}</p>;
  return kind === 'redeem' ? (
    <CashierRedeemScreen grant={grant} lang={lang} requestId={id} />
  ) : kind === 'request' ? (
    <CashierRequestScreen grant={grant} lang={lang} requestId={id} action={action} />
  ) : (
    <CashierStampScreen grant={grant} lang={lang} transactionId={id} action={action} />
  );
}
