import { WhyDisabled } from '../controls/WhyDisabled.js';
import { PhoneInput } from '../controls/PhoneInput.js';
import { staffRoleLabel, statusLabel, transactionTypeLabel } from '../business-labels.js';
import { portalAssetUrl } from '../portals.js';
import { saveLogo } from '../controls/save-logo.js';
import { FileUpload } from '../controls/FileUpload.js';
import { Select } from '../controls/Select.js';
import { PasswordField } from '../controls/PasswordField.js';
import { CustomerOutreach } from './CustomerOutreach.js';
import { Subscriptions } from './Subscriptions.js';
import { MyPlan, PlanBanners, type PlanState } from './MyPlan.js';
import { WalletMessages } from './WalletMessages.js';
import { LimitSheet } from './LimitSheet.js';
import { InstallAppButton } from './InstallCard.js';
import { LockedBadge } from './LockedBadge.js';
import { TeamCustomerRecovery, RecoveryPolicy, PairingApprovals } from './CustomerRecovery.js';
import { AccountSecurity } from './AccountSecurity.js';
import {
  ColorField,
  PalettePaste,
  TemplatePicker,
  StampControls,
  LogoStyleControl,
  LogoMarkControl,
} from './BrandControls.js';
import {
  type LogoMarkPosition,
  suggestedStamps,
  type StampShape,
  type StampIcon,
  type StampStyle,
  type CardTemplate,
  type LogoStyle,
} from '../../../../packages/contracts/src/branding.js';
import { ActionLabel, Icon } from '../../../../packages/ui/src/Icon.js';
import { PurchaseTrend, type TrendData } from './PurchaseTrend.js';
import { Branches } from './Branches.js';
import { Support } from './Support.js';
import { Materials } from './Materials.js';
import { RequestSettings } from './RequestSettings.js';
import { ExperienceStats } from './ExperienceStats.js';
import { Customers } from './Customers.js';
import { lazy, Suspense, useEffect, useState, type FormEvent, type CSSProperties } from 'react';
import type { Grant, Language, CardData } from '../../../../packages/contracts/src/index.js';
import { LoyaltyCard } from '../../../../packages/ui/src/LoyaltyCard.js';
import { api, errorText } from '../api.js';
import { EmailTypoHint } from './EmailTypoHint.js';
import { intlLocale } from '../locale.js';
import { useUrlTab } from '../url-tab.js';
import { StaffActivity } from './StaffActivity.js';
import { OwnerToday } from './TodayStrip.js';
import { SetupChecklist } from './SetupChecklist.js';
import { ErrorBoundary } from '../ErrorBoundary.js';
// The analytics page is the owner's first screen but heavy; it loads on its own.
const AnalyticsPage = lazy(() =>
  import('./analytics/AnalyticsPage.js').then((m) => ({ default: m.AnalyticsPage })),
);
interface Merchant {
  id: string;
  name: string;
  slug: string;
  status: string;
  revision: number;
  primary_color: string;
  accent_color: string;
  surface_color: string;
  template: CardTemplate;
  stamp_shape: StampShape;
  stamp_icon: StampIcon;
  stamp_style: StampStyle;
  terms: string;
  logo_asset_id: string | null;
  logo_style: LogoStyle;
  logo_size: number;
  logo_mark_position: LogoMarkPosition;
  logo_mark_bleed: number;
  contact_email: string;
  contact_phone: string;
}
interface Program {
  branch_ids: string[];
  id: string;
  name: string;
  status: string;
  version: number;
  threshold: number;
  max_per_tx: number;
  reward_title: string;
  reward_terms: string;
  validity_days: number;
  ends_at: string | null;
  locked_at?: string | null;
}
interface Staff {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'manager' | 'cashier';
  status: 'active' | 'disabled';
  max_qty: number;
  revision: number;
  branch_ids: string[];
}
interface Correction {
  id: string;
  alias: string;
  reason: string;
  requested_delta: number;
  status: string;
  public_reference: string;
  decision_reason: string | null;
}
interface Metrics {
  registered: number;
  active: number;
  inactive: number;
  neverActive: number;
  newSignups: number;
  stamps: number;
  visits: number;
  rewardsOpen: number;
  rewardsRedeemed: number;
  corrections: number;
  purchasingCustomers: number;
  returningCustomers: number;
  returnRate: number;
}
const ownerTabs = [
  'overview',
  'customers',
  'outreach',
  'messages',
  'brand',
  'programs',
  'materials',
  'team',
  'branches',
  'subscription',
  'operations',
  'support',
] as const;
export function MerchantPage({ grant, lang }: { grant: Grant; lang: Language }) {
  const [showAllMetrics, setShowAllMetrics] = useState(false);
  // The detailed numbers are folded away under analytics; they load only while unfolded.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [brandProgramId, setBrandProgramId] = useState(''),
    [previewThreshold, setPreviewThreshold] = useState<number | null>(null);
  const ar = lang === 'ar',
    [tab, setTab] = useUrlTab('overview', ownerTabs),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [merchant, setMerchant] = useState<Merchant | null>(null),
    [brand, setBrand] = useState<Merchant | null>(null),
    [programs, setPrograms] = useState<Program[]>([]),
    [staff, setStaff] = useState<Staff[]>([]),
    [invitations, setInvitations] = useState<
      {
        id: string;
        email: string;
        role: string;
        status: string;
        revision: number;
        branch_ids: string[];
      }[]
    >([]),
    [corrections, setCorrections] = useState<Correction[]>([]),
    [days, setDays] = useState(30),
    [branch, setBranch] = useState(''),
    [overview, setOverview] = useState<{
      metrics: Metrics;
      branches: { id: string; name: string; visits: number; stamps: number; redeemed: number }[];
      updatedAt: string;
      customerScope: string;
      trend: TrendData['trend'];
      period: TrendData['period'];
    } | null>(null),
    [recent, setRecent] = useState<
      {
        id: string;
        public_reference: string;
        type: string;
        quantity: number;
        alias: string;
        branch_name: string;
        at: string;
        source?: string;
        staff_name?: string | null;
      }[]
    >([]),
    [invite, setInvite] = useState<{
      email: string;
      password: string;
      existing: boolean;
      role: 'manager' | 'cashier';
      branchIds: string[];
      maxQty: number;
    } | null>(null),
    [decision, setDecision] = useState<{
      correction: Correction;
      approve: boolean;
      reason: string;
    } | null>(null),
    [editProgram, setEditProgram] = useState<Program | null>(null),
    [programKey, setProgramKey] = useState(''),
    [earningAction, setEarningAction] = useState<{
      program: Program;
      enabled: boolean;
      reason: string;
      key: string;
    } | null>(null),
    [programBranches, setProgramBranches] = useState<string[]>([]),
    [planState, setPlanState] = useState<PlanState | null>(null);
  const base = '/merchants/' + grant.merchant_id;
  const owner = grant.role === 'owner';
  const loadPlan = () => {
    if (owner)
      api<PlanState>(base + '/plan')
        .then(setPlanState)
        .catch(() => setPlanState(null));
  };
  useEffect(loadPlan, [grant.merchant_id, owner]);
  const load = async () => {
    try {
      const [m, p, t, cs] = await Promise.all([
        api<{ merchant: Merchant }>(base),
        api<{ programs: Program[] }>(base + '/programs'),
        api<{ transactions: typeof recent }>(base + '/transactions'),
        api<{ corrections: Correction[] }>(base + '/corrections'),
      ]);
      setMerchant(m.merchant);
      setBrand((b) => b || m.merchant);
      setPrograms(p.programs);
      setRecent(t.transactions);
      setCorrections(cs.corrections);
      if (grant.role === 'owner') {
        const s = await api<{ staff: Staff[]; invitations: typeof invitations }>(base + '/staff');
        setStaff(s.staff);
        setInvitations(s.invitations);
      }
      setError('');
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  const loadMetrics = async () => {
    try {
      setOverview(
        await api(base + '/overview?days=' + days + (branch ? '&branchId=' + branch : '')),
      );
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void load();
  }, [grant.id]);
  const metricsShown = tab === 'overview' && detailsOpen;
  useEffect(() => {
    if (metricsShown) void loadMetrics();
    const iv = setInterval(() => {
      if (!document.hidden) {
        if (metricsShown) void loadMetrics();
        void load();
      }
    }, 6000);
    return () => clearInterval(iv);
  }, [grant.id, days, branch, metricsShown]);
  const saveBrand = async (e: FormEvent) => {
    e.preventDefault();
    if (!brand || !merchant) return;
    setBusy(true);
    try {
      const r = await api<{ merchant: Merchant }>(base + '/branding', {
        method: 'PATCH',
        revision: merchant.revision,
        body: {
          name: brand.name,
          primaryColor: brand.primary_color,
          accentColor: brand.accent_color,
          surfaceColor: brand.surface_color,
          template: brand.template,
          stampShape: brand.stamp_shape,
          stampIcon: brand.stamp_icon,
          stampStyle: brand.stamp_style,
          terms: brand.terms,
          logoAssetId: brand.logo_asset_id,
          logoStyle: brand.logo_style,
          logoSize: brand.logo_size,
          logoMarkPosition: brand.logo_mark_position,
          logoMarkBleed: brand.logo_mark_bleed,
          contactEmail: brand.contact_email || undefined,
          contactPhone: brand.contact_phone,
        },
      });
      setMerchant(r.merchant);
      setBrand(r.merchant);
      setNotice(ar ? 'الهوية اتنشرت.' : 'Branding published.');
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  const uploadLogo = async (file?: File) => {
    if (!file) return;
    if (file.size > 2_000_000) {
      setError(ar ? 'الصورة لازم تكون أصغر من 2 ميجابايت.' : 'The image must be smaller than 2MB.');
      return;
    }
    setBusy(true);
    try {
      if (!merchant) return;
      const r = await saveLogo<Merchant>(grant.merchant_id, file, merchant.revision);
      setMerchant(r.merchant);
      setBrand((b) =>
        b ? { ...b, logo_asset_id: r.asset.id, revision: r.merchant.revision } : r.merchant,
      );
      setNotice(
        ar
          ? 'اللوجو اتحفظ وظهر على الكارت. احفظ باقي تعديلات التصميم لما تخلص.'
          : 'Logo saved to your card. Save any other design changes when you are ready.',
      );
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  const sendInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!invite) return;
    setBusy(true);
    try {
      await api(base + '/invitations', {
        method: 'POST',
        key: crypto.randomUUID(),
        body: {
          email: invite.email,
          role: invite.role,
          branchIds: invite.branchIds,
          maxQty: invite.maxQty,
          ...(!invite.existing ? { password: invite.password } : {}),
        },
      });
      setInvite(null);
      setNotice(
        invite.existing
          ? ar
            ? 'اتجهزت الدعوة. الإرسال حسب قناة البريد المفعّلة.'
            : 'Invitation prepared. Delivery follows the configured email channel.'
          : ar
            ? 'الحساب اتعمل. الموظف يقدر يدخل بالإيميل والباسورد.'
            : 'Account created. Staff can now sign in with email and password.',
      );
      await load();
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  const correctionDecision = async (e: FormEvent) => {
    e.preventDefault();
    if (!decision) return;
    setBusy(true);
    try {
      const r = await api<{ status: string; reason?: string }>(
        base + '/corrections/' + decision.correction.id + '/decision',
        {
          method: 'POST',
          key: crypto.randomUUID(),
          body: { approve: decision.approve, reason: decision.reason },
        },
      );
      setDecision(null);
      setNotice(
        r.status === 'needs_review'
          ? ar
            ? 'الطلب محتاج مراجعة خاصة؛ مفيش رصيد اتغير.'
            : 'Manual review required. No balance changed.'
          : ar
            ? 'اتسجل قرار التصحيح.'
            : 'Correction decision saved.',
      );
      await load();
      await loadMetrics();
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  const publishProgram = async (e: FormEvent) => {
    e.preventDefault();
    if (!editProgram) return;
    setBusy(true);
    try {
      await api(base + '/programs' + (editProgram.id ? '/' + editProgram.id + '/versions' : ''), {
        method: 'POST',
        key: programKey,
        body: {
          name: editProgram.name,
          threshold: editProgram.threshold,
          maxPerTx: editProgram.max_per_tx,
          rewardTitle: editProgram.reward_title,
          rewardTerms: editProgram.reward_terms,
          validityDays: editProgram.validity_days,
          endsAt: editProgram.ends_at,
          branchIds: programBranches,
        },
      });
      const preservedBrand = tab === 'brand' ? brand : null;
      setEditProgram(null);
      await load();
      if (preservedBrand) setBrand(preservedBrand);
      setPreviewThreshold(null);
      setNotice(
        ar
          ? 'نسخة جديدة اتنشرت. الأعضاء الحاليين محتفظين بشروطهم.'
          : 'New version published. Existing members keep their earned rules.',
      );
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  const brandProgram = programs.find((p) => p.id === brandProgramId) || programs[0];
  const preview: CardData | null = brand
    ? {
        id: 'preview',
        merchant_id: grant.merchant_id,
        merchant_name: brand.name,
        alias: ar ? 'سارة م.' : 'Sara M.',
        program_name: brandProgram?.name || '',
        threshold: previewThreshold ?? brandProgram?.threshold ?? 5,
        balance: 3,
        primary_color: brand.primary_color,
        accent_color: brand.accent_color,
        surface_color: brand.surface_color,
        template: brand.template,
        logo_style: brand.logo_style,
        logo_size: brand.logo_size,
        logo_mark_position: brand.logo_mark_position,
        logo_mark_bleed: brand.logo_mark_bleed,
        stamp_shape: brand.stamp_shape,
        stamp_icon: brand.stamp_icon,
        stamp_style: brand.stamp_style,
        logo_url: brand.logo_asset_id
          ? portalAssetUrl(
              '/api/v1/merchants/' + grant.merchant_id + '/assets/' + brand.logo_asset_id,
            )
          : undefined,
        reward_title: brandProgram?.reward_title || '',
        revision: brand.revision,
      }
    : null;
  const tabs = [
    ['overview', ar ? 'الرئيسية' : 'Overview'],
    ['customers', ar ? 'العملاء والشرائح' : 'Customers and segments'],
    ['outreach', ar ? 'تواصل واتساب' : 'WhatsApp contact'],
    ...(grant.role === 'owner' ? [['messages', ar ? 'رسايل Wallet' : 'Wallet messages']] : []),
    ['materials', ar ? 'QR وNFC' : 'QR and NFC'],
    ['programs', ar ? 'البرامج' : 'Programs'],
    ['branches', ar ? 'الفروع' : 'Branches'],
    ...(grant.role === 'owner'
      ? [
          ['team', ar ? 'الفريق' : 'Team'],
          ['brand', ar ? 'الهوية' : 'Branding'],
          ['subscription', ar ? 'باقتي' : 'My plan'],
          ['support', ar ? 'الدعم' : 'Support'],
        ]
      : []),
    ['operations', ar ? 'العمليات' : 'Transactions'],
  ];
  const tabIcons: Record<string, string> = {
    overview: 'chart',
    customers: 'people',
    outreach: 'message',
    messages: 'message',
    materials: 'qr',
    programs: 'gift',
    branches: 'branch',
    team: 'people',
    brand: 'shop',
    subscription: 'receipt',
    support: 'support',
    operations: 'clock',
  };
  const sections = [
    { id: 'overview', label: ar ? 'الرئيسية' : 'Overview', icon: 'chart', tabs: ['overview'] },
    {
      id: 'customers',
      label: ar ? 'العملاء' : 'Customers',
      icon: 'people',
      tabs: ['customers', 'outreach', 'messages'],
    },
    {
      id: 'loyalty',
      label: ar ? 'كارت الولاء' : 'Loyalty card',
      icon: 'cards',
      tabs: ['brand', 'programs', 'materials'],
    },
    {
      id: 'business',
      label: ar ? 'إدارة المحل' : 'Business',
      icon: 'shop',
      tabs: ['branches', 'team', 'subscription'],
    },
    {
      id: 'activity',
      label: ar ? 'المتابعة' : 'Activity',
      icon: 'clock',
      tabs: ['operations', 'support'],
    },
  ]
    .map((s) => ({ ...s, tabs: s.tabs.filter((key) => tabs.some(([k]) => k === key)) }))
    .filter((s) => s.tabs.length);
  const section = sections.find((s) => s.tabs.includes(tab)) || sections[0]!;
  return (
    <div style={{ '--brand': merchant?.primary_color || grant.primary_color } as CSSProperties}>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{ar ? 'لوحة المحل' : 'Business dashboard'}</span>
          <h1>{merchant?.name || grant.name}</h1>
        </div>
        <a
          className="secondary small"
          href={'/join/' + grant.slug}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ActionLabel icon="qr">{ar ? 'افتح التسجيل' : 'Open enrollment'}</ActionLabel>
        </a>
      </div>
      {planState && (
        <PlanBanners
          state={planState}
          lang={lang}
          kind="billing"
          merchantId={grant.merchant_id}
          onOpen={tab === 'subscription' ? undefined : () => setTab('subscription')}
        />
      )}
      <nav className="owner-sections" aria-label={ar ? 'أقسام المحل' : 'Business sections'}>
        {sections.map((s) => (
          <button
            key={s.id}
            className={section.id === s.id ? 'active' : ''}
            aria-pressed={section.id === s.id}
            onClick={() => setTab(s.tabs[0]!)}
          >
            <Icon name={s.icon} size={19} />
            {s.label}
          </button>
        ))}
      </nav>
      {section.tabs.length > 1 && (
        <div className="tabbar owner-subtabs">
          {tabs
            .filter(([k]) => section.tabs.includes(k!))
            .map(([k, l]) => (
              <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k!)}>
                <ActionLabel icon={tabIcons[k!] || 'cards'}>{l}</ActionLabel>
              </button>
            ))}
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice success" role="status">
          {notice}
          <button className="text-button" onClick={() => setNotice('')}>
            {ar ? 'إغلاق' : 'Close'}
          </button>
        </div>
      )}
      <LimitSheet merchantId={grant.merchant_id} lang={lang} owner={owner} onRequested={loadPlan} />
      {tab === 'messages' && owner && <WalletMessages merchantId={grant.merchant_id} lang={lang} />}
      {tab === 'overview' && (
        <>
          {owner && merchant && (
            <SetupChecklist
              lang={lang}
              done={{
                logo: !!merchant.logo_asset_id,
                program: programs.some((p) => p.status === 'active'),
                cashier: staff.some((s) => s.role !== 'owner' && s.status === 'active'),
                stamp: recent.some((t) => t.type === 'award' && t.source !== 'welcome'),
              }}
              go={setTab}
            />
          )}
          {corrections.filter((c) => ['pending', 'needs_review'].includes(c.status)).length > 0 && (
            <section className="panel">
              <h2>{ar ? 'طلبات تصحيح محتاجة مراجعة' : 'Corrections awaiting review'}</h2>
              {corrections
                .filter((c) => ['pending', 'needs_review'].includes(c.status))
                .map((c) => (
                  <div className="list-row" key={c.id}>
                    <div>
                      <strong>
                        {c.alias} ·{c.requested_delta}
                      </strong>
                      <small className="muted">
                        {c.reason} · {statusLabel(c.status, lang)}
                      </small>
                      <small>
                        <bdi>{c.public_reference}</bdi>
                      </small>
                    </div>
                    <div className="form-actions">
                      <button
                        className="secondary small"
                        onClick={() => setDecision({ correction: c, approve: false, reason: '' })}
                      >
                        {ar ? 'رفض' : 'Reject'}
                      </button>
                      <button
                        className="primary small"
                        onClick={() => setDecision({ correction: c, approve: true, reason: '' })}
                      >
                        {ar ? 'مراجعة واعتماد' : 'Review and approve'}
                      </button>
                    </div>
                  </div>
                ))}
            </section>
          )}
          <OwnerToday
            merchantId={grant.merchant_id}
            lang={lang}
            onOpenOperations={() => setTab('operations')}
          />
          {(grant.role === 'owner' || grant.role === 'manager') && (
            <ErrorBoundary inline>
              <Suspense fallback={<div className="an-loading" role="status" aria-busy="true" />}>
                <AnalyticsPage
                  merchantId={grant.merchant_id}
                  lang={lang}
                  role={grant.role}
                  branches={grant.branches}
                />
              </Suspense>
            </ErrorBoundary>
          )}
          <details className="an-details" onToggle={(e) => setDetailsOpen(e.currentTarget.open)}>
            <summary>{ar ? 'أرقام التشغيل التفصيلية' : 'Detailed operating numbers'}</summary>
            <div className="filter-row">
              <label>
                {ar ? 'الفترة' : 'Period'}
                <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  {[7, 30, 90].map((n) => (
                    <option key={n} value={n}>
                      {ar ? 'آخر ' + n + ' يوم' : 'Last ' + n + ' days'}
                    </option>
                  ))}
                </Select>
              </label>
              <label>
                {ar ? 'الفرع' : 'Branch'}
                <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
                  <option value="">{ar ? 'الفروع المصرح بها' : 'Authorized branches'}</option>
                  {grant.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            {overview && (
              <>
                <small className="muted">
                  {ar ? 'آخر تحديث ' : 'Updated '}
                  {new Date(overview.updatedAt).toLocaleTimeString(intlLocale(lang))} ·
                  {ar ? 'النشاط حسب فروعك المسموحة' : 'Activity follows your allowed branches'}
                </small>
                <div className="kpi-grid merchant-metrics">
                  {(
                    [
                      ['registered', ar ? 'العملاء المسجلين' : 'Registered customers'],
                      ['visits', ar ? 'الزيارات' : 'Visits'],
                      ['rewardsOpen', ar ? 'مكافآت متاحة' : 'Open rewards'],
                      ['rewardsRedeemed', ar ? 'مكافآت مستبدلة' : 'Redeemed rewards'],
                      ['active', ar ? 'نشطين آخر 30 يوم' : 'Active in 30 days'],
                      ['inactive', ar ? 'خاملين' : 'Inactive'],
                      ['neverActive', ar ? 'لسه مازاروش' : 'Never active'],
                      ['newSignups', ar ? 'تسجيلات جديدة' : 'New signups'],
                      ['stamps', ar ? 'أختام ممنوحة' : 'Stamps awarded'],
                      [
                        'purchasingCustomers',
                        ar ? 'عملاء اشتروا في الفترة' : 'Purchasing customers',
                      ],
                      [
                        'returningCustomers',
                        ar ? 'عملاء رجعوا من قبل الفترة' : 'Returning customers',
                      ],
                      ['returnRate', ar ? 'نسبة العملاء الراجعين ٪' : 'Returning customer rate %'],
                    ] as const
                  )
                    .filter((_, index) => showAllMetrics || index < 4)
                    .map(([k, l]) => (
                      <div className="kpi" key={k}>
                        <span className="metric-icon">
                          <Icon
                            name={
                              k.includes('rewards') ? 'gift' : k === 'visits' ? 'chart' : 'people'
                            }
                            size={19}
                          />
                        </span>
                        <small>{l}</small>
                        <strong>{overview.metrics[k]}</strong>
                      </div>
                    ))}
                </div>
                <button
                  className="text-button metrics-disclosure"
                  aria-expanded={showAllMetrics}
                  onClick={() => setShowAllMetrics(!showAllMetrics)}
                >
                  {showAllMetrics
                    ? ar
                      ? 'إظهار الأرقام الأساسية'
                      : 'Show key metrics'
                    : ar
                      ? 'تفاصيل الأداء'
                      : 'More performance details'}
                </button>
                <p className="muted">
                  {ar
                    ? 'الزيارة = عميل جه في يوم وأخد ختم (من الكاشير أو أوتوماتيك)، حتى لو أخد أكتر من ختم. فتح الكارت أو مسحه مش زيارة.'
                    : 'A visit is one customer on one day with at least one stamp (cashier or automatic), even with multiple stamps. Card views and scans do not count. Returning rate: purchasers in this period with an earlier purchase before its start, divided by all purchasers in the period.'}
                </p>
                <section className="panel">
                  <h2>{ar ? 'أداء الفروع' : 'Branch performance'}</h2>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{ar ? 'الفرع' : 'Branch'}</th>
                          <th>{ar ? 'الزيارات' : 'Visits'}</th>
                          <th>{ar ? 'الأختام' : 'Stamps'}</th>
                          <th>{ar ? 'الاستبدال' : 'Redeemed'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.branches.map((b) => (
                          <tr key={b.id}>
                            <td>{b.name}</td>
                            <td>{b.visits}</td>
                            <td>{b.stamps}</td>
                            <td>{b.redeemed}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <PurchaseTrend data={overview} lang={lang} />
                {(grant.role === 'owner' || grant.role === 'manager') && (
                  <StaffActivity merchantId={grant.merchant_id} lang={lang} />
                )}
              </>
            )}
            {detailsOpen && (
              <ExperienceStats
                merchantId={grant.merchant_id}
                branch={branch}
                days={days}
                lang={lang}
              />
            )}
          </details>
        </>
      )}
      {tab === 'support' && <Support lang={lang} merchantId={grant.merchant_id} />}
      {tab === 'materials' && <Materials grant={grant} lang={lang} />}
      {tab === 'customers' && (
        <>
          {(grant.role === 'owner' || grant.role === 'manager') && (
            <PairingApprovals key={grant.merchant_id} merchantId={grant.merchant_id} lang={lang} />
          )}
          <TeamCustomerRecovery key={grant.id} grant={grant} lang={lang} />
          <Customers grant={grant} lang={lang} />
        </>
      )}
      {tab === 'programs' && (
        <>
          {grant.role === 'owner' && (
            <RequestSettings
              merchantId={grant.merchant_id}
              lang={lang}
              onSaved={() => void load()}
            />
          )}
          <div className="section-heading">
            <h2>{ar ? 'برامج الولاء' : 'Loyalty programs'}</h2>
            {grant.role === 'owner' && (
              <button
                className="primary"
                onClick={() => {
                  setError('');
                  setProgramKey(crypto.randomUUID());
                  setProgramBranches(grant.branches.map((b) => b.id));
                  setEditProgram({
                    id: '',
                    name: '',
                    status: 'draft',
                    version: 1,
                    branch_ids: [],
                    threshold: 5,
                    max_per_tx: 3,
                    reward_title: '',
                    reward_terms: '',
                    validity_days: 30,
                    ends_at: null,
                  });
                }}
              >
                {ar ? 'برنامج جديد' : 'New program'}
              </button>
            )}
          </div>
          <div className="cards-grid">
            {programs.map((p) => (
              <section className="panel" key={p.id}>
                {p.locked_at ? (
                  <LockedBadge
                    lang={lang}
                    onOpenPlan={owner ? () => setTab('subscription') : undefined}
                  />
                ) : (
                  <span className="badge">
                    v{p.version} · {statusLabel(p.status, lang)}
                  </span>
                )}
                <h2>{p.name}</h2>
                <p className="program-rule">
                  {ar ? `اجمع ${p.threshold} أختام = ` : `Collect ${p.threshold} stamps = `}
                  <bdi>{p.reward_title}</bdi>
                </p>
                <p className="muted">{p.reward_terms}</p>
                <p>
                  {ar ? 'الصلاحية ' : 'Validity '}
                  {p.validity_days} {ar ? 'يوم' : 'days'}
                </p>
                {grant.role === 'owner' && (
                  <div className="program-actions">
                    <button
                      className={p.status === 'active' ? 'danger-outline' : 'secondary'}
                      onClick={() => {
                        setError('');
                        setEarningAction({
                          program: p,
                          enabled: p.status !== 'active',
                          reason: '',
                          key: crypto.randomUUID(),
                        });
                      }}
                    >
                      {p.status === 'active'
                        ? ar
                          ? 'إيقاف جمع الأختام'
                          : 'Stop earning'
                        : ar
                          ? 'استئناف جمع الأختام'
                          : 'Resume earning'}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => {
                        setProgramKey(crypto.randomUUID());
                        setEditProgram({ ...p });
                        setProgramBranches(
                          p.branch_ids.filter((id) => grant.branches.some((b) => b.id === id)),
                        );
                      }}
                    >
                      {ar ? 'عدّل البرنامج' : 'Edit program'}
                    </button>
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      )}
      {tab === 'branches' && (
        <Branches grant={grant} lang={lang} onOpenPlan={() => setTab('subscription')} />
      )}
      {tab === 'team' && (
        <section className="panel">
          <div className="section-heading">
            <h2>{ar ? 'الفريق والصلاحيات' : 'Staff and permissions'}</h2>
            <button
              className="primary"
              onClick={() =>
                setInvite({
                  email: '',
                  password: '',
                  existing: false,
                  role: 'cashier',
                  branchIds: [grant.branches[0]?.id || ''],
                  maxQty: 3,
                })
              }
            >
              {ar ? 'إضافة حساب موظف' : 'Add staff account'}
            </button>
          </div>
          <AccountSecurity
            merchantId={grant.merchant_id}
            lang={lang}
            branches={grant.branches}
            refreshKey={staff.map((s) => s.id + ':' + s.revision).join('|')}
            onOpenPlan={() => setTab('subscription')}
            lockedIds={(planState?.items || [])
              .filter((i) => i.kind === 'staff' && i.locked)
              .map((i) => i.id)}
            onChanged={load}
          />
          <h3>{ar ? 'الدعوات' : 'Invitations'}</h3>
          {invitations.map((i) => (
            <div className="list-row" key={i.id}>
              <div>
                <bdi>{i.email}</bdi>
                <small>
                  {staffRoleLabel(i.role, lang)} · {statusLabel(i.status, lang)}
                </small>
              </div>
              {i.status === 'pending' && (
                <div>
                  <button
                    className="text-button"
                    onClick={() =>
                      void api(base + '/invitations/' + i.id + '/resend', {
                        method: 'POST',
                        key: crypto.randomUUID(),
                        body: {},
                      })
                        .then(load)
                        .catch((e) => setError(errorText(e, lang)))
                    }
                  >
                    {ar ? 'إرسال تاني' : 'Resend'}
                  </button>
                  <button
                    className="text-button"
                    onClick={() =>
                      void api(base + '/invitations/' + i.id, { method: 'DELETE' })
                        .then(load)
                        .catch((e) => setError(errorText(e, lang)))
                    }
                  >
                    {ar ? 'إلغاء' : 'Revoke'}
                  </button>
                </div>
              )}
            </div>
          ))}
          {grant.role === 'owner' && (
            <RecoveryPolicy key={grant.merchant_id} merchantId={grant.merchant_id} lang={lang} />
          )}
        </section>
      )}
      {tab === 'outreach' && <CustomerOutreach merchantId={grant.merchant_id} lang={lang} />}
      {tab === 'brand' && brand && (
        <div className="wizard-layout">
          <form className="panel" onSubmit={(e) => void saveBrand(e)}>
            <div className="brand-savebar">
              <strong>{ar ? 'تصميم الكارت' : 'Card design'}</strong>
              <button className="primary small" type="submit" disabled={busy}>
                <ActionLabel icon="save">{ar ? 'حفظ التغييرات' : 'Save changes'}</ActionLabel>
              </button>
            </div>
            <label>
              {ar ? 'اسم النشاط' : 'Business name'}
              <input
                required
                value={brand.name}
                onChange={(e) => setBrand({ ...brand, name: e.target.value })}
              />
            </label>
            <label>
              {ar ? 'اللوجو' : 'Logo'}
              <FileUpload
                aria-label={ar ? 'لوجو المحل' : 'Business logo'}
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => void uploadLogo(e.target.files?.[0])}
              />
            </label>
            {brand.logo_asset_id && (
              <img
                width={80}
                height={80}
                style={{ objectFit: 'contain' }}
                src={portalAssetUrl(
                  base.replace('/merchants/', '/api/v1/merchants/') +
                    '/assets/' +
                    brand.logo_asset_id,
                )}
                alt={ar ? 'لوجو النشاط' : 'Business logo'}
              />
            )}
            <LogoStyleControl
              lang={lang}
              logoUrl={preview?.logo_url}
              businessName={brand.name}
              surfaceColor={brand.surface_color}
              value={brand.logo_style}
              size={brand.logo_size}
              onSizeChange={(logo_size) => setBrand({ ...brand, logo_size })}
              onChange={(logo_style) => setBrand({ ...brand, logo_style })}
            />
            {brand.template === 'logomark' && (
              <LogoMarkControl
                lang={lang}
                position={brand.logo_mark_position}
                bleed={brand.logo_mark_bleed}
                onChange={(v) => setBrand({ ...brand, ...v })}
              />
            )}
            <div className="form-grid">
              {(
                [
                  ['primary_color', ar ? 'الأساسي' : 'Primary'],
                  ['accent_color', ar ? 'الثانوي' : 'Accent'],
                  ['surface_color', ar ? 'الخلفية' : 'Surface'],
                ] as const
              ).map(([k, label]) => (
                <ColorField
                  key={k}
                  name={k}
                  label={label}
                  value={brand[k]}
                  onChange={(value) => setBrand({ ...brand, [k]: value })}
                />
              ))}
            </div>
            <PalettePaste
              lang={lang}
              onApply={([primary_color, accent_color, surface_color]) =>
                setBrand({
                  ...brand,
                  primary_color: primary_color!,
                  accent_color: accent_color!,
                  surface_color: surface_color!,
                })
              }
            />
            {preview && (
              <TemplatePicker
                lang={lang}
                card={preview}
                onChange={(template) => {
                  const defaults = suggestedStamps(template);
                  setBrand({
                    ...brand,
                    template,
                    ...(defaults
                      ? {
                          stamp_shape: defaults.stampShape,
                          stamp_icon: defaults.stampIcon,
                          stamp_style: defaults.stampStyle,
                        }
                      : {}),
                  });
                }}
              />
            )}
            {programs.length > 1 && (
              <label>
                {ar ? 'البرنامج اللي بتصمّم له المعاينة' : 'Preview program'}
                <Select
                  aria-label={ar ? 'برنامج المعاينة' : 'Preview program'}
                  value={brandProgram?.id || ''}
                  onChange={(e) => {
                    setBrandProgramId(e.target.value);
                    setPreviewThreshold(null);
                  }}
                >
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {preview && (
              <StampControls
                lang={lang}
                card={preview}
                onCountChange={brandProgram ? setPreviewThreshold : undefined}
                countAction={
                  brandProgram && (
                    <div className="count-publish">
                      <p>
                        {ar
                          ? 'نشر الهوية بيحفظ شكل الكارت. تغيير العدد بيتنشر كنسخة برنامج جديدة من الزر ده، والكروت الحالية تكمّل بعددها القديم.'
                          : 'Publish branding saves the card artwork. Publish a count change separately as a new program version; existing cards keep their original count.'}
                      </p>
                      <button
                        type="button"
                        className="secondary small"
                        disabled={
                          busy ||
                          preview.threshold === brandProgram.threshold ||
                          !Number.isInteger(preview.threshold) ||
                          preview.threshold < 2 ||
                          preview.threshold > 50
                        }
                        onClick={() => {
                          setEditProgram({ ...brandProgram, threshold: preview.threshold });
                          setProgramBranches([...brandProgram.branch_ids]);
                          setProgramKey(crypto.randomUUID());
                        }}
                      >
                        {ar ? 'مراجعة ونشر العدد الجديد' : 'Review and publish stamp count'}
                      </button>
                      <WhyDisabled>
                        {preview.threshold === brandProgram.threshold
                          ? ar
                            ? 'غيّر عدد الأختام الأول، وبعدين انشره من هنا.'
                            : 'Change the stamp count first, then publish it here.'
                          : !Number.isInteger(preview.threshold) ||
                              preview.threshold < 2 ||
                              preview.threshold > 50
                            ? ar
                              ? 'عدد الأختام لازم يكون رقم صحيح من 2 لـ 50.'
                              : 'The stamp count must be a whole number from 2 to 50.'
                            : false}
                      </WhyDisabled>
                    </div>
                  )
                }
                onChange={(v) =>
                  setBrand({
                    ...brand,
                    stamp_shape: v.stampShape,
                    stamp_icon: v.stampIcon,
                    stamp_style: v.stampStyle,
                  })
                }
              />
            )}
            <label>
              {ar ? 'واتساب صاحب المحل' : 'Owner WhatsApp number'}
              <PhoneInput
                lang={lang}
                aria-label={ar ? 'واتساب صاحب المحل' : 'Owner WhatsApp number'}
                value={brand.contact_phone || ''}
                onChange={(e) => setBrand({ ...brand, contact_phone: e.target.value })}
              />
            </label>
            <label>
              {ar ? 'شروط النشاط' : 'Business terms'}
              <textarea
                required
                value={brand.terms}
                onChange={(e) => setBrand({ ...brand, terms: e.target.value })}
              />
            </label>
            <button className="primary" disabled={busy}>
              <ActionLabel icon="check">{ar ? 'نشر الهوية' : 'Publish branding'}</ActionLabel>
            </button>
          </form>
          <aside>{preview && <LoyaltyCard card={preview} lang={lang} />}</aside>
        </div>
      )}
      {tab === 'subscription' && (
        <>
          <MyPlan merchantId={grant.merchant_id} lang={lang} onState={setPlanState} />
          <Subscriptions
            key={grant.merchant_id}
            merchantId={grant.merchant_id}
            lang={lang}
            readOnly
          />
        </>
      )}
      {tab === 'operations' && (
        <section className="panel">
          <h2>{ar ? 'سجل العمليات' : 'Transactions'}</h2>
          <div className="table-wrap mobile-records">
            <table>
              <thead>
                <tr>
                  {(ar
                    ? ['الوقت', 'العميل', 'النوع', 'الكمية', 'الكاشير', 'الفرع', 'المرجع']
                    : ['Time', 'Customer', 'Type', 'Quantity', 'Cashier', 'Branch', 'Reference']
                  ).map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map((t) => (
                  <tr key={t.id}>
                    <td data-label={ar ? 'الوقت' : 'Time'}>
                      {new Date(t.at).toLocaleString(intlLocale(lang), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td data-label={ar ? 'العميل' : 'Customer'}>
                      <bdi>{t.alias}</bdi>
                    </td>
                    <td data-label={ar ? 'النوع' : 'Type'}>
                      {t.source === 'welcome'
                        ? ar
                          ? 'ختم ترحيب'
                          : 'Welcome stamp'
                        : t.type === 'redeem'
                          ? ar
                            ? 'مكافأة اتصرفت'
                            : 'Reward redeemed'
                          : transactionTypeLabel(t.type, lang)}
                    </td>
                    <td data-label={ar ? 'الكمية' : 'Quantity'}>
                      {t.type === 'redeem' ? '—' : t.quantity}
                    </td>
                    <td data-label={ar ? 'الكاشير' : 'Cashier'}>
                      {t.staff_name ? (
                        <bdi>{t.staff_name}</bdi>
                      ) : t.source === 'welcome' || t.source === 'auto' ? (
                        ar ? (
                          'تلقائي'
                        ) : (
                          'Automatic'
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                    <td data-label={ar ? 'الفرع' : 'Branch'}>{t.branch_name}</td>
                    <td data-label={ar ? 'المرجع' : 'Reference'}>
                      <bdi className="muted">{t.public_reference}</bdi>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!recent.length && (
            <p className="muted">
              {ar
                ? 'لسه مفيش عمليات في الفروع المسموحة.'
                : 'No transactions in your allowed branches yet.'}
            </p>
          )}
        </section>
      )}
      {invite && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-heading"
            onSubmit={(e) => void sendInvite(e)}
          >
            <h2 id="invite-heading">{ar ? 'إضافة حساب موظف' : 'Add staff account'}</h2>
            <label>
              {ar ? 'البريد' : 'Email'}
              <input
                required
                type="email"
                dir="ltr"
                autoFocus
                value={invite.email}
                onChange={(e) => setInvite({ ...invite, email: e.target.value })}
              />
              <EmailTypoHint
                email={invite.email}
                lang={lang}
                onUse={(email) => setInvite({ ...invite, email })}
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={invite.existing}
                onChange={(e) => setInvite({ ...invite, existing: e.target.checked, password: '' })}
              />
              {ar ? 'حساب موجود؟ ابعت دعوة' : 'Existing account? Send an invitation'}
            </label>
            {!invite.existing && (
              <PasswordField
                label={ar ? 'باسورد الحساب' : 'Account password'}
                lang={lang}
                autoComplete="new-password"
                required
                minLength={10}
                value={invite.password}
                onChange={(e) => setInvite({ ...invite, password: e.target.value })}
                hint={
                  <small>
                    {ar
                      ? '10 حروف أو أكتر. الموظف يدخل مباشرة بالإيميل والباسورد.'
                      : 'At least 10 characters. Staff can sign in immediately with email and password.'}
                  </small>
                }
              />
            )}
            <label>
              {ar ? 'الدور' : 'Role'}
              <Select
                value={invite.role}
                onChange={(e) =>
                  setInvite({ ...invite, role: e.target.value as typeof invite.role })
                }
              >
                <option value="cashier">{ar ? 'كاشير' : 'Cashier'}</option>
                <option value="manager">{ar ? 'مدير' : 'Manager'}</option>
              </Select>
            </label>
            <fieldset>
              <legend>{ar ? 'الفروع' : 'Branches'}</legend>
              {grant.branches.map((b) => (
                <label className="checkbox-label" key={b.id}>
                  <input
                    type="checkbox"
                    checked={invite.branchIds.includes(b.id)}
                    onChange={() =>
                      setInvite({
                        ...invite,
                        branchIds: invite.branchIds.includes(b.id)
                          ? invite.branchIds.filter((x) => x !== b.id)
                          : [...invite.branchIds, b.id],
                      })
                    }
                  />
                  {b.name}
                </label>
              ))}
            </fieldset>
            <label>
              {ar ? 'حد الأختام' : 'Stamp limit'}
              <input
                type="number"
                min={1}
                max={100}
                value={invite.maxQty}
                onChange={(e) => setInvite({ ...invite, maxQty: Number(e.target.value) })}
              />
            </label>
            <WhyDisabled>
              {!invite.branchIds.length &&
                (ar ? 'اختار فرع واحد على الأقل.' : 'Choose at least one branch.')}
            </WhyDisabled>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                onClick={() => setInvite(null)}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button className="primary" disabled={busy || !invite.branchIds.length}>
                {invite.existing
                  ? ar
                    ? 'ابعت الدعوة'
                    : 'Send invitation'
                  : ar
                    ? 'إنشاء الحساب'
                    : 'Create account'}
              </button>
            </div>
          </form>
        </div>
      )}
      {decision && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="decision-heading"
            onSubmit={(e) => void correctionDecision(e)}
          >
            <h2 id="decision-heading">{ar ? 'مراجعة التصحيح' : 'Review correction'}</h2>
            <p>{decision.correction.reason}</p>
            <p className="muted">
              {ar
                ? 'العكس الآلي متاح لآخر عملية بلا صرف مكافأة. الحالات التانية بتروح مراجعة خاصة.'
                : 'Automatic reversal requires the latest award and unused rewards. Other cases go to manual review.'}
            </p>
            <label>
              {ar ? 'سبب القرار' : 'Decision reason'}
              <textarea
                autoFocus
                minLength={4}
                required
                value={decision.reason}
                onChange={(e) => setDecision({ ...decision, reason: e.target.value })}
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                onClick={() => setDecision(null)}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button className={decision.approve ? 'primary' : 'danger'} disabled={busy}>
                {decision.approve ? (ar ? 'اعتماد' : 'Approve') : ar ? 'رفض' : 'Reject'}
              </button>
            </div>
          </form>
        </div>
      )}
      {earningAction && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="earning-title"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              void api(base + '/programs/' + earningAction.program.id + '/earning-status', {
                method: 'POST',
                key: earningAction.key,
                body: { enabled: earningAction.enabled, reason: earningAction.reason },
              })
                .then(() => {
                  setEarningAction(null);
                  return load();
                })
                .catch((e) => setError(errorText(e, lang)))
                .finally(() => setBusy(false));
            }}
          >
            <h2 id="earning-title">{earningAction.program.name}</h2>
            <p>
              {earningAction.enabled
                ? ar
                  ? 'استئناف الكسب يتطلب مكانًا متاحًا في الخطة. كل عضوية تكمل بقواعد نسختها.'
                  : 'Resuming requires plan capacity. Each membership continues with its pinned version.'
                : ar
                  ? 'جمع أختام جديدة هيتوقف. المكافآت المكتسبة تحتفظ بشروطها وصلاحيتها.'
                  : 'New earning will stop. Earned rewards keep their original terms and expiry.'}
            </p>
            <label>
              {ar ? 'سبب تغيير حالة الكسب' : 'Earning status reason'}
              <textarea
                required
                autoFocus
                minLength={4}
                value={earningAction.reason}
                onChange={(e) => setEarningAction({ ...earningAction, reason: e.target.value })}
              />
            </label>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                disabled={busy}
                onClick={() => setEarningAction(null)}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button className="primary" disabled={busy}>
                {ar ? 'تأكيد الحالة' : 'Confirm earning status'}
              </button>
            </div>
          </form>
        </div>
      )}
      {editProgram && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="program-heading"
            onSubmit={(e) => void publishProgram(e)}
          >
            <h2 id="program-heading">
              {editProgram.id
                ? ar
                  ? 'نسخة برنامج جديدة'
                  : 'New program version'
                : ar
                  ? 'برنامج ولاء جديد'
                  : 'New loyalty program'}
            </h2>
            <p className="muted">
              {editProgram.id
                ? ar
                  ? 'النسخة الجديدة تخص التسجيلات الجديدة، ونشرها لا يستأنف برنامجًا موقوفًا. شروط وأرصدة الأعضاء الحاليين محفوظة.'
                  : 'The new version applies to new enrollments and does not resume a stopped program. Existing members keep their rules and progress.'
                : ar
                  ? 'اختار قواعد المكافأة وفروع البرنامج. كل شراء يُحتسب في برنامج واحد فقط.'
                  : 'Choose the reward rules and branches. Each purchase can be allocated to only one program.'}
            </p>
            <label>
              {ar ? 'الاسم' : 'Name'}
              <input
                required
                value={editProgram.name}
                onChange={(e) => setEditProgram({ ...editProgram, name: e.target.value })}
              />
            </label>
            <label>
              {ar ? 'العتبة' : 'Threshold'}
              <input
                type="number"
                min={2}
                max={50}
                value={editProgram.threshold}
                onChange={(e) =>
                  setEditProgram({ ...editProgram, threshold: Number(e.target.value) })
                }
              />
            </label>
            <label>
              {ar ? 'أقصى كمية في العملية' : 'Max per transaction'}
              <input
                type="number"
                min={1}
                max={100}
                value={editProgram.max_per_tx}
                onChange={(e) =>
                  setEditProgram({ ...editProgram, max_per_tx: Number(e.target.value) })
                }
              />
            </label>
            <label>
              {ar ? 'المكافأة' : 'Reward'}
              <input
                required
                value={editProgram.reward_title}
                onChange={(e) => setEditProgram({ ...editProgram, reward_title: e.target.value })}
              />
            </label>
            <label>
              {ar ? 'الشروط' : 'Terms'}
              <textarea
                required
                value={editProgram.reward_terms}
                onChange={(e) => setEditProgram({ ...editProgram, reward_terms: e.target.value })}
              />
            </label>
            <label>
              {ar ? 'الصلاحية بالأيام' : 'Validity days'}
              <input
                type="number"
                min={1}
                max={365}
                value={editProgram.validity_days}
                onChange={(e) =>
                  setEditProgram({ ...editProgram, validity_days: Number(e.target.value) })
                }
              />
            </label>
            <fieldset>
              <legend>{ar ? 'الفروع في النسخة الجديدة' : 'Branches for this version'}</legend>
              {grant.branches.map((b) => (
                <label className="checkbox-label" key={b.id}>
                  <input
                    type="checkbox"
                    checked={programBranches.includes(b.id)}
                    onChange={() =>
                      setProgramBranches((previous) =>
                        previous.includes(b.id)
                          ? previous.filter((id) => id !== b.id)
                          : [...previous, b.id],
                      )
                    }
                  />
                  {b.name}
                </label>
              ))}
            </fieldset>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                onClick={() => setEditProgram(null)}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button className="primary" disabled={busy}>
                {editProgram.id
                  ? ar
                    ? 'نشر النسخة'
                    : 'Publish version'
                  : ar
                    ? 'نشر البرنامج'
                    : 'Publish program'}
              </button>
            </div>
          </form>
        </div>
      )}
      <InstallAppButton lang={lang} portal="merchant" />
    </div>
  );
}
