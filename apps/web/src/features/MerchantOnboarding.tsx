import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { CardData, Language } from '../../../../packages/contracts/src/index.js';
import { LoyaltyCard } from '../../../../packages/ui/src/LoyaltyCard.js';
import { Icon } from '../../../../packages/ui/src/Icon.js';
import { api, ApiError, errorText } from '../api.js';
import { FileUpload } from '../controls/FileUpload.js';
import {
  ColorField,
  LogoStyleControl,
  PalettePaste,
  StampControls,
  TemplatePicker,
} from './BrandControls.js';
import { suggestedStamps } from '../../../../packages/contracts/src/branding.js';
import { publicPlanCatalog } from '../../../../packages/contracts/src/plan-catalog.js';
import type { MerchantOnboardingSetup } from '../../../../packages/contracts/src/merchant-onboarding.js';
import { SIGNUP_PLAN_KEY } from './MerchantSignup.js';

type Draft = {
  logo_id?: string | null;
  publication?: Publication | null;
  rejection_reason?: string | null;
  id: string;
  details: { name?: string; setup?: MerchantOnboardingSetup };
  revision: number;
};
type Publication = { merchantId: string; placementId: string; code: string };
type Plan = { plan_key: string; name_ar: string; name_en: string; amount_minor: number };
type Order = {
  id: string;
  plan_key?: string;
  amount_minor: number;
  recipient_account: string;
  submitted_reference?: string;
  confirmed_at?: string;
  rejection_reason?: string;
};
type StepId = 'name' | 'card' | 'payment' | 'publish';
const endpoint = '/merchant-onboarding/draft';
function readImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
const money = (ar: boolean, minor: number) =>
  new Intl.NumberFormat(ar ? 'ar-EG-u-nu-latn' : 'en-EG', {
    style: 'currency',
    currency: 'EGP',
    maximumFractionDigits: 0,
  }).format(minor / 100);
const planName = (ar: boolean, plans: Plan[] | null, key?: string) => {
  const plan = plans?.find((p) => p.plan_key === key);
  return plan ? (ar ? plan.name_ar : plan.name_en) : (key ?? '');
};
/** One line of what a plan includes, from the same catalog as the landing page. */
function planLimits(ar: boolean, key: string) {
  const plan = publicPlanCatalog.find((p) => p.key === key);
  if (!plan) return '';
  const branches = ar
    ? plan.includedBranches === 1
      ? 'فرع واحد'
      : plan.includedBranches === 2
        ? 'فرعين'
        : `${plan.includedBranches} فروع`
    : `${plan.includedBranches} branch${plan.includedBranches === 1 ? '' : 'es'}`;
  const staff =
    plan.includedStaff === null
      ? ar
        ? 'موظفين من غير حد'
        : 'unlimited staff'
      : ar
        ? `${plan.includedStaff} موظفين`
        : `${plan.includedStaff} staff`;
  const programs = ar
    ? plan.activePrograms === 1
      ? 'برنامج أختام واحد'
      : `${plan.activePrograms} برامج أختام`
    : `${plan.activePrograms} stamp program${plan.activePrograms === 1 ? '' : 's'}`;
  return [branches, staff, programs].join(' · ');
}

