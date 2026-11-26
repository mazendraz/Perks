import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  ActionCard,
  AnalyticsResponse,
  SegmentKey,
  SegmentPage,
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
import { WhatsAppSheet } from './WhatsAppSheet.js';
import { CustomerSheet } from './CustomerSheet.js';
import { audienceFor } from '../../../../../packages/contracts/src/analytics-messages.js';
import type {
  WalletAudience,
  WalletMessagePreview,
} from '../../../../../packages/contracts/src/owner-plan.js';
import { Icon } from '../../../../../packages/ui/src/Icon.js';
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
  // Not 'danger': that is the app-wide red button class, which turned this tag into a button.
  lost: 'gone',
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
    [send, setSend] = useState<{ audience: WalletAudience; label: string } | null>(null),
    [customer, setCustomer] = useState<string | null>(null),
    [whatsapp, setWhatsapp] = useState<ActionCard['key'] | null>(null),
    [reachRevision, setReachRevision] = useState(0),
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
  const sendTo = (key: SegmentKey) => {
    const audience = audienceFor(key);
    if (!owner || !audience) return false;
    setSend({ audience, label: pick(copy.segments[key], lang) });
    return true;
  };
  const act = (a: ActionCard) => {
    if (sample) return;
    if (!sendTo(a.key)) setSheet(a.key);
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
          <TodayActions
            data={view}
            lang={lang}
            onAct={act}
            onSee={(k) => open(k)}
            onWhatsApp={setWhatsapp}
            reach={owner && !sample ? { merchantId, branchId, revision: reachRevision } : null}
          />
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

          <ReadySections
            lang={lang}
            sections={[
              {
                id: 'an-funnel',
                title: pick(copy.funnelTitle, lang),
                caption: pick(copy.funnelCaption, lang),
                gate: view.funnel,
                body: () => (
                  <Gated gate={view.funnel} lang={lang}>
                    {(f) => <Funnel steps={f.steps} lang={lang} />}
                  </Gated>
                ),
              },
              {
                id: 'an-dist',
                title: pick(copy.distTitle, lang),
                caption: pick(copy.distCaption, lang),
                gate: view.distribution,
                body: () => (
                  <Gated gate={view.distribution} lang={lang}>
                    {(d) => <Distribution buckets={d.buckets} lang={lang} />}
                  </Gated>
                ),
              },
              {
                id: 'an-heat',
                title: pick(copy.heatTitle, lang),
                caption: pick(copy.heatCaption, lang),
                gate: view.heat,
                body: () => (
                  <Gated gate={view.heat} lang={lang}>
                    {(h) => <PeakHeat cells={h.cells} quietest={h.quietest} lang={lang} />}
                  </Gated>
                ),
              },
              {
                id: 'an-health',
                title: pick(copy.healthTitle, lang),
                caption: pick(copy.healthCaption, lang),
                gate: view.health,
                body: () => (
                  <Gated gate={view.health} lang={lang}>
                    {(h) => (
                      <HealthBody score={h.score} weakest={h.weakest} parts={h.parts} lang={lang} />
                    )}
                  </Gated>
                ),
              },
              {
                id: 'an-cohorts',
                title: pick(copy.cohortsTitle, lang),
                caption: pick(copy.cohortsCaption, lang),
                gate: view.cohorts,
                body: () => (
                  <Gated gate={view.cohorts} lang={lang}>
                    {(c) => <Cohorts rows={c.rows} lang={lang} />}
                  </Gated>
                ),
              },
            ]}
          />

          <div className="an-row">
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
                  sendTo(key);
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
          lang={lang}
          onClose={() => setSend(null)}
          onSent={(message) => {
            setSend(null);
            setNotice(message);
            setReachRevision((n) => n + 1);
            void load();
          }}
        />
      )}
      {whatsapp && audienceFor(whatsapp) && (
        <WhatsAppSheet
          merchantId={merchantId}
          segment={whatsapp}
          audience={audienceFor(whatsapp)!}
          label={pick(copy.segments[whatsapp], lang)}
          branchId={branchId}
          lang={lang}
          onClose={() => setWhatsapp(null)}
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

type Blocked = keyof typeof copy.walletBlocked;
/** Whether a Wallet message can reach each card's group now, and if not, who WhatsApp can reach. */
type Reach = { wallet: number; blocked: Blocked; whatsapp: number };

function useActionReach(
  keys: ActionCard['key'][],
  scope: { merchantId: string; branchId: string; revision: number } | null,
) {
  const [reach, setReach] = useState<Partial<Record<ActionCard['key'], Reach>>>({});
  const sig = keys.join(',');
  useEffect(() => {
    if (!scope || !keys.length) return setReach({});
    let live = true;
    const base = '/merchants/' + scope.merchantId;
    void (async () => {
      try {
        const state = await api<{ used: number; limit: number | null }>(base + '/wallet-messages');
        const noneLeft = state.limit !== null && state.used >= state.limit;
        const entries = await Promise.all(
          keys.map(async (key) => {
            const audience = audienceFor(key);
            if (!audience) return null;
            const preview = await api<WalletMessagePreview>(
              base + '/wallet-messages/preview?audience=' + audience,
            );
            const wallet = noneLeft ? 0 : preview.customers;
            if (wallet > 0) return [key, { wallet, blocked: 'unreachable', whatsapp: 0 }] as const;
            const params = new URLSearchParams({ whatsapp: '1' });
            if (scope.branchId) params.set('branchId', scope.branchId);
            const page = await api<SegmentPage>(base + '/analytics/segments/' + key + '?' + params);
            const blocked: Blocked = noneLeft
              ? 'limit'
              : preview.recentlyContacted > 0
                ? 'recent'
                : 'unreachable';
            return [key, { wallet, blocked, whatsapp: page.whatsappReady }] as const;
          }),
        );
        if (live) setReach(Object.fromEntries(entries.filter((e) => e !== null)));
      } catch {
        // Unknown: keep the plain cards rather than hide a real chance.
        if (live) setReach({});
      }
    })();
    return () => {
      live = false;
    };
  }, [sig, scope?.merchantId, scope?.branchId, scope?.revision]);
  return reach;
}

function TodayActions({
  data,
  lang,
  onAct,
  onSee,
  onWhatsApp,
  reach: scope,
}: {
  data: AnalyticsResponse;
  lang: Language;
  onAct: (a: ActionCard) => void;
  onSee: (k: SegmentKey) => void;
  onWhatsApp: (k: ActionCard['key']) => void;
  reach: { merchantId: string; branchId: string; revision: number } | null;
}) {
  const waiting = data.actions.filter((a) => a.count > 0);
  const reach = useActionReach(
    waiting.map((a) => a.key),
    scope,
  );
  // A group that neither a Wallet message nor WhatsApp can reach right now is not a task today.
  const cards = waiting
    .filter((a) => {
      const r = reach[a.key];
      return !r || r.wallet > 0 || r.whatsapp > 0;
    })
    .slice(0, 3);
  const title = cards.length ? copy.todoTitle : waiting.length ? copy.todoDone : copy.todoNone;
  return (
    <section className="an-today" aria-labelledby="an-today-title">
      <span className="an-today-eyebrow">{pick(copy.todo, lang)}</span>
      <h2 id="an-today-title">{pick(title, lang)}</h2>
      {cards.length > 0 && (
        <div className="an-actions">
          {cards.map((a) => {
            const t = copy.actions[a.key];
            const r = reach[a.key];
            const viaWhatsApp = !!r && r.wallet === 0;
            const last = data.messageImpact.find((m) => m.audience === audienceFor(a.key));
            return (
              <article key={a.key} className="an-action">
                <p className="an-action-count">
                  <strong className="an-num">{num(a.count, lang)}</strong> {pick(t.unit, lang)}
                </p>
                <p>{pick(t.text, lang)}</p>
                {viaWhatsApp ? (
                  <p className="an-action-blocked">{pick(copy.walletBlocked[r.blocked], lang)}</p>
                ) : (
                  last && (
                    <p className="an-action-impact">
                      {say(copy.lastMessage, lang, {
                        returned: num(last.returned, lang),
                        recipients: num(last.recipients, lang),
                      })}
                    </p>
                  )
                )}
                <div className="an-action-buttons">
                  {viaWhatsApp ? (
                    <button className="an-lime-button an-wa-cta" onClick={() => onWhatsApp(a.key)}>
                      <Icon name="message" size={18} />
                      {pick(copy.whatsappCta, lang)}
                      {r.whatsapp < a.count && (
                        <span className="an-wa-count">
                          {' '}
                          ({num(r.whatsapp, lang)}/{num(a.count, lang)})
                        </span>
                      )}
                    </button>
                  ) : (
                    <button className="an-lime-button" onClick={() => onAct(a)}>
                      {pick(t.cta, lang)}
                    </button>
                  )}
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

type ReadyItem = {
  id: string;
  title: string;
  caption: string;
  gate:
    | { status: 'ready' }
    | { status: 'not_enough_data'; have: number; need: number }
    | { status: 'locked' };
  body: () => ReactNode;
};

/** Sections with enough data render as cards two per row. The rest wait together in one short
 *  list with how close each one is, instead of a page of cards that all say "not yet". */
function ReadySections({ sections, lang }: { sections: ReadyItem[]; lang: Language }) {
  const ready = sections.filter((s) => s.gate.status === 'ready');
  const waiting = sections.filter((s) => s.gate.status !== 'ready');
  const rows: ReadyItem[][] = [];
  for (let i = 0; i < ready.length; i += 2) rows.push(ready.slice(i, i + 2));
  return (
    <>
      {rows.map((row) => (
        <div className="an-row" key={row.map((s) => s.id).join()}>
          {row.map((s) => (
            <Section key={s.id} id={s.id} className="an-grow" title={s.title} caption={s.caption}>
              {s.body()}
            </Section>
          ))}
        </div>
      ))}
      {waiting.length > 0 && (
        <Section
          id="an-waiting"
          title={pick(copy.waitingTitle, lang)}
          caption={pick(copy.waitingCaption, lang)}
        >
          <ul className="an-waiting">
            {waiting.map((s) => {
              const g = s.gate;
              const share = g.status === 'not_enough_data' ? Math.min(1, g.have / g.need) : 0;
              return (
                <li key={s.id}>
                  <div>
                    <strong>{s.title}</strong>
                    <small>{s.caption}</small>
                  </div>
                  {g.status === 'not_enough_data' ? (
                    <span className="an-waiting-meter">
                      <span className="an-num">
                        <bdi dir="ltr">
                          {num(g.have, lang)}/{num(g.need, lang)}
                        </bdi>
                      </span>
                      <span className="an-waiting-track" aria-hidden="true">
                        <span style={{ inlineSize: Math.round(share * 100) + '%' }} />
                      </span>
                    </span>
                  ) : (
                    <span className="an-pill">{pick(copy.lockedShort, lang)}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </>
  );
}
