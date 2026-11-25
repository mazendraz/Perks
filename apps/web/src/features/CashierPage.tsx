import { ActionLabel, Icon } from '../../../../packages/ui/src/Icon.js';
import { Select } from '../controls/Select.js';
import { CashierRequests } from './StampRequests.js';
import { useSignOut } from '../sign-out.js';
import { TeamCustomerRecovery } from './CustomerRecovery.js';
import { AutoStampFeed } from './AutoStampFeed.js';
import { CashierRedeemQueue } from './RedeemRequests.js';
import { useEffect, useState, type FormEvent, type CSSProperties } from 'react';
import { InstallAppButton } from './InstallCard.js';
import type { Grant, Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
import { intlLocale } from '../locale.js';
import { ShiftSummary } from './TodayStrip.js';
import { holdUpdates } from '../update-gate.js';
interface Recent {
  id: string;
  public_reference: string;
  type: string;
  quantity: number;
  at: string;
  alias: string;
  branch_id: string;
}
/** "Today", "Yesterday" or a short date, so an old sale never looks like a new one. */
function dayLabel(at: string, lang: Language) {
  const d = new Date(at),
    today = new Date(),
    start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(),
    diff = Math.round((start(today) - start(d)) / 86_400_000);
  if (diff === 0) return lang === 'ar' ? 'النهارده' : 'Today';
  if (diff === 1) return lang === 'ar' ? 'امبارح' : 'Yesterday';
  return d.toLocaleDateString(intlLocale(lang), { day: 'numeric', month: 'short' });
}
export function CashierPage({ grant, lang }: { grant: Grant; lang: Language }) {
  const ar = lang === 'ar';
  // Ending the shift signs the cashier out; a customer card on this phone stays.
  const signOut = useSignOut(
    lang,
    () => location.assign('/cashier/login'),
    (e) => setError(errorText(e, lang)),
  );
  const [branch, setBranch] = useState(grant.branches[0]?.id || ''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [recent, setRecent] = useState<Recent[]>([]),
    // Recent activity is reference, not the job: folded on a phone, open on a wider screen.
    [recentOpen, setRecentOpen] = useState(
      () => !window.matchMedia?.('(max-width: 760px)').matches,
    ),
    [correction, setCorrection] = useState<{ tx: Recent; reason: string } | null>(null),
    [notice, setNotice] = useState('');
  const refreshRecent = async () => {
    try {
      const r = await api<{ transactions: Recent[] }>(
        '/merchants/' + grant.merchant_id + '/transactions',
      );
      setRecent(r.transactions.filter((t) => t.branch_id === branch));
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void refreshRecent();
  }, [branch]);
  // A correction being written must not be lost to a silent update.
  useEffect(() => (correction ? holdUpdates() : undefined), [!!correction]);
  const requestCorrection = async (e: FormEvent) => {
    e.preventDefault();
    if (!correction) return;
    setBusy(true);
    try {
      await api('/merchants/' + grant.merchant_id + '/corrections', {
        method: 'POST',
        key: crypto.randomUUID(),
        body: {
          transactionId: correction.tx.id,
          delta: -correction.tx.quantity,
          reason: correction.reason,
        },
      });
      setCorrection(null);
      setNotice(
        ar
          ? 'طلب التصحيح اتبعت. الرصيد مش هيتغير قبل مراجعة المدير.'
          : 'Correction requested. Balance changes only after manager review.',
      );
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mobile-cashier" style={{ '--brand': grant.primary_color } as CSSProperties}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{grant.name}</span>
          <h1>{ar ? 'الكاشير' : 'Cashier'}</h1>
        </div>
        <button className="secondary small" onClick={() => void signOut.request()}>
          {ar ? 'قفل الوردية' : 'Lock shift'}
        </button>
      </div>
      <InstallAppButton lang={lang} portal="cashier" />
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
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
      <div className="action-stack">
        <CashierRedeemQueue
          grant={grant}
          branch={branch}
          lang={lang}
          onRedeemed={() => void refreshRecent()}
        />
        <CashierRequests
          grant={grant}
          branch={branch}
          lang={lang}
          onCommitted={() => void refreshRecent()}
        />
        <TeamCustomerRecovery
          key={grant.id + ':' + branch}
          grant={grant}
          branchId={branch}
          lang={lang}
        />
        <AutoStampFeed
          grant={grant}
          branch={branch}
          lang={lang}
          onChanged={() => void refreshRecent()}
        />
        <section className="panel cashier-recent" aria-labelledby="cashier-recent-heading">
          <h2 id="cashier-recent-heading" className="cashier-recent-heading">
            <button
              type="button"
              className="cashier-recent-toggle"
              aria-expanded={recentOpen}
              aria-controls="cashier-recent-body"
              onClick={() => setRecentOpen((open) => !open)}
            >
              <span className="cashier-recent-title">
                {ar ? 'آخر العمليات' : 'Recent activity'}
              </span>
              <span className="badge" aria-hidden="true">
                {Math.min(recent.length, 8)}
              </span>
              <span className="cashier-recent-action">
                {recentOpen ? (ar ? 'إخفاء' : 'Hide') : ar ? 'عرض' : 'Show'}
                <Icon name="chevronDown" size={18} />
              </span>
            </button>
          </h2>
          <div id="cashier-recent-body" className="cashier-recent-body" hidden={!recentOpen}>
            <ShiftSummary merchantId={grant.merchant_id} lang={lang} />
            {recent.length ? (
              recent.slice(0, 8).map((t) => (
                <div className="activity-row" key={t.id}>
                  <div>
                    <strong>
                      <bdi>{t.alias || (ar ? 'عميل' : 'Customer')}</bdi>
                    </strong>
                    <small>
                      {dayLabel(t.at, lang)} ·{' '}
                      {new Date(t.at).toLocaleTimeString(intlLocale(lang), {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </small>
                  </div>
                  <div className="activity-end">
                    <strong>
                      {t.type === 'redeem' ? '★' : (t.quantity > 0 ? '+' : '') + t.quantity}
                    </strong>
                    {t.type === 'award' && (
                      <button
                        className="text-button small correction-link"
                        aria-label={
                          (ar ? 'طلب تصحيح: ' : 'Request correction: ') +
                          (t.alias || (ar ? 'عميل' : 'Customer'))
                        }
                        onClick={() => setCorrection({ tx: t, reason: '' })}
                      >
                        <ActionLabel icon="refresh">{ar ? 'تصحيح' : 'Correct'}</ActionLabel>
                      </button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">
                {ar ? 'لسه مفيش عمليات في الفرع ده.' : 'No transactions at this branch yet.'}
              </p>
            )}
          </div>
        </section>
      </div>
      {correction && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="correction-heading"
            onSubmit={(e) => void requestCorrection(e)}
          >
            <h2 id="correction-heading">{ar ? 'طلب تصحيح' : 'Request correction'}</h2>
            <p>
              <bdi>{correction.tx.public_reference}</bdi> ·{correction.tx.alias}
            </p>
            <p className="muted">
              {ar
                ? 'الطلب هيُراجع لعكس العملية بالكامل. وجود عمليات لاحقة أو مكافأة مصروفة يحتاج مراجعة خاصة.'
                : 'This requests a full reversal. Later activity or a redeemed reward requires manual review.'}
            </p>
            <label>
              {ar ? 'السبب' : 'Reason'}
              <textarea
                autoFocus
                minLength={4}
                required
                value={correction.reason}
                onChange={(e) => setCorrection({ ...correction, reason: e.target.value })}
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                onClick={() => setCorrection(null)}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button className="primary" disabled={busy} aria-busy={busy}>
                {ar ? 'ابعت للمدير' : 'Send for review'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
