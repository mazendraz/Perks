import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Grant, Language, AwardResult } from '../../../../packages/contracts/src/index.js';
import { api, ApiError, errorText } from '../api.js';
import { useLiveRefresh } from '../live-events.js';
import { ActionLabel } from '../../../../packages/ui/src/Icon.js';

export interface StampRequestRow {
  id: string;
  membership_id: string;
  branch_id: string;
  alias: string;
  max_per_tx: number;
  default_stamps: number;
  allow_multiple: boolean;
  expires_at: string;
}

// One idempotency key per request and decision, kept for the tab's life: tapping again after a lost
// answer replays the same command, so a flaky connection can never give two stamps or two blocks.
function decisionKey(requestId: string, kind: 'approve' | 'reject') {
  const name = 'perks-decision-' + kind + ':' + requestId;
  try {
    const saved = sessionStorage.getItem(name);
    if (saved) return saved;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(name, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

const minutesLeft = (expiresAt: string, now: number, ar: boolean) => {
  const left = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000));
  return ar
    ? left <= 1
      ? 'فاضل أقل من دقيقة'
      : `فاضل ${left} دقايق`
    : left <= 1
      ? 'Less than a minute left'
      : `${left} minutes left`;
};

// "This receipt was already used": checked while the cashier types, shown as a warning only.
function useReceiptWarning(merchantId: string, receipt: string) {
  const [used, setUsed] = useState(false);
  useEffect(() => {
    const value = receipt.trim();
    setUsed(false);
    if (!value) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void api<{ used: boolean }>(
        '/merchants/' + merchantId + '/receipts/used?receipt=' + encodeURIComponent(value),
      )
        .then((r) => live && setUsed(r.used))
        .catch(() => {
          /* A warning only: never in the way of the stamp. */
        });
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [merchantId, receipt]);
  return used;
}

export type DecisionOutcome =
  { kind: 'approved'; award: AwardResult } | { kind: 'rejected'; blocked: boolean };

// The cashier's whole decision on one scan: type the receipt and grant, or reject (and block).
// Used by the branch queue and by the screen a notification opens.
export function RequestDecision({
  grant,
  lang,
  request,
  confirmBlock = false,
  onDone,
}: {
  grant: Grant;
  lang: Language;
  request: StampRequestRow;
  // Opened from the notification's "Reject & Block" button: ask for the confirmation straight away.
  confirmBlock?: boolean;
  onDone: (outcome: DecisionOutcome) => void;
}) {
  const ar = lang === 'ar';
  const [receipt, setReceipt] = useState(''),
    [quantity, setQuantity] = useState(request.default_stamps),
    [reason, setReason] = useState(''),
    [blocking, setBlocking] = useState(confirmBlock),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [now, setNow] = useState(() => Date.now());
  const used = useReceiptWarning(grant.merchant_id, receipt);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!confirmBlock) input.current?.focus();
  }, [confirmBlock]);
  const max = Math.min(request.max_per_tx, grant.max_qty);
  const decide = async (body: Record<string, unknown>, kind: 'approve' | 'reject') => {
    setBusy(true);
    setError('');
    const send = () =>
      api<AwardResult & { status?: string; blocked?: boolean }>(
        '/merchants/' + grant.merchant_id + '/stamp-requests/' + request.id + '/decision',
        { method: 'POST', key: decisionKey(request.id, kind), body },
      );
    try {
      let data;
      try {
        data = await send();
      } catch (e) {
        // No answer (connection dropped, timeout, server restart): the decision may or may not be
        // saved. Ask again with the same key, which returns the saved result or makes the decision once,
        // before the live queue refresh can take an approved card off the screen.
        if (e instanceof ApiError && e.status > 0 && e.status < 500) throw e;
        await new Promise((resolve) => setTimeout(resolve, 1500));
        data = await send();
      }
      onDone(
        kind === 'approve'
          ? { kind: 'approved', award: data }
          : { kind: 'rejected', blocked: !!data.blocked },
      );
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  const approve = (event: FormEvent) => {
    event.preventDefault();
    void decide({ approve: true, receipt: receipt.trim(), quantity }, 'approve');
  };
  return (
    <article className="request-card" data-request-id={request.id}>
      <div className="section-heading">
        <h3>
          <bdi>{request.alias}</bdi>
        </h3>
        <small className="request-timer">{minutesLeft(request.expires_at, now, ar)}</small>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {blocking ? (
        <div className="notice warning" role="alertdialog" aria-live="assertive">
          <p>
            {ar
              ? 'هترفض الطلب وتحظر العميل ده في المحل. مش هياخد أختام ولا هيوصلك منه إشعارات لحد ما تفك الحظر من قائمة السبام.'
              : 'This rejects the request and blocks this customer at your shop. They get no stamps and you get no notifications from them until you unblock them in the Spam list.'}
          </p>
          <div className="form-actions">
            <button
              className="danger"
              disabled={busy}
              onClick={() => void decide({ approve: false, block: true }, 'reject')}
            >
              {ar ? 'أيوه، ارفض واحظر' : 'Yes, reject & block'}
            </button>
            <button className="secondary" disabled={busy} onClick={() => setBlocking(false)}>
              {ar ? 'رجوع' : 'Back'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <form onSubmit={approve}>
            <label>
              <ActionLabel icon="receipt">{ar ? 'رقم الإيصال' : 'Receipt number'}</ActionLabel>
              <input
                ref={input}
                required
                maxLength={120}
                autoComplete="off"
                value={receipt}
                onChange={(e) => setReceipt(e.target.value)}
              />
            </label>
            {used && (
              <p className="notice warning" role="status">
                {ar
                  ? 'الإيصال ده اتستخدم قبل كده. تقدر تكمّل لو متأكد.'
                  : 'This receipt was already used. You can still continue if you are sure.'}
              </p>
            )}
            {request.allow_multiple && max > 1 && (
              <div className="request-quantity">
                <button
                  type="button"
                  className="secondary"
                  aria-label={ar ? 'قلل الأختام' : 'Fewer stamps'}
                  disabled={busy || quantity <= 1}
                  onClick={() => setQuantity(quantity - 1)}
                >
                  −
                </button>
                <output aria-label={ar ? 'عدد الأختام' : 'Stamp quantity'}>{quantity}</output>
                <button
                  type="button"
                  className="secondary"
                  aria-label={ar ? 'زود الأختام' : 'More stamps'}
                  disabled={busy || quantity >= max}
                  onClick={() => setQuantity(quantity + 1)}
                >
                  +
                </button>
              </div>
            )}
            <button className="primary full" disabled={busy || !receipt.trim()}>
              <ActionLabel icon="stamp">{ar ? 'اضف الختم' : 'Grant stamp'}</ActionLabel>
            </button>
          </form>
          <button className="danger-outline full" disabled={busy} onClick={() => setBlocking(true)}>
            {ar ? 'رفض وحظر' : 'Reject & Block'}
          </button>
          <details>
            <summary>{ar ? 'رفض بس من غير حظر' : 'Reject without blocking'}</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void decide({ approve: false, reason: reason.trim() }, 'reject');
              }}
            >
              <label>
                {ar ? 'سبب الرفض' : 'Rejection reason'}
                <input
                  required
                  minLength={4}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button className="secondary" disabled={busy}>
                {ar ? 'ارفض الطلب' : 'Reject this request'}
              </button>
            </form>
          </details>
        </>
      )}
    </article>
  );
}

