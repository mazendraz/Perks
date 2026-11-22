import { useEffect, useRef, useState } from 'react';
import type {
  ActionCard,
  AnalyticsResponse,
  SegmentKey,
} from '../../../../../packages/contracts/src/analytics.js';
import type { Branch, Language } from '../../../../../packages/contracts/src/index.js';
import { api, errorText } from '../../api.js';
import { intlLocale } from '../../locale.js';
import { CadenceCard } from './CadenceCard.js';
import { Distribution, Funnel, PeakHeat, VisitsTrend } from './charts.js';
import { copy, daysText, pick, say } from './copy.js';
import { Delta, Gated, num, Section, StatTile } from './parts.js';
import { sampleAnalytics } from './sample.js';
import { Cohorts, downloadCsv, HealthBody, ValueCard } from './advanced.js';
import { SegmentSheet } from './SegmentSheet.js';
import { SendSheet } from './SendSheet.js';
import { CustomerSheet } from './CustomerSheet.js';
import { audienceFor } from '../../../../../packages/contracts/src/analytics-messages.js';
import type { WalletAudience } from '../../../../../packages/contracts/src/owner-plan.js';
import './analytics.css';

type Period = 7 | 30 | 90;
const segmentOrder: SegmentKey[] = [
  'at_risk',
  'near_reward',
  'one_time',
  'reward_holder',
  'new',
  'regular',
  'vip',
  'reactivated',
  'lost',
  'never',
];
const segmentTone: Partial<Record<SegmentKey, string>> = {
  at_risk: 'warn',
  one_time: 'warn',
  lost: 'danger',
  regular: 'ok',
  reactivated: 'ok',
  near_reward: 'lime',
  reward_holder: 'lime',
  vip: 'ink',
};