export function MerchantOnboarding({ lang }: { lang: Language }) {
  const ar = lang === 'ar';
  const [draft, setDraft] = useState<Draft | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  // A finished step the owner chose to reopen; otherwise the first unfinished step is open.
  const [reopened, setReopened] = useState<StepId | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api<{ draft: Draft | null }>(endpoint),
      api<{ plans: Plan[] }>('/merchant-onboarding/plans'),
      api<{ order: Order | null }>('/merchant-onboarding/order'),
    ])
      .then(([saved, catalog, payment]) => {
        if (!active) return;
        setDraft(saved.draft);
        setPlans(catalog.plans);
        setOrder(payment.order);
        setLoaded(true);
      })
      .catch((failure: unknown) => {
        if (active) setError(failure);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  const reload = () => {
    setError(null);
    setAttempt((value) => value + 1);
  };

  if (draft?.publication) return <Published draft={draft} lang={lang} />;
  if (!loaded)
    return (
      <main id="main" className="join-page onboarding-page">
        <section className="panel">
          <h1>{ar ? 'جهّز محلك' : 'Set up your shop'}</h1>
          {error != null ? (
            <>
              <p role="alert" className="notice error">
                {errorText(error, lang)}
              </p>
              <button type="button" className="secondary" onClick={reload}>
                {ar ? 'جرّب تاني' : 'Try again'}
              </button>
            </>
          ) : (
            <p role="status">{ar ? 'بنحمّل بيانات محلك…' : 'Loading your shop…'}</p>
          )}
        </section>
      </main>
    );

  const receiptSent = !!order?.submitted_reference && !order.rejection_reason;
  const done: Record<StepId, boolean> = {
    name: !!draft?.details.name,
    card: !!draft?.details.setup,
    payment: receiptSent,
    publish: false,
  };
  const order_: StepId[] = ['name', 'card', 'payment', 'publish'];
  const current = order_.find((id) => !done[id])!;
  const open = reopened && done[reopened] ? reopened : current;
  const advance = () => {
    setReopened(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const setup = draft?.details.setup;
  const steps: { id: StepId; label: string; summary?: string }[] = [
    { id: 'name', label: ar ? 'اسم المحل' : 'Shop name', summary: draft?.details.name },
    {
      id: 'card',
      label: ar ? 'الفرع وكارت الولاء' : 'Branch and loyalty card',
      summary: setup
        ? `${setup.branchName} · ${setup.rewardTitle} ${ar ? 'بعد' : 'after'} ${setup.threshold} ${ar ? 'أختام' : 'stamps'}`
        : undefined,
    },
    {
      id: 'payment',
      label: ar ? 'الباقة والدفع' : 'Plan and payment',
      summary:
        receiptSent && order
          ? `${planName(ar, plans, order.plan_key)} · ${money(ar, order.amount_minor)}`
          : undefined,
    },
    { id: 'publish', label: ar ? 'انشر محلك' : 'Publish your shop' },
  ];
  // Payment cannot be reopened once a receipt is with the reviewer.
  const editable = (id: StepId) => done[id] && id !== open && (id === 'name' || id === 'card');

  return (
    <main id="main" className="join-page onboarding-page">
      <header className="onboarding-head">
        <h1>{ar ? 'جهّز محلك' : 'Set up your shop'}</h1>
        <p className="muted">
          {ar
            ? '4 خطوات وتبدأ تدّي أختام لزباينك. كل حاجة بتتحفظ أول بأول، وتقدر تكمّل في أي وقت.'
            : 'Four steps and you can start stamping. Everything is saved as you go, so you can finish any time.'}
        </p>
      </header>
      <ol className="onboarding-steps" aria-label={ar ? 'خطوات التجهيز' : 'Setup steps'}>
        {steps.map((step, index) => (
          <li
            key={step.id}
            className={step.id === open ? 'current' : done[step.id] ? 'done' : 'upcoming'}
            aria-current={step.id === open ? 'step' : undefined}
          >
            <span className="onboarding-step-mark" aria-hidden="true">
              {done[step.id] && step.id !== open ? <Icon name="check" size={16} /> : index + 1}
            </span>
            <span className="onboarding-step-text">
              <strong>{step.label}</strong>
              {step.summary && step.id !== open && (
                <bdi className="onboarding-step-summary">{step.summary}</bdi>
              )}
            </span>
            {editable(step.id) && (
              <button type="button" className="text-button" onClick={() => setReopened(step.id)}>
                {ar ? 'عدّل' : 'Edit'}
              </button>
            )}
          </li>
        ))}
      </ol>
      <section className="panel onboarding-step" aria-labelledby={'onboarding-step-' + open}>
        {open === 'name' && (
          <NameStep
            draft={draft}
            lang={lang}
            onSaved={(next) => {
              setDraft(next);
              advance();
            }}
            onConflict={reload}
          />
        )}
        {open === 'card' && draft && (
          <ShopSetup
            key={draft.id + ':' + attempt}
            draft={draft}
            lang={lang}
            onChange={setDraft}
            onSaved={(next) => {
              setDraft(next);
              advance();
            }}
          />
        )}
        {open === 'payment' && draft && (
          <PaymentStep
            lang={lang}
            plans={plans ?? []}
            order={order}
            onOrder={(next) => {
              setOrder(next);
              if (next.submitted_reference) advance();
            }}
          />
        )}
        {open === 'publish' && draft && order && (
          <PublishStep
            lang={lang}
            draft={draft}
            order={order}
            plans={plans}
            onPublished={(publication) => setDraft({ ...draft, publication })}
            onRefresh={reload}
          />
        )}
      </section>
    </main>
  );
}

function StepHeading({ id, title, children }: { id: StepId; title: string; children?: ReactNode }) {
  return (
    <div className="onboarding-step-head">
      <h2 id={'onboarding-step-' + id}>{title}</h2>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}

function NameStep({
  draft,
  lang,
  onSaved,
  onConflict,
}: {
  draft: Draft | null;
  lang: Language;
  onSaved: (draft: Draft) => void;
  onConflict: () => void;
}) {
  const ar = lang === 'ar';
  const [name, setName] = useState(draft?.details.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const current = draft ?? (await api<{ draft: Draft }>(endpoint, { method: 'POST' })).draft;
      const result = await api<{ draft: Draft }>(endpoint, {
        method: 'PATCH',
        body: { name, revision: current.revision },
      });
      onSaved(result.draft);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} aria-busy={busy}>
      <StepHeading id="name" title={ar ? 'اسم محلك إيه؟' : 'What is your shop called?'}>
        {ar
          ? 'الاسم ده هيظهر لزباينك على الكارت وفي صفحة الانضمام.'
          : 'Your customers see this name on their card and on the join page.'}
      </StepHeading>
      <label htmlFor="merchant-onboarding-name">{ar ? 'اسم المحل' : 'Shop name'}</label>
      <input
        id="merchant-onboarding-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={ar ? 'مثلًا: كافيه الياسمين' : 'e.g. Jasmine Café'}
        maxLength={120}
        disabled={busy}
        required
        autoFocus
      />
      {error != null && (
        <p role="alert" className="notice error">
          {errorText(error, lang)}
        </p>
      )}
      <div className="form-actions">
        <button className="primary" disabled={busy || !name.trim()}>
          {busy ? (ar ? 'بنحفظ…' : 'Saving…') : ar ? 'احفظ وكمّل' : 'Save and continue'}
        </button>
        {error instanceof ApiError && error.status === 409 && (
          <button type="button" className="secondary" onClick={onConflict}>
            {ar ? 'حمّل آخر نسخة' : 'Load latest version'}
          </button>
        )}
      </div>
    </form>
  );
}

function ShopSetup({
  draft,
  lang,
  onChange,
  onSaved,
}: {
  draft: Draft;
  lang: Language;
  onChange: (draft: Draft) => void;
  onSaved: (draft: Draft) => void;
}) {
  const ar = lang === 'ar';
  const [setup, setSetup] = useState<MerchantOnboardingSetup>(
    draft.details.setup ?? {
      branchName: '',
      branchAddress: '',
      rewardTitle: '',
      threshold: 6,
      cardColor: '#173d37',
    },
  );
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const logoUrl = draft.logo_id
    ? `/api/v1/merchant-onboarding/draft/${draft.id}/logo?v=${draft.logo_id}`
    : undefined;
  const preview: CardData = {
    id: draft.id,
    merchant_id: draft.id,
    merchant_name: draft.details.name ?? '',
    logo_url: logoUrl,
    logo_style: setup.logoStyle ?? 'framed',
    logo_size: setup.logoSize ?? 43,
    stamp_shape: setup.stampShape,
    stamp_icon: setup.stampIcon,
    stamp_style: setup.stampStyle,
    alias: ar ? 'معاينة' : 'Preview',
    program_name: ar ? 'كارت الولاء' : 'Loyalty card',
    threshold: setup.threshold,
    balance: 0,
    primary_color: setup.cardColor,
    accent_color: setup.accentColor ?? '#ddd3a7',
    surface_color: setup.surfaceColor ?? '#f5f1e7',
    template: setup.template ?? 'classic',
    reward_title: setup.rewardTitle,
    revision: draft.revision,
    cycle_number: 1,
  };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ draft: Draft }>(endpoint, {
        method: 'PATCH',
        body: { name: draft.details.name, revision: draft.revision, setup },
      });
      onSaved(result.draft);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo(file: File) {
    if (logoBusy || busy) return;
    if (file.size > 2_000_000) {
      setError(new ApiError('ASSET_TOO_LARGE', 422));
      return;
    }
    setLogoBusy(true);
    setError(null);
    try {
      const image = await readImage(file);
      const result = await api<{ draft: Draft }>(endpoint + '/' + draft.id + '/logo', {
        method: 'POST',
        body: { image: image.split(',')[1], revision: draft.revision },
      });
      onChange(result.draft);
    } catch (failure) {
      setError(failure);
    } finally {
      setLogoBusy(false);
    }
  }

  return (
    <form onSubmit={save} aria-busy={busy}>
      <StepHeading id="card" title={ar ? 'الفرع وكارت الولاء' : 'Branch and loyalty card'}>
        {ar
          ? 'دي المعاينة اللي زباينك هيشوفوها. كل تعديل بيظهر عليها على طول.'
          : 'This is the card your customers will see. Every change shows on it right away.'}
      </StepHeading>
      <div className="onboarding-card-preview">
        <LoyaltyCard lang={lang} motion="quiet" card={preview} />
      </div>
      <fieldset disabled={busy}>
        <label>
          {ar ? 'اسم أول فرع' : 'First branch name'}
          <input
            required
            minLength={2}
            maxLength={120}
            placeholder={ar ? 'مثلًا: فرع المعادي' : 'e.g. Maadi branch'}
            value={setup.branchName}
            onChange={(e) => setSetup({ ...setup, branchName: e.target.value })}
          />
        </label>
        <label>
          {ar ? 'عنوان الفرع' : 'Branch address'}
          <input
            required
            minLength={2}
            maxLength={300}
            value={setup.branchAddress}
            onChange={(e) => setSetup({ ...setup, branchAddress: e.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            {ar ? 'المكافأة' : 'Reward'}
            <input
              required
              minLength={2}
              maxLength={240}
              placeholder={ar ? 'مثلًا: مشروب مجاني' : 'e.g. A free drink'}
              value={setup.rewardTitle}
              onChange={(e) => setSetup({ ...setup, rewardTitle: e.target.value })}
            />
          </label>
          <label>
            {ar ? 'عدد الأختام للمكافأة' : 'Stamps for the reward'}
            <input
              type="number"
              inputMode="numeric"
              min={2}
              max={50}
              required
              value={setup.threshold || ''}
              onChange={(e) => setSetup({ ...setup, threshold: Number(e.target.value) })}
            />
          </label>
        </div>
        <label htmlFor="onboarding-shop-logo">
          {ar ? 'لوجو المحل (اختياري)' : 'Shop logo (optional)'}
        </label>
        <FileUpload
          id="onboarding-shop-logo"
          accept="image/png,image/jpeg,image/webp"
          disabled={logoBusy || busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadLogo(file);
          }}
        />
        <small className="field-hint">
          {logoBusy
            ? ar
              ? 'بنرفع اللوجو…'
              : 'Uploading logo…'
            : ar
              ? 'صورة أقل من 2 ميجا. تقدر تضيفه أو تغيّره بعدين من لوحة المحل.'
              : 'An image under 2 MB. You can add or change it later from the dashboard.'}
        </small>
        <details className="onboarding-design">
          <summary>
            {ar ? 'خصّص ألوان وشكل الكارت (اختياري)' : 'Customize card colors and style (optional)'}
          </summary>
          <LogoStyleControl
            lang={lang}
            logoUrl={logoUrl}
            businessName={preview.merchant_name}
            surfaceColor={preview.surface_color}
            value={setup.logoStyle ?? 'framed'}
            size={setup.logoSize ?? 43}
            onSizeChange={(logoSize) => setSetup((value) => ({ ...value, logoSize }))}
            onChange={(logoStyle) => setSetup((value) => ({ ...value, logoStyle }))}
          />
          <div className="form-grid">
            <ColorField
              name="cardColor"
              label={ar ? 'اللون الأساسي' : 'Primary color'}
              value={preview.primary_color}
              onChange={(cardColor) => setSetup((value) => ({ ...value, cardColor }))}
            />
            <ColorField
              name="accentColor"
              label={ar ? 'اللون الثانوي' : 'Accent color'}
              value={preview.accent_color}
              onChange={(accentColor) => setSetup((value) => ({ ...value, accentColor }))}
            />
            <ColorField
              name="surfaceColor"
              label={ar ? 'الخلفية' : 'Background'}
              value={preview.surface_color}
              onChange={(surfaceColor) => setSetup((value) => ({ ...value, surfaceColor }))}
            />
          </div>
          <PalettePaste
            lang={lang}
            onApply={([cardColor, accentColor, surfaceColor]) =>
              setSetup((value) => ({
                ...value,
                cardColor: cardColor ?? value.cardColor,
                accentColor: accentColor ?? value.accentColor,
                surfaceColor: surfaceColor ?? value.surfaceColor,
              }))
            }
          />
          <TemplatePicker
            lang={lang}
            card={preview}
            onChange={(template) =>
              setSetup((value) => ({ ...value, template, ...suggestedStamps(template) }))
            }
          />
          <StampControls
            lang={lang}
            card={preview}
            onChange={(stamps) => setSetup((value) => ({ ...value, ...stamps }))}
          />
        </details>
      </fieldset>
      {error != null && (
        <p role="alert" className="notice error">
          {errorText(error, lang)}
        </p>
      )}
      <div className="form-actions">
        <button className="primary" disabled={busy || logoBusy}>
          {busy ? (ar ? 'بنحفظ…' : 'Saving…') : ar ? 'احفظ وكمّل' : 'Save and continue'}
        </button>
      </div>
    </form>
  );
}

function PaymentStep({
  lang,
  plans,
  order,
  onOrder,
}: {
  lang: Language;
  plans: Plan[];
  order: Order | null;
  onOrder: (order: Order) => void;
}) {
  const ar = lang === 'ar';
  const [selected, setSelected] = useState(() => {
    if (order?.plan_key) return order.plan_key;
    let picked: string | null = null;
    try {
      picked = localStorage.getItem(SIGNUP_PLAN_KEY);
    } catch {
      /* Storage blocked: fall back to the first plan. */
    }
    return plans.find((plan) => plan.plan_key === picked)?.plan_key ?? plans[0]?.plan_key ?? '';
  });
  const [choosing, setChoosing] = useState(!order || !!order.rejection_reason);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function choose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ order: Order }>('/merchant-onboarding/order', {
        method: 'POST',
        body: { planKey: selected },
      });
      onOrder(result.order);
      setChoosing(false);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  if (!plans.length && choosing)
    return (
      <>
        <StepHeading id="payment" title={ar ? 'الباقة والدفع' : 'Plan and payment'} />
        <p className="notice">
          {ar
            ? 'الاشتراك من الموقع مش متاح دلوقتي. كلّمنا على واتساب وهنجهّزلك محلك.'
            : 'Online sign-up is not available right now. Message us on WhatsApp and we will set up your shop.'}
        </p>
      </>
    );

  if (choosing)
    return (
      <form onSubmit={choose} aria-busy={busy}>
        <StepHeading id="payment" title={ar ? 'اختار باقتك' : 'Choose your plan'}>
          {ar
            ? 'الدفع شهري بـ InstaPay، ومن غير رسوم تجهيز. تقدر تغيّر الباقة بعدين من لوحة المحل.'
            : 'Paid monthly by InstaPay, with no setup fee. You can change plans later from the dashboard.'}
        </StepHeading>
        {order?.rejection_reason && (
          <p role="alert" className="notice error">
            {ar ? 'مقدرناش نأكد التحويل اللي فات: ' : 'We could not confirm your last transfer: '}
            {order.rejection_reason}
          </p>
        )}
        <fieldset className="plan-choices" disabled={busy}>
          <legend className="sr-only">{ar ? 'الباقة' : 'Plan'}</legend>
          {plans.map((plan) => (
            <label key={plan.plan_key} className="plan-choice">
              <input
                type="radio"
                name="onboarding-plan"
                value={plan.plan_key}
                checked={selected === plan.plan_key}
                onChange={() => setSelected(plan.plan_key)}
              />
              <span className="plan-choice-body">
                <span className="plan-choice-head">
                  <strong>{ar ? plan.name_ar : plan.name_en}</strong>
                  <span className="plan-choice-price">
                    {money(ar, plan.amount_minor)}
                    <small>{ar ? ' / شهريًا' : ' / month'}</small>
                  </span>
                </span>
                <small className="muted">{planLimits(ar, plan.plan_key)}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {error != null && (
          <p className="notice error" role="alert">
            {errorText(error, lang)}
          </p>
        )}
        <div className="form-actions">
          <button className="primary" disabled={!selected || busy}>
            {busy ? (ar ? 'لحظة…' : 'One moment…') : ar ? 'كمّل للدفع' : 'Continue to payment'}
          </button>
          {order && !order.rejection_reason && (
            <button type="button" className="secondary" onClick={() => setChoosing(false)}>
              {ar ? 'رجوع' : 'Back'}
            </button>
          )}
        </div>
      </form>
    );

  if (!order) return null;
  return (
    <>
      <StepHeading id="payment" title={ar ? 'ادفع الاشتراك بـ InstaPay' : 'Pay by InstaPay'}>
        {ar ? 'باقة ' : 'Plan: '}
        <bdi>{planName(ar, plans, order.plan_key)}</bdi>
        {' · '}
        {money(ar, order.amount_minor)} {ar ? 'شهريًا' : 'a month'}
        {' · '}
        <button type="button" className="link-button" onClick={() => setChoosing(true)}>
          {ar ? 'غيّر الباقة' : 'Change plan'}
        </button>
      </StepHeading>
      <ol className="transfer-steps">
        <li>
          <span>
            {ar ? 'حوّل ' : 'Send '}
            <strong>{money(ar, order.amount_minor)}</strong>
            {ar ? ' بالظبط على عنوان InstaPay ده:' : ' exactly to this InstaPay address:'}
          </span>
          <CopyField value={order.recipient_account} lang={lang} />
        </li>
        <li>
          {ar
            ? 'بعد التحويل، خد صورة (سكرين شوت) من رسالة أو إيصال التحويل.'
            : 'After sending, take a screenshot of the transfer confirmation.'}
        </li>
        <li>
          {ar
            ? 'اكتب رقم العملية وارفع الصورة هنا، وإحنا هنراجعها.'
            : 'Enter the transaction number and upload the screenshot here for review.'}
        </li>
      </ol>
      <PaymentReceipt order={order} onSaved={onOrder} lang={lang} />
    </>
  );
}

function CopyField({ value, lang }: { value: string; lang: Language }) {
  const ar = lang === 'ar';
  const [copied, setCopied] = useState(false);
  return (
    <span className="copy-field">
      <bdi dir="ltr">{value}</bdi>
      <button
        type="button"
        className="secondary small"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2500);
            },
            () => setCopied(false),
          );
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} size={16} />
        {copied ? (ar ? 'اتنسخ' : 'Copied') : ar ? 'انسخ' : 'Copy'}
      </button>
      <span className="sr-only" role="status">
        {copied ? (ar ? 'العنوان اتنسخ' : 'Address copied') : ''}
      </span>
    </span>
  );
}

function PublishStep({
  lang,
  draft,
  order,
  plans,
  onPublished,
  onRefresh,
}: {
  lang: Language;
  draft: Draft;
  order: Order;
  plans: Plan[] | null;
  onPublished: (publication: Publication) => void;
  onRefresh: () => void;
}) {
  const ar = lang === 'ar';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const setup = draft.details.setup;

  async function publish() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ publication: Publication }>(
        endpoint + '/' + draft.id + '/publish',
        { method: 'POST', body: { revision: draft.revision } },
      );
      onPublished(result.publication);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <StepHeading id="publish" title={ar ? 'كل حاجة جاهزة' : 'Everything is ready'} />
      {order.confirmed_at ? (
        <p className="notice success" role="status">
          <Icon name="check" size={18} /> {ar ? 'التحويل اتأكد.' : 'Your payment is confirmed.'}
        </p>
      ) : (
        <div className="notice onboarding-review-status" role="status">
          <p>
            <strong>
              {ar ? 'الإيصال وصلنا وبنراجعه.' : 'We have your receipt and are reviewing it.'}
            </strong>{' '}
            {ar
              ? 'هيوصلك إيميل أول ما نأكد التحويل.'
              : 'You will get an email as soon as the transfer is confirmed.'}
          </p>
          <button type="button" className="text-button" onClick={onRefresh}>
            {ar ? 'حدّث حالة الدفع' : 'Refresh payment status'}
          </button>
        </div>
      )}
      <dl className="onboarding-summary">
        <dt>{ar ? 'المحل' : 'Shop'}</dt>
        <dd>
          <bdi>{draft.details.name}</bdi>
        </dd>
        {setup && (
          <>
            <dt>{ar ? 'الفرع' : 'Branch'}</dt>
            <dd>
              <bdi>{setup.branchName}</bdi>
            </dd>
            <dt>{ar ? 'المكافأة' : 'Reward'}</dt>
            <dd>
              <bdi>{setup.rewardTitle}</bdi> ({ar ? 'بعد' : 'after'} {setup.threshold}{' '}
              {ar ? 'أختام' : 'stamps'})
            </dd>
          </>
        )}
        <dt>{ar ? 'الباقة' : 'Plan'}</dt>
        <dd>
          <bdi>{planName(ar, plans, order.plan_key)}</bdi> · {money(ar, order.amount_minor)}{' '}
          {ar ? 'شهريًا' : 'a month'}
        </dd>
      </dl>
      {!order.confirmed_at && (
        <p className="muted">
          {ar
            ? 'مش لازم تستنى المراجعة: انشر محلك دلوقتي وزباينك يبدأوا ياخدوا أختام على طول. لو طلعت مشكلة في التحويل، هنبعتلك إيميل بالسبب والمحل هيتوقف مؤقتًا لحد ما تصلّحها، وكروت زباينك وأختامهم مش هتضيع.'
            : 'No need to wait for the review: publish now and customers can start collecting stamps. If there is a problem with the transfer, we will email you the reason and pause the shop until it is fixed. Customer cards and stamps are kept.'}
        </p>
      )}
      {error != null && (
        <p className="notice error" role="alert">
          {errorText(error, lang)}
        </p>
      )}
      <div className="form-actions">
        <button className="primary" type="button" disabled={busy} onClick={() => void publish()}>
          {busy ? (ar ? 'بننشر المحل…' : 'Publishing…') : ar ? 'انشر محلك' : 'Publish your shop'}
        </button>
      </div>
    </>
  );
}

