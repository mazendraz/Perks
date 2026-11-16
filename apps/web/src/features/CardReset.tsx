import { useState, type FormEvent } from 'react';
import type { Grant, Language } from '../../../../packages/contracts/src/index.js';
import { api, ApiError, errorText } from '../api.js';
import { FieldErrors } from '../FieldErrors.js';

export interface ResettableMembership {
  id: string;
  name: string;
  balance: number;
  revision: number;
  auto_blocked?: boolean;
}

// Owners and managers only: zero a card (redeemed rewards stay in history) and, optionally,
// stop it from collecting automatic stamps. The server checks the role and the revision too.
export function CardReset({
  grant,
  membership,
  lang,
  onDone,
}: {
  grant: Grant;
  membership: ResettableMembership;
  lang: Language;
  onDone: () => void | Promise<void>;
}) {
  const ar = lang === 'ar';
  const [open, setOpen] = useState(false),
    [reason, setReason] = useState(''),
    [block, setBlock] = useState(false),
    [key, setKey] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [validation, setValidation] = useState<ApiError | null>(null);
  if (grant.role === 'cashier') return null;
  const base = '/merchants/' + grant.merchant_id + '/memberships/' + membership.id;
  const reset = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setValidation(null);
    try {
      await api(base + '/reset', {
        method: 'POST',
        key,
        revision: membership.revision,
        body: { reason: reason.trim(), blockAutoCollect: block },
      });
      setOpen(false);
      setReason('');
      await onDone();
    } catch (err) {
      setValidation(err instanceof ApiError ? err : null);
      setError(errorText(err, lang));
    } finally {
      setBusy(false);
    }
  };
  const unblock = async () => {
    setBusy(true);
    setError('');
    try {
      await api(base + '/auto-block', {
        method: 'POST',
        key: crypto.randomUUID(),
        body: { blocked: false },
      });
      await onDone();
    } catch (err) {
      setError(errorText(err, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card-reset">
      {membership.auto_blocked && (
        <p className="muted">
          {ar
            ? 'الأختام التلقائية متوقفة للكارت ده؛ الكاشير بس اللي يضيف أختام.'
            : 'Automatic stamps are stopped for this card; only the cashier adds stamps.'}{' '}
          <button className="text-button" disabled={busy} onClick={() => void unblock()}>
            {ar ? 'شغّلها تاني' : 'Allow again'}
          </button>
        </p>
      )}
      {!open ? (
        <button
          className="secondary small"
          onClick={() => {
            setKey(crypto.randomUUID());
            setOpen(true);
          }}
        >
          {ar ? 'تصفير الكارت' : 'Reset card'}
        </button>
      ) : (
        <form onSubmit={(e) => void reset(e)}>
          <p className="muted">
            {ar
              ? `الرصيد (${membership.balance}) هيبقى صفر والمكافآت اللي لسه ماتصرفتش هتتلغي. المكافآت المصروفة بتفضل في السجل.`
              : `The balance (${membership.balance}) goes to zero and unredeemed rewards are cancelled. Redeemed rewards stay in the history.`}
          </p>
          <label>
            {ar ? 'السبب (مطلوب)' : 'Reason (required)'}
            <textarea
              autoFocus
              required
              minLength={4}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} />
            {ar ? 'وقّف الأختام التلقائية للكارت ده' : 'Stop automatic stamps for this card'}
          </label>
          <FieldErrors error={validation} lang={lang} />
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="button" className="secondary" onClick={() => setOpen(false)}>
              {ar ? 'رجوع' : 'Back'}
            </button>
            <button className="danger" disabled={busy || reason.trim().length < 4} aria-busy={busy}>
              {ar ? 'تصفير الكارت' : 'Reset card'}
            </button>
          </div>
        </form>
      )}
      {!open && error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
