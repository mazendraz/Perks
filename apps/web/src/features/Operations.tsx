import { useEffect, useState, type FormEvent } from 'react';
import { statusLabel } from '../business-labels.js';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
import { Support } from './Support.js';
interface Job {
  id: string;
  merchant_name: string;
  kind: string;
  status: string;
  attempts: number;
  last_error: string;
  attempt_log: { id: string; outcome: string; error_code: string; started_at: string }[];
}
interface Health {
  at: string;
  merchants: number;
  branches: number;
  staff: number;
  memberships: number;
  transactions: number;
  balanceDrift: number;
  oldestPendingSeconds: number | null;
  jobs: Record<string, number>;
  merchantsHealth: {
    id: string;
    name: string;
    status: string;
    memberships: number;
    attention_jobs: number;
  }[];
}
interface Piece {
  id: string;
  merchant_id: string;
  label: string;
  branch_name: string;
  merchant_name: string;
  status: string;
  revision: number;
}
export function Operations({ lang, admin }: { lang: Language; admin: boolean }) {
  const ar = lang === 'ar',
    [tab, setTab] = useState('health'),
    [health, setHealth] = useState<Health | null>(null),
    [jobs, setJobs] = useState<Job[]>([]),
    [providers, setProviders] = useState<{ id: string; status: string }[]>([]),
    [audit, setAudit] = useState<
      {
        id: string;
        action: string;
        merchant_id: string;
        target_id: string;
        actor_name?: string;
        actor_email?: string;
        at: string;
      }[]
    >([]),
    [pieces, setPieces] = useState<Piece[]>([]),
    [reference, setReference] = useState(''),
    [trace, setTrace] = useState<Record<string, unknown> | null>(null),
    [error, setError] = useState(''),
    [action, setAction] = useState<{
      kind: 'job' | 'piece';
      job?: Job;
      piece?: Piece;
      status?: string;
    } | null>(null),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      setHealth(await api('/platform/health'));
      setJobs((await api<{ jobs: Job[] }>('/platform/jobs')).jobs);
      setProviders(
        (await api<{ providers: typeof providers }>('/platform/integrations')).providers,
      );
      if (admin) {
        setAudit((await api<{ events: typeof audit }>('/platform/audit')).events);
        setPieces((await api<{ placements: Piece[] }>('/platform/placements')).placements);
      }
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void load();
    const iv = setInterval(() => {
      if (!document.hidden) void load();
    }, 10000);
    return () => clearInterval(iv);
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!action) return;
    setBusy(true);
    try {
      if (action.kind === 'job')
        await api('/platform/jobs/' + action.job!.id + '/retry', {
          method: 'POST',
          key: crypto.randomUUID(),
          body: { reason },
        });
      else
        await api(
          '/merchants/' +
            action.piece!.merchant_id +
            '/placements/' +
            action.piece!.id +
            '/transition',
          {
            method: 'POST',
            key: crypto.randomUUID(),
            revision: action.piece!.revision,
            body: { status: action.status, reason },
          },
        );
      setAction(null);
      await load();
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <h2>{ar ? 'تشغيل المنصة' : 'Platform operations'}</h2>
      <div className="tabbar">
        {[
          ['health', ar ? 'الصحة' : 'Health'],
          ['jobs', ar ? 'المهام' : 'Jobs'],
          ['integrations', ar ? 'التكاملات' : 'Integrations'],
          ['support', ar ? 'الدعم' : 'Support'],
          ...(admin
            ? [
                ['trace', ar ? 'تتبع عملية' : 'Trace operation'],
                ['audit', ar ? 'سجل المراجعة' : 'Audit'],
                ['materials', ar ? 'تجهيز القطع' : 'Fulfillment'],
              ]
            : []),
        ].map(([k, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k!)}>
            {l}
          </button>
        ))}
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {tab === 'health' && health && (
        <>
          <div className="kpi-grid">
            {(
              [
                'merchants',
                'branches',
                'staff',
                'memberships',
                'transactions',
                'balanceDrift',
              ] as const
            ).map((k) => (
              <div className="kpi" key={k}>
                <small>
                  {
                    {
                      merchants: ar ? 'التجار' : 'Merchants',
                      branches: ar ? 'الفروع' : 'Branches',
                      staff: ar ? 'الفريق النشط' : 'Active staff',
                      memberships: ar ? 'العضويات' : 'Memberships',
                      transactions: ar ? 'العمليات' : 'Transactions',
                      balanceDrift: ar ? 'أرصدة غير مطابقة للسجل' : 'Balance drift',
                    }[k]
                  }
                </small>
                <strong>{health[k]}</strong>
              </div>
            ))}
          </div>
          <p className="muted">
            {new Date(health.at).toLocaleString(lang)} ·
            {ar ? 'عمر أقدم مهمة معلقة: ' : 'Oldest pending job: '}
            {Math.round(health.oldestPendingSeconds || 0)}s
          </p>
          <section className="panel">
            {health.merchantsHealth.map((m) => (
              <div className="list-row" key={m.id}>
                <div>
                  <strong>{m.name}</strong>
                  <small>
                    {statusLabel(m.status, lang)} · {m.memberships} {ar ? 'عضوية' : 'memberships'}
                  </small>
                </div>
                <span>
                  {m.attention_jobs} {ar ? 'مهمة للمراجعة' : 'jobs need attention'}
                </span>
              </div>
            ))}
          </section>
        </>
      )}
      {tab === 'jobs' && (
        <section className="panel">
          {jobs.map((j) => (
            <details className="subpanel" key={j.id}>
              <summary>
                {j.merchant_name} · {j.kind} · {statusLabel(j.status, lang)} · {j.attempts}
              </summary>
              <p>{j.last_error || '—'}</p>
              <small>
                <bdi>{j.id}</bdi>
              </small>
              {j.attempt_log.map((a) => (
                <div className="list-row" key={a.id}>
                  <span>
                    {a.outcome} ·{a.error_code}
                  </span>
                  <small>{new Date(a.started_at).toLocaleString(lang)}</small>
                </div>
              ))}
              {admin && j.status === 'failed' && j.attempts < 5 && (
                <button
                  className="secondary"
                  onClick={() => {
                    setAction({ kind: 'job', job: j });
                    setReason('');
                  }}
                >
                  {ar ? 'إعادة محاولة متتبعة' : 'Retry with audit'}
                </button>
              )}
              {['blocked', 'unknown'].includes(j.status) && (
                <p className="muted">
                  {ar
                    ? 'المهمة محتاجة حل المتطلب أو تسوية نتيجة المزود قبل الإعادة.'
                    : 'Resolve the dependency or reconcile the provider outcome before retrying.'}
                </p>
              )}
            </details>
          ))}
        </section>
      )}
      {tab === 'integrations' && (
        <section className="panel">
          {providers.map((p) => (
            <div className="list-row" key={p.id}>
              <strong>{p.id}</strong>
              <span className="badge">{statusLabel(p.status, lang)}</span>
            </div>
          ))}
        </section>
      )}
      {tab === 'support' && <Support lang={lang} />}{' '}
      {tab === 'trace' && (
        <section className="panel">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void api<Record<string, unknown>>(
                '/platform/operations/' + encodeURIComponent(reference),
              )
                .then(setTrace)
                .catch((e) => setError(errorText(e, lang)));
            }}
          >
            <label>
              {ar ? 'رقم العملية أو الإيصال' : 'Transaction or receipt reference'}
              <input
                required
                dir="ltr"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
            <button className="primary">{ar ? 'بحث' : 'Find operation'}</button>
          </form>
          {trace && (
            <pre className="operation-json" dir="ltr">
              {JSON.stringify(trace, null, 2)}
            </pre>
          )}
        </section>
      )}
      {tab === 'audit' && (
        <section className="panel">
          {audit.map((e) => (
            <div className="list-row" key={e.id}>
              <div>
                <strong>{e.action}</strong>
                <small>{e.actor_name || e.actor_email || (ar ? 'النظام' : 'System')}</small>
                <small>
                  <bdi>{e.target_id}</bdi>
                </small>
              </div>
              <small>{new Date(e.at).toLocaleString(lang)}</small>
            </div>
          ))}
        </section>
      )}
      {tab === 'materials' && (
        <section className="panel">
          {pieces.map((p) => (
            <div className="list-row" key={p.id}>
              <div>
                <strong>
                  {p.label} ·{p.merchant_name}
                </strong>
                <small>
                  {p.branch_name} · {statusLabel(p.status, lang)}
                </small>
              </div>
              {['requested', 'ready'].includes(p.status) && (
                <button
                  className="secondary small"
                  onClick={() => {
                    setAction({
                      kind: 'piece',
                      piece: p,
                      status: p.status === 'requested' ? 'ready' : 'shipped',
                    });
                    setReason('');
                  }}
                >
                  {p.status === 'requested'
                    ? ar
                      ? 'تسجيل التجهيز'
                      : 'Record production'
                    : ar
                      ? 'تسجيل الشحن'
                      : 'Record shipment'}
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {action && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ops-action"
            onSubmit={(e) => void submit(e)}
          >
            <h2 id="ops-action">{ar ? 'تفاصيل الإجراء' : 'Action details'}</h2>
            <label>
              {ar ? 'السبب أو تفاصيل التنفيذ' : 'Reason or execution notes'}
              <textarea
                autoFocus
                required
                minLength={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                onClick={() => setAction(null)}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button className="primary" disabled={busy}>
                {ar ? 'تأكيد' : 'Confirm'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