function Published({ draft, lang }: { draft: Draft; lang: Language }) {
  const ar = lang === 'ar';
  const { merchantId, placementId, code } = draft.publication!;
  return (
    <main id="main" className="join-page onboarding-page">
      <section className="panel onboarding-published">
        {draft.logo_id && !draft.rejection_reason && (
          <img
            className="onboarding-published-logo"
            src={`/api/v1/public/merchants/${merchantId}/logos/${draft.logo_id}`}
            alt=""
          />
        )}
        {draft.rejection_reason ? (
          <>
            <h1>
              <bdi>{draft.details.name}</bdi>
            </h1>
            <p role="alert" className="notice error">
              {ar
                ? 'مقدرناش نأكد التحويل، فالمحل اتوقف مؤقتًا لحد ما بيانات التحويل تتصحّح. كروت زباينك وأختامهم محفوظة.'
                : 'We could not confirm the transfer, so the shop is paused until the transfer details are corrected. Customer cards and stamps are kept.'}
              <br />
              <strong>{ar ? 'السبب: ' : 'Reason: '}</strong>
              {draft.rejection_reason}
            </p>
            <PaymentCorrection draft={draft} lang={lang} />
          </>
        ) : (
          <>
            <h1>{ar ? 'محلك اتنشر!' : 'Your shop is live!'}</h1>
            <p className="muted">
              <bdi>{draft.details.name}</bdi>{' '}
              {ar
                ? 'جاهز يستقبل زباين. فاضل 3 حاجات صغيرة:'
                : 'is ready for customers. Three small things left:'}
            </p>
            <ol className="transfer-steps">
              <li>
                {ar
                  ? 'نزّل الـQR واطبعه وحطّه جنب الكاشير.'
                  : 'Download the QR, print it and place it by the till.'}
              </li>
              <li>
                {ar
                  ? 'جرّب لينك الانضمام بنفسك عشان تشوف اللي زبونك هيشوفه.'
                  : 'Try the join link yourself to see what customers see.'}
              </li>
              <li>
                {ar
                  ? 'من لوحة المحل ضيف الكاشير بتاعك عشان يبدأ يدّي أختام.'
                  : 'In the dashboard, add your cashier so they can start stamping.'}
              </li>
            </ol>
          </>
        )}
        <div className="form-actions">
          {!draft.rejection_reason && (
            <>
              <a
                className="primary"
                href={`/api/v1/merchants/${merchantId}/placements/${placementId}/qr?__portal=merchant`}
              >
                <Icon name="download" size={18} />
                {ar ? 'نزّل الـQR' : 'Download QR'}
              </a>
              <a className="secondary" href={'/p/' + code}>
                {ar ? 'افتح لينك الانضمام' : 'Open join link'}
              </a>
            </>
          )}
          <a className="secondary" href="/merchant">
            {ar ? 'ادخل لوحة المحل' : 'Open shop dashboard'}
          </a>
        </div>
      </section>
    </main>
  );
}

