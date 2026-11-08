import { MerchantCardDesigner } from './MerchantCardDesigner.js';
import { navigate } from '../useRoute.js';
import { CustomerOutreach } from './CustomerOutreach.js';
import { AccountSecurity } from './AccountSecurity.js';
import { PlatformAccountForm, type AccountSeed } from './PlatformAccountForm.js';
import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
import { Support } from './Support.js';
import { EnrollmentCodes } from './EnrollmentCodes.js';
interface Workspace {
  merchant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    plan: string;
    max_staff: number;
    max_branches: number;
    max_customers: number;
  };
  summary: Record<string, number>;
  invitations: ({ id: string } & AccountSeed)[];
  branches: { id: string; name: string; address: string; status: string }[];
  staff: { id: string; email: string; role: string; status: string; branches: string[] }[];
  transactions: {
    public_reference: string;
    type: string;
    quantity: number;
    at: string;
    branch_name: string;
  }[];
  jobs: { id: string; kind: string; status: string; attempts: number; last_error: string | null }[];
  events: {
    id: string;
    action: string;
    at: string;
    actor_name?: string;
    actor_email?: string;
    target_id: string;
  }[];
  checkedAt: string;
}
export function MerchantWorkspace({
  merchantId,
  lang,
  onBack,
  initialTab = 'overview',
  initialProgramId = '',
}: {
  merchantId: string;
  lang: Language;
  onBack: () => void;
  initialTab?: string;
  initialProgramId?: string;
}) {
  const [account, setAccount] = useState<{ seed?: AccountSeed } | null>(null);
  const ar = lang === 'ar',
    [data, setData] = useState<Workspace | null>(null),
    [error, setError] = useState(''),
    [tab, setTab] = useState(initialTab),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState<string | null>(null),
    [reason, setReason] = useState('');
  const load = async () => {
    setBusy(true);
    try {
      setData(await api<Workspace>('/platform/merchants/' + merchantId + '/workspace'));
      setError('');
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, [merchantId]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{ar ? 'ملف المحل' : 'BUSINESS WORKSPACE'}</span>
          <h1>{data?.merchant.name || (ar ? 'متابعة المحل' : 'Business operations')}</h1>
          <p className="muted">
            {data?.merchant.status} · {data?.merchant.plan} · <bdi>{data?.merchant.slug}</bdi>
          </p>
        </div>
        <div className="form-actions">
          <button
            className="primary"
            onClick={() => navigate('/platform/merchants/' + merchantId + '/owner-view')}
          >
            {ar ? 'عرض واجهة المالك' : 'View owner dashboard'}
          </button>
          <button className="secondary" onClick={onBack}>
            {ar ? 'كل المحلات' : 'All businesses'}
          </button>
          <button className="secondary" disabled={busy} onClick={() => void load()}>
            {ar ? 'تحديث' : 'Refresh'}
          </button>
        </div>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <nav
        className="tabbar workspace-tabs"
        aria-label={ar ? 'أقسام ملف المحل' : 'Business workspace sections'}
      >
        {(
          [
            ['overview', 'نظرة عامة', 'Overview'],
            ['design', 'الكارت والهوية', 'Card and branding'],
            ['customers', 'العملاء وواتساب', 'Customers and WhatsApp'],
            ['team', 'الفروع والحسابات', 'Branches and accounts'],
            ['qr', 'أكواد QR', 'QR codes'],
            ['support', 'الدعم والمشاكل', 'Support and issues'],
            ['activity', 'التشغيل والسجل', 'Operations and history'],
          ] as const
        ).map(([key, arabic, english]) => (
          <button
            key={key}
            className={tab === key ? 'active' : ''}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {ar ? arabic : english}
          </button>
        ))}
      </nav>
      {data && tab === 'overview' && (
        <>
          <div className="kpi-grid">
            {(
              [
                ['customers', 'العملاء', 'Customers'],
                ['transactions', 'العمليات', 'Transactions'],
                ['stamps', 'الأختام', 'Stamps'],
                ['open_rewards', 'مكافآت جاهزة', 'Available rewards'],
                ['redeemed_rewards', 'مكافآت اتصرفت', 'Redeemed rewards'],
                ['open_tickets', 'مشاكل مفتوحة', 'Open tickets'],
                ['attention_jobs', 'مهام محتاجة مراجعة', 'Jobs needing attention'],
                ['balance_drift', 'فروق الأرصدة', 'Balance discrepancies'],
              ] as const
            ).map(([key, a, e]) => (
              <div className="kpi" key={key}>
                <small>{ar ? a : e}</small>
                <strong>{data.summary[key]}</strong>
              </div>
            ))}
          </div>
          <section className="panel">
            <h2>{ar ? 'لو المحل عنده مشكلة' : 'When a business needs help'}</h2>
            <ol className="support-playbook">
              <li>
                {ar
                  ? 'افتح الدعم وسجّل وصف المشكلة ورقم العملية أو اسم الفرع.'
                  : 'Open Support and record the issue, transaction reference and branch.'}
              </li>
              <li>
                {ar
                  ? 'راجع التشغيل والسجل وحالة الحسابات أو كود الفرع.'
                  : 'Review Operations, account status and the branch QR.'}
              </li>
              <li>
                {ar
                  ? 'رد على صاحب المحل من نفس التذكرة، وحدّثها بعد الحل.'
                  : 'Reply to the owner in the same ticket and update its status after resolution.'}
              </li>
            </ol>
            <p className="muted">
              {ar
                ? 'تصحيحات الأختام بتتم بطلب تصحيح واعتماد داخل حساب المحل. كل إجراء له سجل.'
                : 'Stamp adjustments use correction requests and approval within the business account. Actions are recorded.'}
            </p>
            <button className="primary" onClick={() => setTab('support')}>
              {ar ? 'فتح الدعم' : 'Open support'}
            </button>
          </section>
        </>
      )}
      {account && data && (
        <PlatformAccountForm
          merchantId={merchantId}
          branches={data.branches}
          lang={lang}
          seed={account.seed}
          onClose={() => setAccount(null)}
          onCreated={load}
        />
      )}
      {data && tab === 'team' && (
        <>
          <section className="panel">
            <h2>
              {ar ? 'الفروع' : 'Branches'} · {data.branches.length}/{data.merchant.max_branches}
            </h2>
            {data.branches.map((b) => (
              <div className="list-row" key={b.id}>
                <div>
                  <strong>{b.name}</strong>
                  <p>{b.address}</p>
                </div>
                <span className="badge">{b.status}</span>
              </div>
            ))}
          </section>
          <section className="panel">
            <button className="primary" onClick={() => setAccount({})}>
              {ar ? 'إضافة حساب بإيميل وباسورد' : 'Add email and password account'}
            </button>
            <h2>
              {ar ? 'حسابات الفريق' : 'Team accounts'} · {data.staff.length}/
              {data.merchant.max_staff}
            </h2>
            {data.invitations?.map((i) => (
              <div className="list-row" key={i.id}>
                <div>
                  <bdi>{i.email}</bdi>
                  <small>
                    {i.role} · {ar ? 'دعوة معلّقة' : 'Pending invitation'}
                  </small>
                </div>
                <button className="secondary small" onClick={() => setAccount({ seed: i })}>
                  {ar ? 'إنشاء حساب بدل الدعوة' : 'Create account instead'}
                </button>
              </div>
            ))}
            <AccountSecurity
              merchantId={merchantId}
              lang={lang}
              branches={data.branches}
              refreshKey={data.checkedAt}
              onChanged={load}
            />
            <p className="muted">
              {ar
                ? 'صاحب المحل يضيف الحسابات ويوقفها من صفحة الفريق. استعادة الباسورد من صفحة الدخول.'
                : 'The owner creates or disables accounts from Team. Password recovery is on the sign-in page.'}
            </p>
          </section>
        </>
      )}
      {tab === 'design' && (
        <MerchantCardDesigner
          initialProgramId={initialProgramId}
          merchantId={merchantId}
          lang={lang}
          onChanged={load}
        />
      )}
      {tab === 'customers' && <CustomerOutreach merchantId={merchantId} lang={lang} />}
      {tab === 'qr' && <EnrollmentCodes merchantId={merchantId} lang={lang} />}
      {tab === 'support' && <Support merchantId={merchantId} lang={lang} />}
      {data && tab === 'activity' && (
        <>
          <section className="panel">
            <h2>{ar ? 'مهام التشغيل' : 'Background jobs'}</h2>
            <p className="muted">
              {ar
                ? 'المهام المتوقفة بسبب خدمة غير مفعّلة محتاجة إعداد الخدمة. إعادة المحاولة متاحة للمهام الآمنة الفاشلة فقط.'
                : 'Jobs blocked by an unconfigured service need that service configured. Retry is available for safe failed jobs only.'}
            </p>
            {!data.jobs.length && <p>{ar ? 'مفيش مهام لسه.' : 'No jobs yet.'}</p>}
            {data.jobs.map((j) => (
              <div className="subpanel" key={j.id}>
                <div className="section-heading">
                  <strong>{j.kind}</strong>
                  <span className="badge">
                    {j.status} · {j.attempts}
                  </span>
                </div>
                <small>
                  <bdi>{j.id}</bdi>
                </small>
                {j.last_error && <p>{j.last_error}</p>}
                {j.status === 'failed' &&
                  j.attempts < 5 &&
                  ['domain_event', 'customer_export', 'invitation_email'].includes(j.kind) && (
                    <button
                      className="secondary small"
                      onClick={() => {
                        setRetry(j.id);
                        setReason('');
                      }}
                    >
                      {ar ? 'مراجعة وإعادة محاولة' : 'Review and retry'}
                    </button>
                  )}
              </div>
            ))}
          </section>
          <section className="panel">
            <h2>{ar ? 'آخر العمليات' : 'Recent transactions'}</h2>
            {data.transactions.map((t) => (
              <div className="list-row" key={t.public_reference}>
                <div>
                  <bdi>{t.public_reference}</bdi>
                  <small>
                    {t.branch_name} · {new Date(t.at).toLocaleString(lang)}
                  </small>
                </div>
                <span>
                  {t.type} · {t.quantity}
                </span>
              </div>
            ))}
          </section>
          <section className="panel">
            <h2>{ar ? 'سجل الإجراءات' : 'Audit history'}</h2>
            {data.events.map((e) => (
              <div className="list-row" key={e.id}>
                <span>{e.action}</span>
                <small>{new Date(e.at).toLocaleString(lang)}</small>
              </div>
            ))}
          </section>
        </>
      )}
      {retry && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="retry-job-title"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              void api('/platform/jobs/' + retry + '/retry', {
                method: 'POST',
                key: crypto.randomUUID(),
                body: { reason },
              })
                .then(() => {
                  setRetry(null);
                  return load();
                })
                .catch((e) => setError(errorText(e, lang)))
                .finally(() => setBusy(false));
            }}
          >
            <h2 id="retry-job-title">{ar ? 'إعادة محاولة المهمة' : 'Retry job'}</h2>
            <label>
              {ar ? 'سبب إعادة المحاولة' : 'Reason for retry'}
              <textarea
                required
                minLength={4}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                onClick={() => setRetry(null)}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button className="primary" disabled={busy}>
                {ar ? 'إعادة المحاولة' : 'Retry'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