export function DecisionResult({ outcome, lang }: { outcome: DecisionOutcome; lang: Language }) {
  const ar = lang === 'ar';
  if (outcome.kind === 'rejected')
    return (
      <p className="notice" role="status">
        {outcome.blocked
          ? ar
            ? 'الطلب اترفض والعميل اتحظر. تلاقيه في قائمة السبام.'
            : 'Request rejected and the customer blocked. They are in the Spam list.'
          : ar
            ? 'الطلب اترفض.'
            : 'Request rejected.'}
      </p>
    );
  return (
    <div className="notice success" role="status">
      {ar ? 'الختم اتضاف: ' : 'Stamp added: '}
      <bdi>{outcome.award.reference}</bdi> · +{outcome.award.quantity}
      {outcome.award.receiptAlreadyUsed && (
        <p>
          {ar
            ? 'ملحوظة: الإيصال ده كان اتستخدم قبل كده.'
            : 'Note: this receipt had been used before.'}
        </p>
      )}
    </div>
  );
}

// The branch's open requests. Each one is also pushed to the cashiers' phones; this list is the same
// decision for whoever is at the counter screen.
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
  const ar = lang === 'ar';
  const [requests, setRequests] = useState<StampRequestRow[]>([]),
    [error, setError] = useState(''),
    [last, setLast] = useState<DecisionOutcome | null>(null),
    [alerts, setAlerts] = useState(() => {
      try {
        // On unless this device turned it off: a waiting customer must be noticed.
        return localStorage.getItem('nuqta-queue-alerts') !== 'false';
      } catch {
        return false;
      }
    });
  const generation = useRef(0),
    loadSerial = useRef(0),
    seen = useRef<Set<string> | null>(null),
    audio = useRef<AudioContext | null>(null);
  // Browsers only allow sound after a tap; prime the alert on the first tap anywhere.
  useEffect(() => {
    if (!alerts || typeof AudioContext !== 'function') return;
    const prime = () => {
      try {
        audio.current ??= new AudioContext();
        void audio.current.resume().catch(() => {});
      } catch {
        /* Optional feedback. */
      }
    };
    document.addEventListener('pointerdown', prime, { once: true });
    return () => document.removeEventListener('pointerdown', prime);
  }, [alerts]);
  useEffect(
    () => () => {
      void audio.current?.close().catch(() => {});
    },
    [],
  );
  const alert = () => {
    if (!alerts || document.hidden) return;
    try {
      if (audio.current?.state === 'running') {
        const oscillator = audio.current.createOscillator(),
          gain = audio.current.createGain();
        oscillator.frequency.value = 740;
        gain.gain.value = 0.035;
        oscillator.connect(gain);
        gain.connect(audio.current.destination);
        oscillator.start();
        oscillator.stop(audio.current.currentTime + 0.1);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
      }
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) navigator.vibrate?.(25);
    } catch {
      /* Alerts never block approval. */
    }
  };
  const load = async () => {
    const current = generation.current,
      serial = ++loadSerial.current;
    try {
      const data = await api<{ requests: StampRequestRow[] }>(
        '/merchants/' + grant.merchant_id + '/stamp-requests?branchId=' + branch,
      );
      if (current !== generation.current || serial !== loadSerial.current) return;
      if (seen.current && data.requests.some((r) => !seen.current!.has(r.id))) alert();
      seen.current = new Set(data.requests.map((r) => r.id));
      setRequests(data.requests);
      setError('');
    } catch (e) {
      if (current === generation.current) setError(errorText(e, lang));
    }
  };
  useLiveRefresh('/branches/' + branch + '/events', load);
  useEffect(() => {
    generation.current++;
    seen.current = null;
    setRequests([]);
    setLast(null);
    setError('');
    void load();
    return () => {
      generation.current++;
    };
  }, [branch, grant.id]);
  return (
    <section className="panel request-queue">
      <div className="section-heading">
        <h2>
          {ar ? 'طلبات العملاء' : 'Customer requests'}{' '}
          <span className="badge">{requests.length}</span>
        </h2>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={alerts}
            onChange={(e) => {
              const enabled = e.target.checked;
              setAlerts(enabled);
              try {
                localStorage.setItem('nuqta-queue-alerts', String(enabled));
                if (enabled && typeof AudioContext === 'function') {
                  audio.current ??= new AudioContext();
                  void audio.current.resume().catch(() => {});
                }
              } catch {
                /* Optional feedback. */
              }
            }}
          />
          {ar ? 'صوت واهتزاز' : 'Sound and vibration'}
        </label>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {last && <DecisionResult outcome={last} lang={lang} />}
      {!!requests.length && (
        <p className="muted">
          {ar
            ? 'اكتب رقم إيصال العميل واضغط "اضف الختم".'
            : 'Type the customer’s receipt number and tap “Grant stamp”.'}
        </p>
      )}
      {requests.map((row) => (
        <RequestDecision
          key={row.id}
          grant={grant}
          lang={lang}
          request={row}
          onDone={(outcome) => {
            setLast(outcome);
            if (outcome.kind === 'approved') onCommitted();
            void load();
          }}
        />
      ))}
      {!requests.length && (
        <p className="muted">
          {ar ? 'مفيش طلبات مفتوحة في الفرع.' : 'No open requests at this branch.'}
        </p>
      )}
    </section>
  );
}