function PaymentCorrection({ draft, lang }: { draft: Draft; lang: Language }) {
  const ar = lang === 'ar';
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ order: Order }>(endpoint + '/' + draft.id + '/correction', {
        method: 'POST',
      });
      setOrder(result.order);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={ar ? 'تصحيح التحويل' : 'Correct transfer'}>
      {error != null && (
        <p className="notice error" role="alert">
          {errorText(error, lang)}
        </p>
      )}
      {!order ? (
        <button className="primary" type="button" disabled={busy} onClick={() => void start()}>
          {busy
            ? ar
              ? 'بنحمّل…'
              : 'Loading…'
            : ar
              ? 'صحّح بيانات التحويل'
              : 'Correct transfer details'}
        </button>
      ) : (
        <>
          <ol className="transfer-steps">
            <li>
              <span>
                {ar ? 'حوّل ' : 'Send '}
                <strong>{money(ar, order.amount_minor)}</strong>
                {ar ? ' على عنوان InstaPay ده:' : ' to this InstaPay address:'}
              </span>
              <CopyField value={order.recipient_account} lang={lang} />
            </li>
            <li>
              {ar
                ? 'اكتب رقم العملية الجديدة وارفع صورة الإيصال.'
                : 'Enter the new transaction number and upload the receipt.'}
            </li>
          </ol>
          <PaymentReceipt order={order} onSaved={setOrder} lang={lang} />
        </>
      )}
    </section>
  );
}

