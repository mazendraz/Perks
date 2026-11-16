import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Grant, Language } from '../../../../packages/contracts/src/index.js';
import type { AutoStampFeedItem } from '../../../../packages/contracts/src/commands.js';
import { api, ApiError, errorText } from '../api.js';
import { useLiveRefresh } from '../live-events.js';
import { FieldErrors } from '../FieldErrors.js';

// Stamps customers collected on their own (sticker or welcome) at this branch, live.
// The list comes only from the branch-scoped API and stream, so another branch never appears.
export function AutoStampFeed({
  grant,
  branch,
  lang,
  onChanged,
}: {
  grant: Grant;
  branch: string;
  lang: Language;
  onChanged?: () => void;
}) {
  const ar = lang === 'ar';
  const [stamps, setStamps] = useState<AutoStampFeedItem[]>([]),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [toast, setToast] = useState<AutoStampFeedItem | null>(null),
    [confirming, setConfirming] = useState<{
      stamp: AutoStampFeedItem;
      reason: string;
      key: string;
    } | null>(null),
    [validation, setValidation] = useState<ApiError | null>(null),
    [busy, setBusy] = useState(false),
    [, setTick] = useState(0);
  const seen = useRef<Set<string> | null>(null),
    generation = useRef(0),
    serial = useRef(0),
    clockOffset = useRef(0),
    audio = useRef<AudioContext | null>(null),
    toastTimer = useRef<number | undefined>(undefined);

  // Browsers only allow sound after a tap, so the first tap anywhere on the page unlocks it.
  useEffect(() => {
    const unlock = () => {
      try {
        if (typeof AudioContext !== 'function') return;
        audio.current ??= new AudioContext();
        void audio.current.resume().catch(() => {});
      } catch {
        /* Sound is optional. */
      }
    };
    document.addEventListener('pointerdown', unlock, { once: true });
    return () => document.removeEventListener('pointerdown', unlock);
  }, []);
  const announce = (stamp: AutoStampFeedItem) => {
    setToast(stamp);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 5000);
    if (document.hidden) return;
    try {
      const context = audio.current;
      if (context?.state === 'running')
        for (const [delay, frequency] of [
          [0, 880],
          [0.13, 1175],
        ] as const) {
          const oscillator = context.createOscillator(),
            gain = context.createGain();
          oscillator.frequency.value = frequency;
          gain.gain.value = 0.04;
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(context.currentTime + delay);
          oscillator.stop(context.currentTime + delay + 0.09);
          oscillator.onended = () => {
            oscillator.disconnect();
            gain.disconnect();
          };
        }
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
        navigator.vibrate?.([40, 60, 40]);
    } catch {
      /* Alerts never block the cashier. */
    }
  };
  const load = async () => {
    const current = generation.current,
      ticket = ++serial.current;
    try {
      const data = await api<{ serverTime: string; stamps: AutoStampFeedItem[] }>(
        '/merchants/' + grant.merchant_id + '/auto-stamps?branchId=' + encodeURIComponent(branch),
      );
      if (current !== generation.current || ticket !== serial.current) return;
      clockOffset.current = Date.parse(data.serverTime) - Date.now();
      // Only stamps that arrive while the screen is open are announced, never the backlog.
      if (seen.current) {
        const fresh = data.stamps.find((s) => !seen.current!.has(s.transactionId) && !s.revoked);
        if (fresh) announce(fresh);
      }
      seen.current = new Set(data.stamps.map((s) => s.transactionId));
      setStamps(data.stamps);
      setError('');
    } catch (e) {
      if (current === generation.current) setError(errorText(e, lang));
    }
  };
  useLiveRefresh('/branches/' + branch + '/events', load);
  useEffect(() => {
    generation.current++;
    seen.current = null;
    setStamps([]);
    setConfirming(null);
    setToast(null);
    setNotice('');
    void load();
  }, [branch, grant.merchant_id]);
  // Revoke buttons disappear on their own when the window closes.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 15000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(toastTimer.current);
    };
  }, []);
  const now = () => Date.now() + clockOffset.current;
  const revocable = (s: AutoStampFeedItem) =>
    !s.revoked && s.revocableUntil !== null && Date.parse(s.revocableUntil) > now();
  const time = (value: string) =>
    new Date(value).toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' });

  const revoke = async (e: FormEvent) => {
    e.preventDefault();
    if (!confirming) return;
    setBusy(true);
    setValidation(null);
    try {
      // The key is fixed when the dialog opens, so a retried tap never revokes twice.
      await api(
        '/merchants/' +
          grant.merchant_id +
          '/auto-stamps/' +
          confirming.stamp.transactionId +
          '/revoke',
        { method: 'POST', key: confirming.key, body: { reason: confirming.reason.trim() } },
      );
      setNotice(
        ar
          ? 'اتلغى ختم ' + confirming.stamp.alias + '. الكارت اتحدّث.'
          : 'Stamp revoked for ' + confirming.stamp.alias + '. The card is updated.',
      );
      setConfirming(null);
      onChanged?.();
      await load();
    } catch (e) {
      setValidation(e instanceof ApiError ? e : null);
      setError(errorText(e, lang));
      // A final answer (already revoked, window closed...) closes the dialog; a network doubt keeps it.
      if (e instanceof ApiError && [403, 404, 409].includes(e.status)) {
        setConfirming(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  };
  const reasons = ar
    ? ['العميل مكانش في المحل', 'ختم مكرر بالغلط']
    : ['Customer was not in the shop', 'Duplicate stamp by mistake'];

  return (
    <section className="panel auto-stamp-feed" aria-labelledby="auto-stamp-heading">
      <div className="section-heading">
        <h2 id="auto-stamp-heading">
          {ar ? 'أختام تلقائية' : 'Automatic stamps'}{' '}
          <span className="badge">{stamps.filter((s) => !s.revoked).length}</span>
        </h2>
      </div>
      {toast && (
        <div className="stamp-toast" role="status" aria-live="polite">
          <strong>{ar ? 'ختم جديد' : 'New stamp'}</strong>
          <span>
            <bdi>{toast.alias}</bdi> · +{toast.quantity}
            {toast.rewardEarned ? (ar ? ' · مكافأة 🎁' : ' · reward 🎁') : ''}
          </span>
        </div>
      )}
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
      {stamps.length ? (
        stamps.map((s) => (
          <div className={'activity-row' + (s.revoked ? ' revoked' : '')} key={s.transactionId}>
            <div>
              <strong>
                <bdi>{s.alias}</bdi>
              </strong>
              <small>
                {time(s.at)} · {ar ? 'الرصيد' : 'balance'} {s.balanceAfter}
                {s.source === 'welcome' ? (ar ? ' · ترحيب' : ' · welcome') : ''}
                {s.rewardEarned ? (ar ? ' · كسب مكافأة 🎁' : ' · earned a reward 🎁') : ''}
              </small>
              {s.revoked ? (
                <small className="muted">{ar ? 'اتلغى' : 'Revoked'}</small>
              ) : (
                revocable(s) && (
                  <button
                    className="text-button revoke-link"
                    onClick={() => {
                      setValidation(null);
                      setError('');
                      setConfirming({ stamp: s, reason: '', key: crypto.randomUUID() });
                    }}
                  >
                    {ar ? 'إلغاء الختم' : 'Revoke stamp'}
                    <small>
                      {' '}
                      ({ar ? 'لحد ' : 'until '}
                      {time(s.revocableUntil!)})
                    </small>
                  </button>
                )
              )}
            </div>
            <strong>{s.revoked ? <s>+{s.quantity}</s> : '+' + s.quantity}</strong>
          </div>
        ))
      ) : (
        <p className="muted">
          {ar
            ? 'مفيش أختام تلقائية في الفرع ده آخر ١٢ ساعة.'
            : 'No automatic stamps at this branch in the last 12 hours.'}
        </p>
      )}
      {confirming && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="revoke-heading"
            onSubmit={(e) => void revoke(e)}
          >
            <h2 id="revoke-heading">{ar ? 'إلغاء الختم؟' : 'Revoke this stamp?'}</h2>
            <p>
              <bdi>{confirming.stamp.alias}</bdi> · +{confirming.stamp.quantity} ·{' '}
              {time(confirming.stamp.at)}
            </p>
            <p className="muted">
              {confirming.stamp.rewardEarned
                ? ar
                  ? 'الختم ده كمّل الكارت، فالمكافأة اللي جت منه هتتلغي كمان.'
                  : 'This stamp completed the card, so the reward it earned is cancelled too.'
                : ar
                  ? 'الختم هيتشال من كارت العميل وكارت المحفظة هيتحدث.'
                  : 'The stamp comes off the customer’s card and their wallet pass updates.'}
            </p>
            <div className="chip-row">
              {reasons.map((r) => (
                <button
                  type="button"
                  className="secondary small"
                  key={r}
                  onClick={() => setConfirming({ ...confirming, reason: r })}
                >
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
                value={confirming.reason}
                onChange={(e) => setConfirming({ ...confirming, reason: e.target.value })}
              />
            </label>
            <FieldErrors error={validation} lang={lang} />
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                onClick={() => setConfirming(null)}
              >
                {ar ? 'رجوع' : 'Back'}
              </button>
              <button className="danger" disabled={busy} aria-busy={busy}>
                {ar ? 'إلغاء الختم' : 'Revoke stamp'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
