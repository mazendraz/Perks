import { portalAssetUrl } from '../portals.js';
import { merchantStatusLabel } from '../business-labels.js';
import { Select } from '../controls/Select.js';
import { useEffect, useState } from 'react';
import { navigate } from '../useRoute.js';
import type { CardData, Language } from '../../../../packages/contracts/src/index.js';
import { LoyaltyCard } from '../../../../packages/ui/src/LoyaltyCard.js';
import { api, errorText } from '../api.js';
import { WhatsAppDraft } from './CustomerOutreach.js';
import type { SecurityAccount } from './AccountSecurity.js';
interface Snapshot {
  merchant: {
    id: string;
    slug: string;
    name: string;
    status: string;
    terms: string;
    contact_email: string;
    contact_phone: string;
    logo_asset_id: string | null;
  } & Pick<
    CardData,
    | 'logo_size'
    | 'logo_style'
    | 'template'
    | 'primary_color'
    | 'accent_color'
    | 'surface_color'
    | 'stamp_shape'
    | 'stamp_icon'
    | 'stamp_style'
  >;
  programs: { id: string; name: string; status: string; threshold: number; reward_title: string }[];
  branches: { id: string; status: string; name: string }[];
  summary: Record<string, number>;
  readiness: {
    codes: number;
    missing_phones: number;
    without_whatsapp_consent: number;
    never_purchased: number;
    whatsapp_ready: number;
  };
  invitations: { id: string; email: string; role: string }[];
}
export function BusinessPreview({
  merchantId,
  lang,
  onClose,
  onOpen,
}: {
  merchantId: string;
  lang: Language;
  onClose: () => void;
  onOpen: (tab: string, programId?: string) => void;
}) {
  const ar = lang === 'ar',
    [data, setData] = useState<Snapshot | null>(null),
    [accounts, setAccounts] = useState<SecurityAccount[]>([]),
    [error, setError] = useState(''),
    [programId, setProgramId] = useState(''),
    [whatsapp, setWhatsapp] = useState(false);
  useEffect(() => {
    void Promise.all([
      api<Snapshot>('/platform/merchants/' + merchantId + '/workspace'),
      api<{ accounts: SecurityAccount[] }>('/merchants/' + merchantId + '/account-security'),
    ])
      .then(([d, a]) => {
        setData(d);
        setAccounts(a.accounts);
      })
      .catch((e) => setError(errorText(e, lang)));
  }, [merchantId]);
  const program =
    data?.programs.find((p) => p.id === programId) ||
    data?.programs.find((p) => p.status === 'active') ||
    data?.programs[0];
  const checks = data
    ? [
        {
          ok: !!data.merchant.logo_asset_id,
          label: ar ? 'لوجو المحل' : 'Business logo',
          tab: 'design',
        },
        {
          ok: data.programs.some((p) => p.status === 'active' && !!p.reward_title),
          label: ar ? 'برنامج ومكافأة' : 'Program and reward',
          tab: 'design',
        },
        {
          ok: data.merchant.terms.trim().length >= 4,
          label: ar ? 'شروط التسجيل' : 'Enrollment terms',
          tab: 'design',
        },
        {
          ok: accounts.some(
            (a) =>
              a.role === 'owner' &&
              a.status === 'active' &&
              a.user_status === 'active' &&
              a.passwordSet,
          ),
          label: ar ? 'حساب المالك جاهز' : 'Owner account ready',
          tab: 'team',
        },
        {
          ok: accounts.some(
            (a) =>
              ['cashier', 'manager'].includes(a.role) &&
              a.status === 'active' &&
              a.user_status === 'active' &&
              a.passwordSet,
          ),
          label: ar ? 'حساب الكاشير جاهز' : 'Cashier account ready',
          tab: 'team',
        },
        {
          ok: data.branches.some((b) => b.status === 'active'),
          label: ar ? 'فرع نشط' : 'Active branch',
          tab: 'team',
        },
        {
          ok: data.readiness.codes > 0,
          label: ar ? 'QR تسجيل العملاء' : 'Customer enrollment QR',
          tab: 'qr',
        },
      ]
    : [];
  const missing = checks.filter((c) => !c.ok),
    card: CardData | null = data
      ? {
          ...data.merchant,
          id: 'platform-business-preview',
          merchant_id: merchantId,
          merchant_name: data.merchant.name,
          alias: ar ? 'معاينة اسم العميل' : 'Customer name preview',
          program_name: program?.name || (ar ? 'البرنامج لسه مش مجهّز' : 'Program not set up'),
          threshold: program?.threshold || 5,
          balance: 0,
          reward_title: program?.reward_title || (ar ? 'حدد المكافأة' : 'Choose a reward'),
          revision: 1,
          logo_url: data.merchant.logo_asset_id
            ? portalAssetUrl(
                '/api/v1/merchants/' + merchantId + '/assets/' + data.merchant.logo_asset_id,
              )
            : undefined,
        }
      : null;
  return (
    <>
      <div className="modal-backdrop">
        <section
          className="dialog business-preview"
          role="dialog"
          aria-modal="true"
          aria-labelledby="business-preview-title"
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">
                {ar ? 'نظرة سريعة على المحل' : 'BUSINESS AT A GLANCE'}
              </span>
              <h2 id="business-preview-title">
                {data?.merchant.name || (ar ? 'معاينة المحل' : 'Business preview')}
              </h2>
              {data && (
                <small className="muted">
                  {merchantStatusLabel(data.merchant.status, lang)} ·{' '}
                  <bdi>{data.merchant.slug}</bdi>
                </small>
              )}
            </div>
            <button type="button" className="secondary small" data-dialog-close onClick={onClose}>
              {ar ? 'إغلاق' : 'Close'}
            </button>
          </div>
          <button
            className="secondary small"
            onClick={() => navigate('/platform/merchants/' + merchantId + '/owner-view')}
          >
            {ar ? 'عرض واجهة المالك' : 'View owner dashboard'}
          </button>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {!data && !error && <p role="status">{ar ? 'بنفتح المعاينة…' : 'Loading preview…'}</p>}
          {data && card && (
            <>
              <div className="preview-layout">
                <div>
                  {data.programs.length > 1 && (
                    <label>
                      {ar ? 'برنامج الكارت' : 'Card program'}
                      <Select
                        aria-label={ar ? 'برنامج الكارت' : 'Card program'}
                        value={program?.id}
                        onChange={(e) => setProgramId(e.target.value)}
                      >
                        {data.programs.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                  )}
                  <button
                    type="button"
                    className="card-preview-button"
                    aria-label={ar ? 'تفاصيل وتعديل الكارت' : 'Card details and edits'}
                    onClick={() => onOpen('design', program?.id)}
                  >
                    <LoyaltyCard card={card} lang={lang} />
                    <span>
                      {ar
                        ? 'اضغط على الكارت لتعديل الهوية والأختام'
                        : 'Select the card to edit branding and stamps'}{' '}
                      ↗
                    </span>
                  </button>
                </div>
                <div>
                  <div className="preview-metrics">
                    {[
                      [data.summary.customers, ar ? 'عميل' : 'Customers'],
                      [
                        accounts.filter((a) => a.status === 'active' && a.user_status === 'active')
                          .length,
                        ar ? 'حساب فريق نشط' : 'Active team',
                      ],
                      [missing.length, ar ? 'خطوة تجهيز متبقية' : 'Setup items left'],
                      [data.readiness.whatsapp_ready, ar ? 'جاهزين لواتساب' : 'Ready for WhatsApp'],
                    ].map(([value, label]) => (
                      <div key={label}>
                        <strong>{value}</strong>
                        <small>{label}</small>
                      </div>
                    ))}
                  </div>
                  <h3>
                    {missing.length
                      ? ar
                        ? 'كمّل التجهيز'
                        : 'Finish setup'
                      : ar
                        ? 'الأساسيات جاهزة'
                        : 'Essentials ready'}
                  </h3>
                  <div className="readiness-list">
                    {checks.map((c) => (
                      <button
                        type="button"
                        key={c.label}
                        className={c.ok ? 'ready' : 'incomplete'}
                        onClick={() => onOpen(c.tab)}
                      >
                        <span>
                          {c.ok ? '✓' : '○'} {c.label}
                        </span>
                        <small>
                          {c.ok ? (ar ? 'جاهز' : 'Ready') : ar ? 'كمّلها' : 'Complete'} ↗
                        </small>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="preview-sections">
                <section className="subpanel">
                  <div className="section-heading">
                    <h3>{ar ? 'المالك والفريق' : 'Owner and team'}</h3>
                    <button className="text-button" onClick={() => onOpen('team')}>
                      {ar ? 'إدارة الحسابات والباسوردات' : 'Manage accounts and passwords'}
                    </button>
                  </div>
                  {accounts.length ? (
                    accounts.slice(0, 5).map((a) => (
                      <div className="list-row" key={a.id}>
                        <div>
                          <strong>{a.name}</strong>
                          <small>
                            <bdi>{a.email}</bdi>
                          </small>
                        </div>
                        <span className="badge">
                          {a.role} · {a.status}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p>
                      {ar
                        ? 'لسه مفيش حساب مالك مفعّل. افتح الحسابات عشان تجهّزه.'
                        : 'No owner account is active yet. Open Accounts to set it up.'}
                    </p>
                  )}
                  {data.invitations.length > 0 && (
                    <p className="muted">
                      {ar ? 'دعوات لسه معلّقة: ' : 'Pending invitations: '}
                      {data.invitations.length}
                    </p>
                  )}
                </section>
                <section className="subpanel">
                  <h3>{ar ? 'العملاء والمتابعة' : 'Customers and follow-up'}</h3>
                  <p>
                    {data.readiness.never_purchased}{' '}
                    {ar ? 'عميل لسه من غير شراء' : 'customers have not purchased yet'}
                  </p>
                  <p>
                    {data.summary.open_rewards} {ar ? 'مكافأة جاهزة' : 'rewards available'}
                  </p>
                  <p>
                    {data.readiness.missing_phones}{' '}
                    {ar ? 'عميل بدون رقم واتساب' : 'customers without a WhatsApp number'}
                  </p>
                  <p>
                    {data.readiness.without_whatsapp_consent}{' '}
                    {ar ? 'عميل بدون موافقة واتساب' : 'customers have not opted into WhatsApp'}
                  </p>
                  <button className="secondary small" onClick={() => onOpen('customers')}>
                    {ar ? 'افتح العملاء والتواصل' : 'Open customers and contact'}
                  </button>
                </section>
              </div>
              <div className="preview-footer">
                <div>
                  <strong>{ar ? 'متابعة صاحب المحل' : 'Follow up with the owner'}</strong>
                  <p className="muted">
                    {data.merchant.contact_phone ? (
                      <bdi>{data.merchant.contact_phone}</bdi>
                    ) : ar ? (
                      'رقم واتساب المحل مش مضاف. أضفه من الكارت والهوية.'
                    ) : (
                      'The business WhatsApp number is missing. Add it in Card and branding.'
                    )}
                  </p>
                </div>
                <div className="form-actions">
                  <button
                    className="secondary"
                    disabled={!data.merchant.contact_phone}
                    onClick={() => setWhatsapp(true)}
                  >
                    {ar ? 'رسالة واتساب لصاحب المحل' : 'WhatsApp the owner'}
                  </button>
                  <button className="primary" onClick={() => onOpen('overview')}>
                    {ar ? 'فتح ملف المحل' : 'Open workspace'}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
      {whatsapp && data && (
        <WhatsAppDraft
          merchantId={merchantId}
          lang={lang}
          recipient={{
            name: data.merchant.name,
            business: true,
            missing: missing.map((c) => c.label),
          }}
          onClose={() => setWhatsapp(false)}
        />
      )}
    </>
  );
}
