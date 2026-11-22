import { useEffect, useState } from 'react';
import type {
  SegmentKey,
  SegmentPage,
  SegmentCustomer,
} from '../../../../../packages/contracts/src/analytics.js';
import type { Language } from '../../../../../packages/contracts/src/index.js';
import { api, errorText } from '../../api.js';
import { Icon } from '../../../../../packages/ui/src/Icon.js';
import { copy, daysText, pick, say } from './copy.js';
import { num } from './parts.js';

export function customerLine(c: SegmentCustomer, lang: Language) {
  if (c.sinceDays === null) return pick(copy.noVisit, lang);
  return say(copy.habit, lang, {
    gap: daysText(c.expectedGapDays, lang),
    since: daysText(c.sinceDays, lang),
  });
}

/** The people behind a number: one segment, most urgent first, searchable. */
export function SegmentSheet({
  merchantId,
  segment,
  branchId,
  lang,
  onClose,
  onOpenCustomer,
  footer,
}: {
  merchantId: string;
  segment: SegmentKey;
  branchId: string;
  lang: Language;
  onClose: () => void;
  onOpenCustomer?: (profileId: string) => void;
  footer?: React.ReactNode;
}) {
  const [page, setPage] = useState<SegmentPage | null>(null),
    [rows, setRows] = useState<SegmentCustomer[]>([]),
    [q, setQ] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = async (cursor?: string) => {
    setBusy(true);
    try {
      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      if (q.trim()) params.set('q', q.trim());
      if (branchId) params.set('branchId', branchId);
      const next = await api<SegmentPage>(
        '/merchants/' + merchantId + '/analytics/segments/' + segment + '?' + params,
      );
      setPage(next);
      setRows((r) => (cursor ? [...r, ...next.customers] : next.customers));
      setError('');
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [segment, q, branchId]);
  const title = pick(copy.segments[segment], lang);
  return (
    <div className="modal-backdrop sheet-backdrop" onClick={onClose}>
      <div
        className="dialog an-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="an-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="an-sheet-head">
          <div>
            <h2 id="an-sheet-title">{title}</h2>
            <p className="an-caption">
              {pick(copy.segmentRules[segment], lang)}
              {page && ' · ' + say(copy.listCount, lang, { n: num(page.total, lang) })}
            </p>
          </div>
          <button
            className="an-icon-button"
            data-dialog-close
            aria-label={pick(copy.close, lang)}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <label className="an-search">
          <span className="sr-only">{pick(copy.listSearch, lang)}</span>
          <input
            type="search"
            value={q}
            placeholder={pick(copy.listSearch, lang)}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <ul className="an-people" aria-busy={busy}>
          {rows.map((c) => (
            <li key={c.profileId}>
              <span className="an-avatar" aria-hidden="true">
                {c.alias.trim().charAt(0) || '•'}
              </span>
              <div className="an-person">
                <strong>{c.alias}</strong>
                <small>
                  {customerLine(c, lang)} · {say(copy.visitsCount, lang, { n: c.visits })}
                </small>
              </div>
              {c.stampsToReward !== null && (
                <span className="an-pill">
                  {say(copy.stampsLeft, lang, { n: c.stampsToReward })}
                </span>
              )}
              {onOpenCustomer && (
                <button
                  className="an-icon-button"
                  aria-label={c.alias}
                  onClick={() => onOpenCustomer(c.profileId)}
                >
                  <Icon name="arrow" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {page && !rows.length && !busy && <p className="an-empty">{pick(copy.listEmpty, lang)}</p>}
        {page?.nextCursor && (
          <button
            className="secondary an-more"
            disabled={busy}
            onClick={() => void load(page.nextCursor!)}
          >
            {pick(copy.listMore, lang)}
          </button>
        )}
        {footer}
      </div>
    </div>
  );
}