export function AnalyticsPage({
  merchantId,
  lang,
  role,
  branches,
}: {
  merchantId: string;
  lang: Language;
  role: 'owner' | 'manager';
  branches: Branch[];
}) {
  const [days, setDays] = useState<Period>(30),
    [branchId, setBranchId] = useState(''),
    [data, setData] = useState<AnalyticsResponse | null>(null),
    [sample, setSample] = useState(false),
    [error, setError] = useState(''),
    [sheet, setSheet] = useState<SegmentKey | null>(null),
    [cadenceOpen, setCadenceOpen] = useState(false),
    [send, setSend] = useState<{ audience: WalletAudience; label: string; size: number } | null>(
      null,
    ),
    [customer, setCustomer] = useState<string | null>(null),
    [notice, setNotice] = useState('');
  const seq = useRef(0);
  const load = async () => {
    const mine = ++seq.current;
    try {
      const next = await api<AnalyticsResponse>(
        '/merchants/' +
          merchantId +
          '/analytics?days=' +
          days +
          (branchId ? '&branchId=' + branchId : ''),
      );
      if (mine === seq.current) {
        setData(next);
        setError('');
      }
    } catch (e) {
      if (mine === seq.current) setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void load();
    // Fresh numbers while the page is open; the server answers 304 when nothing changed.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60_000);
    const wake = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', wake);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [merchantId, days, branchId]);

  const view = sample ? sampleAnalytics(days) : data;
  const owner = role === 'owner';
  const time = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale(lang), { hour: 'numeric', minute: '2-digit' }).format(
      new Date(iso),
    );
  const empty = !sample && data && data.kpis.customers === 0;
  const open = (key: SegmentKey) => !sample && setSheet(key);
  const onOpenCustomer = (profileId: string) => !sample && setCustomer(profileId);
  // Owners reach a group with a ready Wallet message; managers see who is in it.
  const sendTo = (key: SegmentKey, size: number) => {
    const audience = audienceFor(key);
    if (!owner || !audience) return false;
    setSend({ audience, label: pick(copy.segments[key], lang), size });
    return true;
  };
  const act = (a: ActionCard) => {
    if (sample) return;
    if (!sendTo(a.key, a.count)) setSheet(a.key);
  };

  return (
    <div className="an-page" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <header className="an-head">
        <div>
          <span className="eyebrow">{pick(copy.eyebrow, lang)}</span>
          <h2 className="an-title">{pick(copy.title, lang)}</h2>
          {view && (
            <p className="an-caption">{say(copy.updated, lang, { time: time(view.updatedAt) })}</p>
          )}
        </div>
        <div className="an-controls">
          {branches.length > 1 && (
            <label className="an-select">
              <span className="sr-only">{pick(copy.branch, lang)}</span>
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">{pick(copy.allBranches, lang)}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="an-segmented" role="group" aria-label={pick(copy.period, lang)}>
            {([7, 30, 90] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={days === p}
                className={days === p ? 'on' : ''}
                onClick={() => setDays(p)}
              >
                {pick(copy.periods[p]!, lang)}
              </button>
            ))}
          </div>
        </div>
      </header>

      {sample && (
        <div className="an-sample" role="status">
          <span className="an-pill lime">{pick(copy.sampleBadge, lang)}</span>
          <button className="text-button" onClick={() => setSample(false)}>
            {pick(copy.sampleExit, lang)}
          </button>
        </div>
      )}
      {!sample && data && !data.cadence.confirmed && owner && !cadenceOpen && (
        <div className="an-banner">
          <span>{pick(copy.cadenceBanner, lang)}</span>
          <button className="secondary small" onClick={() => setCadenceOpen(true)}>
            {pick(copy.cadencePick, lang)}
          </button>
        </div>
      )}
      {notice && (
        <div className="notice success" role="status">
          {notice}{' '}
          <button className="text-button" onClick={() => setNotice('')}>
            {pick(copy.close, lang)}
          </button>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}{' '}
          <button className="text-button" onClick={() => void load()}>
            {pick(copy.retry, lang)}
          </button>
        </div>
      )}
      {!view && !error && <AnalyticsSkeleton lang={lang} />}

      {empty && (
        <section className="an-card an-empty-state">
          <h2>{pick(copy.emptyTitle, lang)}</h2>
          <p>{pick(copy.emptyText, lang)}</p>
          <button className="primary" onClick={() => setSample(true)}>
            {pick(copy.sample, lang)}
          </button>
        </section>
      )}

      {view && !empty && (
        <>
          <TodayActions data={view} lang={lang} onAct={act} onSee={(k) => open(k)} />
          <KpiRow data={view} lang={lang} />
          <div className="an-row">
            <Section
              id="an-trend"
              className="an-grow"
              title={pick(copy.trend, lang)}
              caption={pick(copy.trendCaption[view.period.days]!, lang)}
            >
              <VisitsTrend data={view} lang={lang} />
            </Section>
            <ValueCard data={view} lang={lang} merchantId={merchantId} />
          </div>

          <Section
            id="an-segments"
            title={pick(copy.segmentsTitle, lang)}
            caption={pick(copy.segmentsCaption, lang)}
          >
            <ul className="an-segments">
              {segmentOrder.map((k) => (
                <li key={k}>
                  <button className="an-segment" onClick={() => open(k)} disabled={sample}>
                    <span className={'an-tag ' + (segmentTone[k] ?? '')}>
                      {pick(copy.segments[k], lang)}
                    </span>
                    <strong className="an-num">{num(view.segments[k], lang)}</strong>
                    <small>{pick(copy.segmentRules[k], lang)}</small>
                  </button>
                </li>
              ))}
            </ul>
          </Section>

          <div className="an-row">
            <Section
              id="an-funnel"
              className="an-grow"
              title={pick(copy.funnelTitle, lang)}
              caption={pick(copy.funnelCaption, lang)}
            >
              <Gated gate={view.funnel} lang={lang}>
                {(f) => <Funnel steps={f.steps} lang={lang} />}
              </Gated>
            </Section>
            <Section
              id="an-dist"
              className="an-grow"
              title={pick(copy.distTitle, lang)}
              caption={pick(copy.distCaption, lang)}
            >
              <Gated gate={view.distribution} lang={lang}>
                {(d) => <Distribution buckets={d.buckets} lang={lang} />}
              </Gated>
            </Section>
          </div>

          <div className="an-row">
            <Section
              id="an-heat"
              className="an-grow"
              title={pick(copy.heatTitle, lang)}
              caption={pick(copy.heatCaption, lang)}
            >
              <Gated gate={view.heat} lang={lang}>
                {(h) => <PeakHeat cells={h.cells} quietest={h.quietest} lang={lang} />}
              </Gated>
            </Section>
            <Section
              id="an-risk"
              className="an-grow"
              title={pick(copy.atRiskTitle, lang)}
              action={
                view.segments.at_risk > view.atRisk.length ? (
                  <button className="text-button" onClick={() => open('at_risk')}>
                    {say(copy.atRiskAll, lang, { n: num(view.segments.at_risk, lang) })}
                  </button>
                ) : undefined
              }
            >
              {view.atRisk.length ? (
                <ul className="an-people">
                  {view.atRisk.map((c) => (
                    <li key={c.profileId}>
                      <span className="an-avatar" aria-hidden="true">
                        {c.alias.trim().charAt(0) || '•'}
                      </span>
                      <div className="an-person">
                        <strong>{c.alias}</strong>
                        <small>
                          {say(copy.habit, lang, {
                            gap: daysText(c.expectedGapDays, lang),
                            since: daysText(c.sinceDays, lang),
                          })}
                        </small>
                      </div>
                      {c.stampsToReward !== null && (
                        <span className="an-pill">
                          {say(copy.stampsLeft, lang, { n: c.stampsToReward })}
                        </span>
                      )}
                      {!sample && (
                        <button
                          className="secondary small"
                          onClick={() => onOpenCustomer(c.profileId)}
                        >
                          {pick(copy.open, lang)}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="an-empty">{pick(copy.atRiskEmpty, lang)}</p>
              )}
            </Section>
          </div>

          <div className="an-row">
            <Section
              id="an-health"
              className="an-grow"
              title={pick(copy.healthTitle, lang)}
              caption={pick(copy.healthCaption, lang)}
            >
              <Gated gate={view.health} lang={lang}>
                {(h) => (
                  <HealthBody score={h.score} weakest={h.weakest} parts={h.parts} lang={lang} />
                )}
              </Gated>
            </Section>
            <Section
              id="an-cohorts"
              className="an-grow"
              title={pick(copy.cohortsTitle, lang)}
              caption={pick(copy.cohortsCaption, lang)}
            >
              <Gated gate={view.cohorts} lang={lang}>
                {(c) => <Cohorts rows={c.rows} lang={lang} />}
              </Gated>
            </Section>
          </div>

          {view.branches.length > 1 && <BranchTable data={view} lang={lang} />}
          {view.sections.export && !sample && (
            <button className="secondary an-export" onClick={() => downloadCsv(view, lang)}>
              {pick(copy.exportCsv, lang)}
            </button>
          )}
        </>
      )}

      {!sample && data && (
        <CadenceCard
          merchantId={merchantId}
          lang={lang}
          canEdit={owner}
          startOpen={cadenceOpen}
          onSaved={() => {
            setCadenceOpen(false);
            void load();
          }}
        />
      )}

      {sheet && (
        <SegmentSheet
          merchantId={merchantId}
          segment={sheet}
          branchId={branchId}
          lang={lang}
          onClose={() => setSheet(null)}
          onOpenCustomer={onOpenCustomer}
          footer={
            owner && audienceFor(sheet) && view && view.segments[sheet] > 0 ? (
              <button
                className="primary an-sheet-send"
                onClick={() => {
                  const key = sheet;
                  setSheet(null);
                  sendTo(key, view.segments[key]);
                }}
              >
                {pick(copy.sendToGroup, lang)}
              </button>
            ) : undefined
          }
        />
      )}
      {send && (
        <SendSheet
          merchantId={merchantId}
          audience={send.audience}
          label={send.label}
          groupSize={send.size}
          lang={lang}
          onClose={() => setSend(null)}
          onSent={(message) => {
            setSend(null);
            setNotice(message);
            void load();
          }}
        />
      )}
      {customer && (
        <CustomerSheet
          merchantId={merchantId}
          profileId={customer}
          lang={lang}
          onClose={() => setCustomer(null)}
        />
      )}
    </div>
  );
}

function TodayActions({
  data,
  lang,
  onAct,
  onSee,
}: {
  data: AnalyticsResponse;
  lang: Language;
  onAct: (a: ActionCard) => void;
  onSee: (k: SegmentKey) => void;
}) {
  const cards = data.actions.filter((a) => a.count > 0).slice(0, 3);
  return (
    <section className="an-today" aria-labelledby="an-today-title">
      <span className="an-today-eyebrow">{pick(copy.todo, lang)}</span>
      <h2 id="an-today-title">{pick(cards.length ? copy.todoTitle : copy.todoNone, lang)}</h2>
      {cards.length > 0 && (
        <div className="an-actions">
          {cards.map((a) => {
            const t = copy.actions[a.key];
            return (
              <article key={a.key} className="an-action">
                <p className="an-action-count">
                  <strong className="an-num">{num(a.count, lang)}</strong> {pick(t.unit, lang)}
                </p>
                <p>{pick(t.text, lang)}</p>
                {(() => {
                  const last = data.messageImpact.find((m) => m.audience === audienceFor(a.key));
                  return last ? (
                    <p className="an-action-impact">
                      {say(copy.lastMessage, lang, {
                        returned: num(last.returned, lang),
                        recipients: num(last.recipients, lang),
                      })}
                    </p>
                  ) : null;
                })()}
                <div className="an-action-buttons">
                  <button className="an-lime-button" onClick={() => onAct(a)}>
                    {pick(t.cta, lang)}
                  </button>
                  <button className="an-ghost-button" onClick={() => onSee(a.key)}>
                    {pick(copy.seeWho, lang)}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function KpiRow({ data, lang }: { data: AnalyticsResponse; lang: Language }) {
  const k = data.kpis;
  return (
    <div className="an-stats-block">
      <section className="an-stats" aria-label={pick(copy.kpis.visits, lang)}>
        <StatTile
          label={pick(copy.kpis.active, lang)}
          value={num(k.active, lang)}
          hint={pick(copy.hints.active, lang)}
          lang={lang}
        >
          <Delta now={k.active} before={k.previous.active} lang={lang} />
        </StatTile>
        <StatTile
          label={pick(copy.kpis.visits, lang)}
          value={num(k.visits, lang)}
          hint={pick(copy.hints.visits, lang)}
          lang={lang}
        >
          <Delta now={k.visits} before={k.previous.visits} lang={lang} />
        </StatTile>
        <StatTile
          label={pick(copy.kpis.newCustomers, lang)}
          value={num(k.newCustomers, lang)}
          hint={pick(copy.hints.newCustomers, lang)}
          lang={lang}
        >
          <Delta now={k.newCustomers} before={k.previous.newCustomers} lang={lang} />
        </StatTile>
        <StatTile
          label={pick(copy.kpis.returnRate, lang)}
          value={k.returnRate === null ? '—' : num(Math.round(k.returnRate), lang) + '%'}
          hint={pick(copy.hints.returnRate, lang)}
          lang={lang}
        >
          <Delta now={k.returnRate} before={k.previous.returnRate} lang={lang} points />
        </StatTile>
        <StatTile
          label={pick(copy.kpis.customers, lang)}
          value={num(k.customers, lang)}
          hint={pick(copy.hints.customers, lang)}
          lang={lang}
        />
        <StatTile
          label={pick(copy.kpis.typicalGap, lang)}
          value={k.typicalGapDays === null ? '—' : daysText(k.typicalGapDays, lang)}
          hint={pick(copy.hints.typicalGap, lang)}
          lang={lang}
        />
      </section>
      <p className="an-caption">
        {say(copy.deltaCaption, lang, { days: daysText(data.period.days, lang) })}
      </p>
    </div>
  );
}

function BranchTable({ data, lang }: { data: AnalyticsResponse; lang: Language }) {
  const c = copy.branchCols;
  const approval = (s: number | null) =>
    s === null
      ? '—'
      : s < 90
        ? say(copy.seconds, lang, { n: s })
        : say(copy.minutes, lang, { n: Math.round(s / 60) });
  return (
    <Section id="an-branches" title={pick(copy.branchesTitle, lang)}>
      <div className="an-table-wrap">
        <table className="an-table">
          <thead>
            <tr>
              <th scope="col">{pick(c.name, lang)}</th>
              <th scope="col">{pick(c.visits, lang)}</th>
              <th scope="col">{pick(c.newCustomers, lang)}</th>
              <th scope="col">{pick(c.returnRate, lang)}</th>
              <th scope="col">{pick(c.approval, lang)}</th>
              <th scope="col">{pick(c.pending, lang)}</th>
            </tr>
          </thead>
          <tbody>
            {data.branches.map((b) => (
              <tr key={b.id}>
                <th scope="row">{b.name}</th>
                <td className="an-num">{num(b.visits, lang)}</td>
                <td className="an-num">{num(b.newCustomers, lang)}</td>
                <td className="an-num">
                  {b.returnRate === null ? '—' : Math.round(b.returnRate) + '%'}
                </td>
                <td>
                  <span
                    className={'an-tag ' + ((b.medianApprovalSeconds ?? 0) > 180 ? 'warn' : 'ok')}
                  >
                    {approval(b.medianApprovalSeconds)}
                  </span>
                </td>
                <td className="an-num">{num(b.pending, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function AnalyticsSkeleton({ lang }: { lang: Language }) {
  return (
    <div className="an-skeleton" aria-busy="true" aria-label={pick(copy.loading, lang)}>
      <span className="an-sk an-sk-hero" />
      <div className="an-stats">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="an-sk an-sk-tile" />
        ))}
      </div>
      <span className="an-sk an-sk-chart" />
    </div>
  );
}
