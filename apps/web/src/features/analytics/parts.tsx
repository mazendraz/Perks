import type { ReactNode } from 'react';
import type { Gate } from '../../../../../packages/contracts/src/analytics.js';
import type { Language } from '../../../../../packages/contracts/src/index.js';
import { intlLocale } from '../../locale.js';
import { copy, pick, say } from './copy.js';

export const num = (n: number, lang: Language) => new Intl.NumberFormat(intlLocale(lang)).format(n);

/** A small "?" that opens a one-line definition. Works by tap and keyboard, no hover needed. */
export function Hint({ text, lang }: { text: string; lang: Language }) {
  return (
    <details className="an-hint">
      <summary aria-label={lang === 'ar' ? 'يعني إيه؟' : 'What does this mean?'}>?</summary>
      <p>{text}</p>
    </details>
  );
}

export function Section({
  title,
  caption,
  id,
  className = '',
  children,
  action,
}: {
  title: string;
  caption?: string;
  id: string;
  className?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={'an-card ' + className} aria-labelledby={id}>
      <header className="an-card-head">
        <div>
          <h2 id={id}>{title}</h2>
          {caption && <p className="an-caption">{caption}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** Renders a section's body only when it has enough data and is in the plan. */
export function Gated<T>({
  gate,
  lang,
  children,
}: {
  gate: Gate<T>;
  lang: Language;
  children: (value: T) => ReactNode;
}) {
  if (gate.status === 'locked') return <p className="an-empty">{pick(copy.locked, lang)}</p>;
  if (gate.status === 'not_enough_data')
    return (
      <p className="an-empty">{say(copy.notEnough, lang, { need: gate.need, have: gate.have })}</p>
    );
  return <>{children(gate as T)}</>;
}

export function Delta({
  now,
  before,
  lang,
  points = false,
}: {
  now: number | null;
  before: number | null;
  lang: Language;
  points?: boolean;
}) {
  if (now === null || before === null)
    return <span className="an-delta">{pick(copy.deltaNew, lang)}</span>;
  if (points) {
    const d = Math.round(now - before);
    if (d === 0) return <span className="an-delta">{pick(copy.deltaSame, lang)}</span>;
    return (
      <span className={'an-delta ' + (d > 0 ? 'up' : 'down')}>
        <span aria-hidden="true">{d > 0 ? '▲' : '▼'}</span>{' '}
        <bdi dir="ltr">{(d > 0 ? '+' : '−') + Math.abs(d)}</bdi> {lang === 'ar' ? 'نقطة' : 'pts'}
      </span>
    );
  }
  if (before === 0)
    return <span className="an-delta">{pick(now ? copy.deltaNew : copy.deltaSame, lang)}</span>;
  const d = Math.round(((now - before) / before) * 100);
  if (d === 0) return <span className="an-delta">{pick(copy.deltaSame, lang)}</span>;
  return (
    <span className={'an-delta ' + (d > 0 ? 'up' : 'down')}>
      <span aria-hidden="true">{d > 0 ? '▲' : '▼'}</span>{' '}
      <bdi dir="ltr">{(d > 0 ? '+' : '−') + Math.abs(d) + '%'}</bdi>
    </span>
  );
}

export function StatTile({
  label,
  value,
  hint,
  lang,
  children,
}: {
  label: string;
  value: string;
  hint: string;
  lang: Language;
  children?: ReactNode;
}) {
  return (
    <div className="an-stat">
      <div className="an-stat-label">
        <span>{label}</span>
        <Hint text={hint} lang={lang} />
      </div>
      <strong className="an-num">{value}</strong>
      {children}
    </div>
  );
}
