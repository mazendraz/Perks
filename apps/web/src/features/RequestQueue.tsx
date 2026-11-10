import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Grant, Language, AwardResult } from '../../../../packages/contracts/src/index.js';
import { api, ApiError, errorText } from '../api.js';
import { useLiveRefresh } from '../live-events.js';
import { CameraScanner } from './CameraScanner.js';
import { ActionLabel } from '../../../../packages/ui/src/Icon.js';
interface Request {
  id: string;
  membership_id: string;
  branch_id: string;
  alias: string;
  max_per_tx: number;
  expires_at: string;
  code?: string;
}
interface Command {
  key: string;
  scope: string;
  merchantId: string;
  request: Request;
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
interface Proof {
  membershipId: string;
  context: string;
  expiresAt: string;
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
    storageKey = 'nuqta-request-decision-' + grant.id + ':' + branch;
  const [requests, setRequests] = useState<Request[]>([]),
    [proof, setProof] = useState<Proof | null>(null),
    [manual, setManual] = useState(''),
    [receipts, setReceipts] = useState<Record<string, string>>({}),
    [quantities, setQuantities] = useState<Record<string, number>>({}),
    [rejections, setRejections] = useState<Record<string, string>>({}),
    [pending, setPending] = useState<Command | null>(null),
    [resumable, setResumable] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [result, setResult] = useState<{ award: AwardResult; undoUntil: number } | null>(null),
    [undoReady, setUndoReady] = useState(false),
    [alerts, setAlerts] = useState(() => {
      try {
        return localStorage.getItem('nuqta-queue-alerts') === 'true';
      } catch {
        return false;
      }
    });
  const generation = useRef(0),
    loadSerial = useRef(0),
    seen = useRef<Set<string> | null>(null),
    audio = useRef<AudioContext | null>(null);
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
      /* Alerts never block purchase approval. */
    }
  };
  const load = async () => {
    const current = generation.current,
      serial = ++loadSerial.current;
    try {
      const data = await api<{ requests: Request[] }>(
        '/merchants/' + grant.merchant_id + '/stamp-requests?branchId=' + branch,
      );
      if (current !== generation.current || serial !== loadSerial.current) return;
      if (seen.current && data.requests.some((r) => !seen.current!.has(r.id))) alert();
      seen.current = new Set(data.requests.map((r) => r.id));
      setRequests(data.requests);
    } catch (error) {
      if (current === generation.current) setError(errorText(error, lang));
    }
  };
  useLiveRefresh('/branches/' + branch + '/events', load);
  useEffect(() => {
    generation.current++;
    seen.current = null;
    setProof(null);
    setManual('');
    setRequests([]);
    setPending(null);
    setResumable(false);
    setError('');
    setNotice('');
    setResult(null);
    setBusy(false);
    try {
      const legacy = 'nuqta-request-decision-' + grant.id;
      let saved = sessionStorage.getItem(storageKey);
      if (!saved) {
        const previous = sessionStorage.getItem(legacy);
        if (previous && JSON.parse(previous).request?.branch_id === branch) {
          sessionStorage.setItem(storageKey, previous);
          sessionStorage.removeItem(legacy);
          saved = previous;
        }
      }
      if (saved) {
        const value = JSON.parse(saved) as Command;
        if (value.merchantId === grant.merchant_id && value.request?.branch_id === branch)
          setPending(value);
      }
    } catch {
      /* Unavailable local recovery storage never implies a committed write. */
    }
    void load();
    return () => {
      generation.current++;
    };
  }, [branch, grant.id]);
  useEffect(
    () => () => {
      void audio.current?.close().catch(() => {});
    },
    [],
  );
  useEffect(() => {
    if (!proof) return;
    const timer = window.setTimeout(
      () => setProof(null),
      Math.max(0, new Date(proof.expiresAt).getTime() - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [proof]);
  useEffect(() => {
    setUndoReady(!!result);
    if (!result) return;
    const timer = window.setTimeout(
      () => setUndoReady(false),
      Math.max(0, result.undoUntil - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [result]);
  const read = async (value: string) => {
    const current = generation.current;
    setBusy(true);
    setError('');
    try {
      const data = await api<{
        membership: { id: string };
        presentationContext: string;
        expiresAt: string;
      }>('/cashier/scans/resolve', {
        method: 'POST',
        body: { merchantId: grant.merchant_id, branchId: branch, token: value.trim() },
      });
      if (current !== generation.current) return;
      if (pending && data.membership.id !== pending.request.membership_id)
        throw new ApiError('REQUEST_CONTEXT_MISMATCH', 422);
      if (!pending && !requests.some((r) => r.membership_id === data.membership.id))
        throw new ApiError('REQUEST_CONTEXT_MISMATCH', 422);
      setProof({
        membershipId: data.membership.id,
        context: data.presentationContext,
        expiresAt: data.expiresAt,
      });
      setManual('');
    } catch (error) {
      if (current === generation.current) {
        setProof(null);
        setError(errorText(error, lang));
      }
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  const finish = (award?: AwardResult) => {
    sessionStorage.removeItem(storageKey);
    setPending(null);
    setResumable(false);
    setProof(null);
    setError('');
    if (award?.reference) {
      setResult({ award, undoUntil: Date.now() + 10000 });
      onCommitted();
    } else setNotice(ar ? 'الطلب اترفض.' : 'Request rejected.');
    void load();
  };
  const recover = async () => {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      const response = await api<{ status: string; result: AwardResult }>(
        '/operations/by-key?scope=' + encodeURIComponent(pending.scope) + '&key=' + pending.key,
      );
      if (response.status === 'committed')
        finish(pending.body.approve ? response.result : undefined);
      else {
        setResumable(true);
        setProof(null);
        setNotice(
          ar
            ? 'لسه مفيش نتيجة محفوظة. امسح نفس كود العميل وكمّل نفس المحاولة.'
            : 'No saved outcome yet. Scan the same customer code and resume the same attempt.',
        );
        await load();
      }
    } catch (error) {
      setError(errorText(error, lang));
    } finally {
      setBusy(false);
    }
  };
  const submit = async (event: FormEvent, row: Request, approve: boolean) => {
    event.preventDefault();
    if (pending && !resumable) return;
    const current = generation.current;
    const command: Command = pending ?? {
      key: crypto.randomUUID(),
      scope: approve ? 'stamp.award:' + grant.merchant_id : 'request.reject:' + row.id,
      merchantId: grant.merchant_id,
      request: { ...row, code: undefined },
      body: approve
        ? {
            approve: true,
            award: {
              membershipId: row.membership_id,
              branchId: branch,
              quantity: quantities[row.id] ?? 1,
              purchaseReference: {
                namespace: 'manual',
                reference: receipts[row.id] ?? '',
                businessDate: new Intl.DateTimeFormat('en-CA', {
                  timeZone: grant.timezone,
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                }).format(new Date()),
              },
            },
          }
        : { approve: false, reason: rejections[row.id] ?? '' },
    };
    if (
      command.body.approve &&
      (!proof ||
        proof.membershipId !== row.membership_id ||
        new Date(proof.expiresAt).getTime() <= Date.now())
    ) {
      setError(ar ? 'امسح كود العميل الأول.' : 'Scan the customer code first.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      // Only the immutable business command is persisted. Neither a QR proof nor
      // the matching code is written to local/session storage.
      sessionStorage.setItem(storageKey, JSON.stringify(command));
      setPending(command);
      setResumable(false);
      const data = await api<AwardResult>(
        '/merchants/' + grant.merchant_id + '/stamp-requests/' + row.id + '/decision',
        {
          method: 'POST',
          key: command.key,
          body: command.body.approve
            ? {
                ...command.body,
                code: row.code,
                award: { ...command.body.award, presentationContext: proof!.context },
              }
            : command.body,
        },
      );
      if (current === generation.current) finish(command.body.approve ? data : undefined);
      else sessionStorage.removeItem(storageKey);
    } catch (error) {
      if (current !== generation.current) return;
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![401, 403, 429].includes(error.status)
      ) {
        setPending(null);
        sessionStorage.removeItem(storageKey);
      }
      setError(errorText(error, lang));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  const undo = async () => {
    if (!result || !undoReady || Date.now() > result.undoUntil) return;
    setBusy(true);
    try {
      await api('/merchants/' + grant.merchant_id + '/corrections', {
        method: 'POST',
        key: 'request-undo:' + result.award.transactionId,
        body: {
          transactionId: result.award.transactionId,
          delta: -result.award.quantity,
          reason: 'Cashier undo requested within ten seconds of approval',
        },
      });
      setUndoReady(false);
      setNotice(
        ar
          ? 'طلب التراجع اتبعت للمدير. الرصيد هيتغير بعد المراجعة.'
          : 'Undo requested for manager review. The balance changes after approval.',
      );
    } catch (error) {
      setError(errorText(error, lang));
    } finally {
      setBusy(false);
    }
  };
  const rows =
    pending && !requests.some((r) => r.id === pending.request.id)
      ? [pending.request, ...requests]
      : requests;
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
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {result && (
        <div className="notice success" role="status">
          {ar ? 'اتحفظت العملية: ' : 'Transaction saved: '}
          <bdi>{result.award.reference}</bdi> · +{result.award.quantity}
          {undoReady && (
            <button className="text-button" disabled={busy} onClick={() => void undo()}>
              {ar ? 'تراجع' : 'Undo'}
            </button>
          )}
        </div>
      )}
      {pending && (
        <div className="notice">
          <p>{ar ? 'فيه قرار محتاج تأكيد نتيجته.' : 'A decision needs its outcome confirmed.'}</p>
          <button className="secondary" disabled={busy} onClick={() => void recover()}>
            {ar ? 'تحقق من نفس القرار' : 'Check the same decision'}
          </button>
        </div>
      )}
      {!!rows.length && (
        <div className="request-scanner">
          <p className="muted">
            {ar
              ? 'امسح كود العميل، اكتب الإيصال، وبعدها ضغطة واحدة تعتمد الختم.'
              : 'Scan the customer code, enter the receipt, then approve with one tap.'}
          </p>
          <CameraScanner lang={lang} onRead={(value) => void read(value)} />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void read(manual);
            }}
          >
            <label>
              <ActionLabel icon="keyboard">
                {ar ? 'أو اكتب كود العميل للطلب' : 'Or enter the request customer QR code'}
              </ActionLabel>
              <input
                dir="ltr"
                autoComplete="off"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                required
              />
            </label>
            <button className="secondary" disabled={busy}>
              <ActionLabel icon="scan">{ar ? 'اقرأ كود الطلب' : 'Read request code'}</ActionLabel>
            </button>
          </form>
        </div>
      )}
      {rows.map((row) => {
        const locked = !!pending,
          matching = proof?.membershipId === row.membership_id,
          command = pending?.request.id === row.id ? pending : undefined;
        const quantity = command?.body.approve
          ? command.body.award.quantity
          : (quantities[row.id] ?? 1);
        const receipt = command?.body.approve
          ? command.body.award.purchaseReference.reference
          : (receipts[row.id] ?? '');
        return (
          <article className="request-card" key={row.id} data-request-id={row.id}>
            <div className="section-heading">
              <h3>{row.alias}</h3>
              <bdi className="request-match">{row.code}</bdi>
            </div>
            <small>
              {ar ? 'صالح لحد ' : 'Valid until '}
              {new Date(row.expires_at).toLocaleTimeString(lang)}
            </small>
            <p className={matching ? 'notice success' : 'muted'}>
              {matching
                ? ar
                  ? 'كود العميل اتقري.'
                  : 'Customer code scanned.'
                : ar
                  ? 'مستني سكان كود العميل.'
                  : 'Waiting for the customer code scan.'}
            </p>
            <form onSubmit={(event) => void submit(event, row, true)}>
              <label>
                <ActionLabel icon="receipt">
                  {ar ? 'رقم إيصال الطلب' : 'Request receipt number'}
                </ActionLabel>
                <input
                  required
                  maxLength={120}
                  readOnly={locked}
                  value={receipt}
                  onChange={(e) => setReceipts({ ...receipts, [row.id]: e.target.value })}
                />
              </label>
              <div className="request-quantity">
                <button
                  type="button"
                  className="secondary"
                  aria-label={ar ? 'قلل الأختام' : 'Fewer stamps'}
                  disabled={locked || quantity <= 1}
                  onClick={() => setQuantities({ ...quantities, [row.id]: quantity - 1 })}
                >
                  −
                </button>
                <output aria-label={ar ? 'عدد الأختام' : 'Stamp quantity'}>{quantity}</output>
                <button
                  type="button"
                  className="secondary"
                  aria-label={ar ? 'زود الأختام' : 'More stamps'}
                  disabled={locked || quantity >= Math.min(row.max_per_tx, grant.max_qty)}
                  onClick={() => setQuantities({ ...quantities, [row.id]: quantity + 1 })}
                >
                  +
                </button>
              </div>
              <button
                className="primary full"
                disabled={
                  busy ||
                  !matching ||
                  !row.code ||
                  (!!pending && (!resumable || pending.request.id !== row.id))
                }
              >
                <ActionLabel icon="stamp">{ar ? 'اختم' : 'Stamp request'}</ActionLabel>
              </button>
            </form>
            {!pending && (
              <details>
                <summary>{ar ? 'رفض الطلب' : 'Reject request'}</summary>
                <form onSubmit={(event) => void submit(event, row, false)}>
                  <label>
                    {ar ? 'سبب الرفض' : 'Rejection reason'}
                    <input
                      required
                      minLength={4}
                      maxLength={500}
                      value={rejections[row.id] ?? ''}
                      onChange={(e) => setRejections({ ...rejections, [row.id]: e.target.value })}
                    />
                  </label>
                  <button className="secondary" disabled={busy}>
                    {ar ? 'ارفض الطلب' : 'Reject this request'}
                  </button>
                </form>
              </details>
            )}
          </article>
        );
      })}
      {!rows.length && (
        <p className="muted">
          {ar ? 'مفيش طلبات مفتوحة في الفرع.' : 'No open requests at this branch.'}
        </p>
      )}
    </section>
  );
}
