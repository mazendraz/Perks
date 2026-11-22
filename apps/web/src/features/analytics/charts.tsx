import type {
  AnalyticsResponse,
  FunnelStep,
} from '../../../../../packages/contracts/src/analytics.js';
import type { Language } from '../../../../../packages/contracts/src/index.js';
import { intlLocale } from '../../locale.js';
import { copy, pick, say } from './copy.js';
import { num } from './parts.js';

const dayLabel = (iso: string, lang: Language) =>
  new Intl.DateTimeFormat(intlLocale(lang), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(iso + 'T00:00:00Z'));

/** Daily bars (weekly for 90 days); the latest bar is lime. Exact values live in a hidden table. */
export function VisitsTrend({ data, lang }: { data: AnalyticsResponse; lang: Language }) {
  const weekly = data.period.days === 90;
  const rows: { label: string; visits: number }[] = [];
  if (weekly) {
    // Weeks counted back from today so the last bar is the current week.
    const t = data.trend;
    for (let end = t.length; end > 0; end -= 7) {
      const slice = t.slice(Math.max(0, end - 7), end);
      rows.unshift({
        label: say(copy.weekOf, lang, { day: dayLabel(slice[0]!.day, lang) }),
        visits: slice.reduce((n, d) => n + d.visits, 0),
      });
    }
  } else for (const d of data.trend) rows.push({ label: dayLabel(d.day, lang), visits: d.visits });
  const max = Math.max(1, ...rows.map((r) => r.visits));
  return (
    <figure className="an-trend">
      <div className="an-bars" role="img" aria-label={pick(copy.trendLabel, lang)} dir="ltr">
        {rows.map((r, i) => (
          <span
            key={i}
            className={'an-bar' + (i === rows.length - 1 ? ' latest' : '')}
            style={{ height: Math.max(2, (100 * r.visits) / max) + '%' }}
            title={r.label + ': ' + r.visits}
          />
        ))}
      </div>
      <figcaption className="an-axis" dir="ltr">
        <bdi>{rows[0]?.label}</bdi>
        <bdi>{pick(copy.today, lang)}</bdi>
      </figcaption>
      <table className="sr-only">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <th scope="row">{r.label}</th>
              <td>{r.visits}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function Funnel({ steps, lang }: { steps: FunnelStep[]; lang: Language }) {
  const first = Math.max(1, steps[0]?.count ?? 1);
  // The step after which most people stop (as a share of those who reached it).
  let worst = -1,
    worstRate = 1;
  for (let i = 1; i < steps.length - 1; i++) {
    const prev = steps[i - 1]!.count;
    if (!prev) continue;
    const rate = steps[i]!.count / prev;
    if (rate < worstRate) {
      worstRate = rate;
      worst = i;
    }
  }
  return (
    <>
      <ol className="an-funnel">
        {steps.map((s, i) => (
          <li key={s.key} className={i === worst ? 'drop' : ''}>
            <div className="an-funnel-row">
              <span>{pick(copy.funnel[s.key], lang)}</span>
              <span className="an-num an-muted">
                {num(s.count, lang)} · {Math.round((100 * s.count) / first)}%
              </span>
            </div>
            <div className="an-track" aria-hidden="true">
              <span style={{ width: (100 * s.count) / first + '%' }} />
            </div>
          </li>
        ))}
      </ol>
      {worst > 0 && (
        <p className="an-callout warn">
          {say(copy.funnelDrop, lang, {
            from: pick(copy.funnel[steps[worst - 1]!.key], lang),
            to: pick(copy.funnel[steps[worst]!.key], lang),
            n: num(steps[worst - 1]!.count - steps[worst]!.count, lang),
          })}{' '}
          {copy.funnelTips[steps[worst - 1]!.key] &&
            pick(copy.funnelTips[steps[worst - 1]!.key]!, lang)}
        </p>
      )}
    </>
  );
}

export function Distribution({ buckets, lang }: { buckets: number[]; lang: Language }) {
  const max = Math.max(1, ...buckets),
    total = buckets.reduce((a, b) => a + b, 0);
  return (
    <>
      <div className="an-dist" role="img" aria-label={pick(copy.distCaption, lang)}>
        {buckets.map((n, i) => (
          <div key={i} className="an-dist-col">
            <span className="an-num">{num(n, lang)}</span>
            <span
              className={'an-dist-bar' + (i === 0 ? ' latest' : '')}
              style={{ height: (100 * n) / max + '%' }}
            />
            <span className="an-muted">{pick(copy.dist[i]!, lang)}</span>
          </div>
        ))}
      </div>
      {total > 0 && (
        <p className="an-note">
          {say(copy.distOnce, lang, { pct: Math.round((100 * buckets[0]!) / total) })}
        </p>
      )}
    </>
  );
}

export function PeakHeat({
  cells,
  quietest,
  lang,
}: {
  cells: number[][];
  quietest: { day: number; slot: number };
  lang: Language;
}) {
  const max = Math.max(1, ...cells.flat());
  const slot = (i: number) => pick(copy.heatSlots[i]!, lang);
  const day = (i: number) => pick(copy.heatDays[i]!, lang);
  return (
    <>
      <div className="an-heat-wrap">
        <table className="an-heat">
          <thead>
            <tr>
              <td />
              {copy.heatSlots.map((s, i) => (
                <th key={i} scope="col">
                  {pick(s, lang)}
                  <small dir="ltr">{copy.heatSlotHours[i]}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cells.map((row, d) => (
              <tr key={d}>
                <th scope="row">{day(d)}</th>
                {row.map((n, s) => {
                  const level = n / max;
                  return (
                    <td key={s}>
                      <span
                        className={'an-heat-cell' + (level >= 0.85 ? ' peak' : '')}
                        style={{ opacity: level >= 0.85 ? 1 : n ? 0.12 + level * 0.88 : 0.06 }}
                        title={say(copy.heatCell, lang, { day: day(d), slot: slot(s), n })}
                      >
                        <span className="sr-only">{n}</span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="an-note">
        {say(copy.heatQuiet, lang, { day: day(quietest.day), slot: slot(quietest.slot) })}
      </p>
    </>
  );
}
