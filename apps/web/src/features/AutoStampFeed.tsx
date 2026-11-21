import { useEffect, useRef, useState } from 'react';
import type { Grant, Language } from '../../../../packages/contracts/src/index.js';
import type { AutoStampFeedItem } from '../../../../packages/contracts/src/commands.js';
import { api, errorText } from '../api.js';
import { useLiveRefresh } from '../live-events.js';
import { intlLocale } from '../locale.js';
import { BlockDialog, RevokeDialog } from './ScanActions.js';

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
      kind: 'revoke' | 'block';
    } | null>(null),
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
    new Date(value).toLocaleTimeString(intlLocale(lang), { hour: 'numeric', minute: '2-digit' });

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
              {s.customerBlocked && <small className="muted">{ar ? 'محظور' : 'Blocked'}</small>}
              {s.revoked ? (
                <small className="muted">{ar ? 'اتلغى' : 'Revoked'}</small>
              ) : s.usedInRedeemedReward ? (
                <small className="muted">
                  {ar ? 'اتحسب في هدية اتصرفت' : 'Counted in a redeemed reward'}
                </small>
              ) : (
                revocable(s) && (
                  <button
                    className="danger-outline small revoke-link"
                    onClick={() => {
                      setError('');
                      setConfirming({ stamp: s, kind: 'revoke' });
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
              {!s.customerBlocked && (
                <button
                  className="text-button small"
                  onClick={() => {
                    setError('');
                    setConfirming({ stamp: s, kind: 'block' });
                  }}
                >
                  {ar ? 'حظر العميل' : 'Block customer'}
                </button>
              )}
            </div>
            <strong>{s.revoked ? <s>+{s.quantity}</s> : '+' + s.quantity}</strong>
          </div>
        ))
      ) : (
        <p className="muted">
          {ar
            ? 'مفيش أختام تلقائية في الفرع ده آخر 12 ساعة.'
            : 'No automatic stamps at this branch in the last 12 hours.'}
        </p>
      )}
      {confirming?.kind === 'revoke' && (
        <RevokeDialog
          grant={grant}
          lang={lang}
          stamp={confirming.stamp}
          onClose={() => setConfirming(null)}
          onRevoked={() => {
            setNotice(
              ar
                ? 'اتلغى ختم ' + confirming.stamp.alias + '. الكارت اتحدّث.'
                : 'Stamp revoked for ' + confirming.stamp.alias + '. The card is updated.',
            );
            setConfirming(null);
            onChanged?.();
            void load();
          }}
        />
      )}
      {confirming?.kind === 'block' && (
        <BlockDialog
          grant={grant}
          lang={lang}
          alias={confirming.stamp.alias}
          membershipId={confirming.stamp.membershipId}
          origin="auto_stamp"
          originId={confirming.stamp.transactionId}
          onClose={() => setConfirming(null)}
          onBlocked={() => {
            setNotice(
              ar
                ? confirming.stamp.alias + ' اتحظر. تلاقيه في قائمة السبام.'
                : confirming.stamp.alias + ' is blocked. See the Spam list.',
            );
            setConfirming(null);
            void load();
          }}
        />
      )}
    </section>
  );
}