function PaymentReceipt({
  order,
  onSaved,
  lang,
}: {
  order: Order;
  onSaved: (order: Order) => void;
  lang: Language;
}) {
  const ar = lang === 'ar';
  const [reference, setReference] = useState(order.submitted_reference ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result));
    reader.readAsDataURL(file);
    return () => {
      if (reader.readyState === FileReader.LOADING) reader.abort();
    };
  }, [file]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    if (file.size > 2_000_000) {
      setError(ar ? 'اختار صورة حجمها أقل من 2 ميجابايت.' : 'Choose an image under 2 MB.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const image = (await readImage(file)).split(',')[1];
      const result = await api<{ order: Order }>(
        '/merchant-onboarding/order/' + order.id + '/receipt',
        { method: 'POST', body: { reference, image } },
      );
      onSaved({ ...order, ...result.order });
    } catch (failure) {
      setError(errorText(failure, lang));
    } finally {
      setBusy(false);
    }
  }

  if (order.confirmed_at)
    return <p role="status">{ar ? 'التحويل اتأكد.' : 'Payment confirmed.'}</p>;
  if (order.submitted_reference)
    return (
      <p role="status" className="notice">
        {ar
          ? 'الإيصال وصلنا وبنراجعه. هيوصلك إيميل أول ما نأكد التحويل.'
          : 'Receipt received and under review. We will email you once it is confirmed.'}
      </p>
    );
  return (
    <form onSubmit={upload} aria-busy={busy} className="receipt-form">
      <label htmlFor="onboarding-transfer-reference">
        {ar ? 'رقم العملية' : 'Transaction number'}
      </label>
      <input
        id="onboarding-transfer-reference"
        dir="ltr"
        required
        minLength={3}
        maxLength={120}
        value={reference}
        disabled={busy}
        aria-describedby="onboarding-transfer-reference-hint"
        onChange={(e) => setReference(e.target.value)}
      />
      <small id="onboarding-transfer-reference-hint" className="field-hint">
        {ar
          ? 'هتلاقيه في رسالة InstaPay أو في تفاصيل العملية في الأبلكيشن.'
          : 'You will find it in the InstaPay message or in the transaction details in the app.'}
      </small>
      <label htmlFor="onboarding-receipt">{ar ? 'صورة الإيصال' : 'Receipt screenshot'}</label>
      <FileUpload
        id="onboarding-receipt"
        accept="image/jpeg,image/png,image/webp"
        required
        disabled={busy}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {file && preview && (
        <img
          className="onboarding-upload-preview"
          src={preview}
          alt={ar ? 'معاينة الإيصال' : 'Receipt preview'}
        />
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="primary" disabled={busy || !file || reference.trim().length < 3}>
          {busy
            ? ar
              ? 'بنرفع الإيصال…'
              : 'Uploading receipt…'
            : ar
              ? 'ابعت الإيصال'
              : 'Submit receipt'}
        </button>
      </div>
    </form>
  );
}
