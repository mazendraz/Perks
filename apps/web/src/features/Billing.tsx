import { useEffect, useState, type FormEvent } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import {
  booleanFeatureKeys,
  enumFeatures,
  limitKeys,
} from '../../../../packages/contracts/src/entitlements.js';
import { moneyMinor } from '../../../../packages/domain/src/subscriptions.js';
import { api, ApiError, errorText } from '../api.js';
import { Select } from '../controls/Select.js';
import type { CatalogPlan } from './PlanBilling.js';
import {
  addonLabel,
  day,
  featureLabel,
  levelLabel,
  limitLabel,
  money,
  statusLabel,
} from './billing-labels.js';

interface Overview {
  byStatus: { status: string; merchants: number }[];
  mrr: { plan: string; currency: string; merchants: number; mrr_minor: number }[];
  renewalsDue: {
    id: string;
    name: string;
    plan: string;
    current_period_end: string;
    price_minor: number;
    currency: string;
    billing_period: string;
  }[];
  pastDue: {
    id: string;
    name: string;
    plan: string;
    status: string;
    past_due_since: string | null;
    price_minor: number;
    currency: string;
  }[];
}

/** Super Admin: money at a glance, and the plans catalog. */
export function Billing({ lang }: { lang: Language }) {
  const ar = lang === 'ar';
  const [tab, setTab] = useState<'overview' | 'plans'>('overview');
  return (
    <div className="billing-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{ar ? 'إدارة Perks' : 'PERKS ADMINISTRATION'}</span>
          <h1>{ar ? 'الاشتراكات والباقات' : 'Billing and plans'}</h1>
        </div>
      </div>
      <nav className="tabbar" aria-label={ar ? 'أقسام الاشتراكات' : 'Billing sections'}>
        {(
          [
            ['overview', 'نظرة عامة', 'Overview'],
            ['plans', 'كتالوج الباقات', 'Plans catalog'],
          ] as const
        ).map(([key, a, e]) => (
          <button
            key={key}
            className={tab === key ? 'active' : ''}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {ar ? a : e}
          </button>
        ))}
      </nav>
      {tab === 'overview' ? <BillingOverview lang={lang} /> : <PlansCatalog lang={lang} />}
    </div>
  );
}

function BillingOverview({ lang }: { lang: Language }) {
  const ar = lang === 'ar';
  const [data, setData] = useState<Overview | null>(null),
    [plans, setPlans] = useState<CatalogPlan[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    Promise.all([
      api<Overview>('/platform/billing/overview'),
      api<{ plans: CatalogPlan[] }>('/platform/plans'),
    ])
      .then(([o, p]) => {
        setData(o);
        setPlans(p.plans);
      })
      .catch((e) => setError(errorText(e, lang)));
  }, []);
  if (error)
    return (
      <p role="alert" className="notice error">
        {error}
      </p>
    );
  if (!data) return <p role="status">{ar ? 'بنحسب…' : 'Calculating…'}</p>;
  const name = (key: string) => {
    const p = plans.find((x) => x.key === key);
    return p ? (ar ? p.name_ar : p.name_en) : key;
  };
  const byCurrency = new Map<string, number>();
  for (const r of data.mrr)
    byCurrency.set(r.currency, (byCurrency.get(r.currency) || 0) + r.mrr_minor);
  return (
    <div className="plan-billing">
      <div className="kpi-grid">
        {[...byCurrency].map(([currency, minor]) => (
          <div className="kpi" key={currency}>
            <small>{ar ? 'الدخل الشهري المتكرر' : 'Monthly recurring revenue'}</small>
            <strong>
              <bdi>{money(minor, currency, lang)}</bdi>
            </strong>
          </div>
        ))}
        {data.byStatus.map((r) => (
          <div className="kpi" key={r.status}>
            <small>{statusLabel(r.status, lang)}</small>
            <strong>{r.merchants}</strong>
          </div>
        ))}
      </div>
      <p className="muted">
        {ar
          ? 'الدخل محسوب بالسعر المتفق عليه مع كل محل (الشغال والمتأخر وفترة السماح)، والسنوي مقسوم على 12، ومعاه الإضافات. التجربة المجانية مش محسوبة.'
          : 'Revenue uses each shop’s locked price (active, past due and grace), annual divided by 12, plus add-ons. Trials are not counted.'}
      </p>

      <section className="panel">
        <h3>{ar ? 'الدخل حسب الباقة' : 'Revenue by plan'}</h3>
        {data.mrr.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{ar ? 'الباقة' : 'Plan'}</th>
                  <th>{ar ? 'المحلات' : 'Shops'}</th>
                  <th>{ar ? 'في الشهر' : 'A month'}</th>
                </tr>
              </thead>
              <tbody>
                {data.mrr.map((r) => (
                  <tr key={r.plan + r.currency}>
                    <td>{name(r.plan)}</td>
                    <td>{r.merchants}</td>
                    <td>
                      <bdi>{money(r.mrr_minor, r.currency, lang)}</bdi>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">{ar ? 'مفيش محلات بتدفع لسه.' : 'No paying shops yet.'}</p>
        )}
      </section>

      <section className="panel">
        <h3>{ar ? 'متأخرين في الدفع' : 'Past due'}</h3>
        {data.pastDue.length ? (
          <ul className="list-plain">
            {data.pastDue.map((r) => (
              <li key={r.id} className="list-row">
                <div>
                  <strong>
                    <bdi>{r.name}</bdi>
                  </strong>
                  <small className="muted">
                    {name(r.plan)} · {statusLabel(r.status, lang)} ·{' '}
                    {(ar ? 'من ' : 'since ') + day(r.past_due_since, lang)}
                  </small>
                </div>
                <bdi>{money(r.price_minor, r.currency, lang)}</bdi>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{ar ? 'مفيش حد متأخر.' : 'Nobody is past due.'}</p>
        )}
      </section>

      <section className="panel">
        <h3>{ar ? 'تجديدات الأسبوع ده' : 'Renewals in the next 7 days'}</h3>
        {data.renewalsDue.length ? (
          <ul className="list-plain">
            {data.renewalsDue.map((r) => (
              <li key={r.id} className="list-row">
                <div>
                  <strong>
                    <bdi>{r.name}</bdi>
                  </strong>
                  <small className="muted">
                    {name(r.plan)} · {day(r.current_period_end, lang)}
                  </small>
                </div>
                <bdi>{money(r.price_minor, r.currency, lang)}</bdi>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{ar ? 'مفيش تجديدات الأسبوع ده.' : 'No renewals due this week.'}</p>
        )}
      </section>
    </div>
  );
}

type Draft = {
  nameAr: string;
  nameEn: string;
  isPublic: boolean;
  isActive: boolean;
  monthly: string;
  annual: string;
  setupFee: string;
  limits: Record<string, { unlimited: boolean; value: string }>;
  features: Record<string, boolean | string>;
  addons: Record<string, { price: string; maxTotal: string; isActive: boolean }>;
  applyPriceToExisting: boolean;
  reason: string;
};
const pounds = (minor: number | undefined) => (minor === undefined ? '' : String(minor / 100));
function toDraft(p: CatalogPlan): Draft {
  const price = (period: 'monthly' | 'annual') =>
    p.prices.find((x) => x.currency === 'EGP' && x.billingPeriod === period);
  const ent = (k: string) => p.entitlements.find((e) => e.key === k);
  return {
    nameAr: p.name_ar,
    nameEn: p.name_en,
    isPublic: p.is_public,
    isActive: p.is_active,
    monthly: pounds(price('monthly')?.amountMinor),
    annual: pounds(price('annual')?.amountMinor),
    setupFee: pounds(price('monthly')?.setupFeePerBranchMinor ?? 50000),
    limits: Object.fromEntries(
      limitKeys.map((k) => {
        const e = ent(k);
        return [
          k,
          { unlimited: e?.type === 'unlimited', value: e?.type === 'int' ? String(e.value) : '0' },
        ];
      }),
    ),
    features: Object.fromEntries([
      ...booleanFeatureKeys.map((k) => [k, ent(k)?.value === true]),
      ...Object.entries(enumFeatures).map(([k, values]) => [
        k,
        (ent(k)?.value as string) || values[0],
      ]),
    ]),
    addons: Object.fromEntries(
      (['extra_branch', 'extra_staff'] as const).map((k) => {
        const a = p.addons.find((x) => x.key === k && x.currency === 'EGP');
        return [
          k,
          {
            price: pounds(a?.unitAmountMinor),
            maxTotal: a?.maxTotal === null || a?.maxTotal === undefined ? '' : String(a.maxTotal),
            isActive: !!a?.isActive,
          },
        ];
      }),
    ),
    applyPriceToExisting: false,
    reason: '',
  };
}

function PlansCatalog({ lang }: { lang: Language }) {
  const ar = lang === 'ar';
  const [plans, setPlans] = useState<CatalogPlan[]>([]),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [editing, setEditing] = useState<CatalogPlan | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [confirm, setConfirm] = useState<{ merchants: number; paying_or_trial: number } | null>(null),
    [attemptKey, setAttemptKey] = useState(''),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState('');
  const load = async () => {
    try {
      setPlans((await api<{ plans: CatalogPlan[] }>('/platform/plans')).plans);
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const edit = (p: CatalogPlan) => {
    setEditing(p);
    setDraft(toDraft(p));
    setConfirm(null);
    setFormError('');
    setSuccess('');
    setAttemptKey(crypto.randomUUID());
  };
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const body = () => {
    if (!draft || !editing) return null;
    const minor = (v: string) => (v.trim() === '' ? null : moneyMinor(v));
    const prices = [];
    for (const [period, v] of [
      ['monthly', draft.monthly],
      ['annual', draft.annual],
    ] as const) {
      if (v.trim() === '') continue;
      const amount = minor(v),
        fee = minor(draft.setupFee);
      if (amount === null || fee === null) return null;
      prices.push({
        currency: 'EGP',
        billingPeriod: period,
        amountMinor: amount,
        setupFeePerBranchMinor: fee,
      });
    }
    // Other currencies are kept exactly as they are.
    for (const p of editing.prices.filter((x) => x.currency !== 'EGP')) prices.push(p);
    const entitlements: Record<string, unknown>[] = [];
    for (const k of limitKeys) {
      const l = draft.limits[k]!;
      if (l.unlimited) entitlements.push({ key: k, type: 'unlimited' });
      else {
        if (!/^\d{1,6}$/.test(l.value)) return null;
        entitlements.push({ key: k, type: 'int', value: Number(l.value) });
      }
    }
    for (const k of booleanFeatureKeys)
      entitlements.push({ key: k, type: 'bool', value: draft.features[k] === true });
    for (const k of Object.keys(enumFeatures))
      entitlements.push({ key: k, type: 'enum', value: draft.features[k] });
    const addons: Record<string, unknown>[] = [];
    for (const k of ['extra_branch', 'extra_staff'] as const) {
      const a = draft.addons[k]!;
      if (!a.isActive && a.price.trim() === '') continue;
      const unit = minor(a.price || '0');
      if (unit === null || (a.maxTotal !== '' && !/^\d{1,6}$/.test(a.maxTotal))) return null;
      addons.push({
        key: k,
        currency: 'EGP',
        unitAmountMinor: unit,
        maxTotal: a.maxTotal === '' ? null : Number(a.maxTotal),
        isActive: a.isActive,
      });
    }
    for (const a of editing.addons.filter((x) => x.currency !== 'EGP')) addons.push(a);
    return {
      nameAr: draft.nameAr,
      nameEn: draft.nameEn,
      isPublic: draft.isPublic,
      isActive: draft.isActive,
      prices,
      entitlements,
      addons,
      applyPriceToExisting: draft.applyPriceToExisting,
      reason: draft.reason,
    };
  };
  const review = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    if (!body()) {
      setFormError(
        ar
          ? 'راجع الأسعار والأرقام: الأسعار بالجنيه، والحدود أرقام صحيحة من غير كسور.'
          : 'Check the prices and numbers: prices in EGP, limits as whole numbers.',
      );
      return;
    }
    setFormError('');
    try {
      setConfirm(
        await api<{ merchants: number; paying_or_trial: number }>(
          '/platform/plans/' + editing.key + '/impact',
        ),
      );
    } catch (e) {
      setFormError(errorText(e, lang));
    }
  };
  const save = async () => {
    const payload = body();
    if (!editing || !payload) return;
    setBusy(true);
    try {
      const r = await api<{ affectedMerchants: number; repriced: number }>(
        '/platform/plans/' + editing.key,
        { method: 'PUT', body: payload, key: attemptKey, revision: editing.revision },
      );
      setEditing(null);
      setDraft(null);
      setConfirm(null);
      setSuccess(
        ar
          ? `اتحفظت الباقة. ${r.affectedMerchants} محل عليها${r.repriced ? `، و${r.repriced} اتغيّر سعرهم` : ''}.`
          : `Plan saved. ${r.affectedMerchants} shops on it${r.repriced ? `, ${r.repriced} repriced` : ''}.`,
      );
      await load();
    } catch (e) {
      setConfirm(null);
      setFormError(errorText(e, lang));
      if (!(e instanceof ApiError) || e.status !== 0) setAttemptKey(crypto.randomUUID());
    } finally {
      setBusy(false);
    }
  };

  if (error)
    return (
      <p role="alert" className="notice error">
        {error}
      </p>
    );
  if (editing && draft)
    return (
      <form className="panel plan-editor" onSubmit={review}>
        <h2>{ar ? `تعديل ${editing.name_ar}` : `Edit ${editing.name_en}`}</h2>
        <div className="form-grid">
          <label>
            {ar ? 'الاسم بالعربي' : 'Arabic name'}
            <input
              required
              maxLength={60}
              value={draft.nameAr}
              onChange={(e) => set({ nameAr: e.target.value })}
            />
          </label>
          <label>
            {ar ? 'الاسم بالإنجليزي' : 'English name'}
            <input
              dir="ltr"
              required
              maxLength={60}
              value={draft.nameEn}
              onChange={(e) => set({ nameEn: e.target.value })}
            />
          </label>
          <label>
            {ar ? 'السعر في الشهر (جنيه، من غير ضريبة)' : 'Monthly price (EGP, excl. VAT)'}
            <input
              dir="ltr"
              inputMode="decimal"
              value={draft.monthly}
              onChange={(e) => set({ monthly: e.target.value })}
            />
          </label>
          <label>
            {ar ? 'السعر في السنة (جنيه)' : 'Annual price (EGP)'}
            <input
              dir="ltr"
              inputMode="decimal"
              value={draft.annual}
              onChange={(e) => set({ annual: e.target.value })}
            />
          </label>
          <label>
            {ar ? 'رسوم التجهيز لكل فرع (جنيه)' : 'Setup fee per branch (EGP)'}
            <input
              dir="ltr"
              inputMode="decimal"
              value={draft.setupFee}
              onChange={(e) => set({ setupFee: e.target.value })}
            />
          </label>
        </div>
        <div className="plan-toggles">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.isPublic}
              onChange={(e) => set({ isPublic: e.target.checked })}
            />
            {ar ? 'ظاهرة في صفحة الأسعار' : 'Shown on the pricing page'}
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={(e) => set({ isActive: e.target.checked })}
            />
            {ar ? 'متاحة لمحلات جديدة' : 'Available to new shops'}
          </label>
        </div>

        <h3>{ar ? 'الحدود' : 'Limits'}</h3>
        <div className="form-grid">
          {limitKeys.map((k) => {
            const l = draft.limits[k]!;
            return (
              <fieldset key={k} className="limit-field">
                <legend>{limitLabel(k, lang)}</legend>
                <input
                  dir="ltr"
                  inputMode="numeric"
                  aria-label={limitLabel(k, lang)}
                  disabled={l.unlimited}
                  value={l.unlimited ? '' : l.value}
                  onChange={(e) =>
                    set({ limits: { ...draft.limits, [k]: { ...l, value: e.target.value } } })
                  }
                />
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={l.unlimited}
                    onChange={(e) =>
                      set({
                        limits: { ...draft.limits, [k]: { ...l, unlimited: e.target.checked } },
                      })
                    }
                  />
                  {ar ? 'مفتوح' : 'Unlimited'}
                </label>
              </fieldset>
            );
          })}
        </div>

        <h3>{ar ? 'المميزات' : 'Features'}</h3>
        <div className="feature-grid">
          {booleanFeatureKeys.map((k) => (
            <label className="checkbox-label" key={k}>
              <input
                type="checkbox"
                checked={draft.features[k] === true}
                onChange={(e) => set({ features: { ...draft.features, [k]: e.target.checked } })}
              />
              {featureLabel(k, lang)}
            </label>
          ))}
        </div>
        <div className="form-grid">
          {(Object.keys(enumFeatures) as (keyof typeof enumFeatures)[]).map((k) => (
            <label key={k}>
              {featureLabel(k, lang)}
              <Select
                value={String(draft.features[k])}
                onChange={(e) => set({ features: { ...draft.features, [k]: e.target.value } })}
              >
                {enumFeatures[k].map((v) => (
                  <option key={v} value={v}>
                    {levelLabel(v, lang)}
                  </option>
                ))}
              </Select>
            </label>
          ))}
        </div>

        <h3>{ar ? 'الإضافات' : 'Add-ons'}</h3>
        <div className="form-grid">
          {(['extra_branch', 'extra_staff'] as const).map((k) => {
            const a = draft.addons[k]!;
            const put = (patch: Partial<typeof a>) =>
              set({ addons: { ...draft.addons, [k]: { ...a, ...patch } } });
            return (
              <fieldset key={k} className="limit-field">
                <legend>{addonLabel(k, lang)}</legend>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={a.isActive}
                    onChange={(e) => put({ isActive: e.target.checked })}
                  />
                  {ar ? 'متاحة في الباقة' : 'Available on this plan'}
                </label>
                <label>
                  {ar ? 'السعر في الشهر (جنيه)' : 'Price a month (EGP)'}
                  <input
                    dir="ltr"
                    inputMode="decimal"
                    disabled={!a.isActive}
                    value={a.price}
                    onChange={(e) => put({ price: e.target.value })}
                  />
                </label>
                <label>
                  {ar ? 'أقصى إجمالي (فاضي = من غير حد)' : 'Maximum total (empty = none)'}
                  <input
                    dir="ltr"
                    inputMode="numeric"
                    disabled={!a.isActive}
                    value={a.maxTotal}
                    onChange={(e) => put({ maxTotal: e.target.value })}
                  />
                </label>
              </fieldset>
            );
          })}
        </div>

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={draft.applyPriceToExisting}
            onChange={(e) => set({ applyPriceToExisting: e.target.checked })}
          />
          {ar
            ? 'طبّق السعر الجديد على المحلات اللي على الباقة دلوقتي كمان'
            : 'Also apply the new price to shops already on this plan'}
        </label>
        <p className="muted">
          {ar
            ? 'من غير العلامة دي، المحلات الحالية بتفضل على سعرها القديم. المحلات الجديدة بس هي اللي بتاخد السعر الجديد.'
            : 'Without this, current shops keep their old price. Only new shops get the new price.'}
        </p>
        <label>
          {ar ? 'سبب التعديل' : 'Reason for the change'}
          <textarea
            required
            minLength={4}
            maxLength={500}
            value={draft.reason}
            onChange={(e) => set({ reason: e.target.value })}
          />
        </label>
        {formError && (
          <p role="alert" className="notice error">
            {formError}
          </p>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              setEditing(null);
              setDraft(null);
            }}
          >
            {ar ? 'رجوع' : 'Go back'}
          </button>
          <button className="primary" disabled={busy}>
            {ar ? 'راجع وحفظ' : 'Review and save'}
          </button>
        </div>
        {confirm && (
          <div className="modal-backdrop">
            <section
              className="dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="plan-confirm-title"
            >
              <h2 id="plan-confirm-title">{ar ? 'قبل ما تحفظ' : 'Before you save'}</h2>
              <p>
                {ar
                  ? `الباقة دي عليها ${confirm.merchants} محل (${confirm.paying_or_trial} منهم شغالين أو في تجربة).`
                  : `${confirm.merchants} shops are on this plan (${confirm.paying_or_trial} active or on trial).`}
              </p>
              <ul className="confirm-list">
                <li>
                  {draft.applyPriceToExisting
                    ? ar
                      ? 'السعر الجديد هيتطبق عليهم من دلوقتي.'
                      : 'The new price applies to them now.'
                    : ar
                      ? 'سعرهم مش هيتغيّر.'
                      : 'Their price does not change.'}
                </li>
                <li>
                  {ar
                    ? 'لو قللت حد، اللي زيادة عندهم هيتقفل فورًا ومش هيتمسح. لو زودته، اللي كان مقفول هيرجع.'
                    : 'Lowering a limit locks anything over it right away, without deleting it. Raising it unlocks.'}
                </li>
              </ul>
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary"
                  data-dialog-close
                  disabled={busy}
                  onClick={() => setConfirm(null)}
                >
                  {ar ? 'رجوع' : 'Go back'}
                </button>
                <button type="button" className="primary" disabled={busy} onClick={save}>
                  {busy ? (ar ? 'بنحفظ…' : 'Saving…') : ar ? 'احفظ الباقة' : 'Save plan'}
                </button>
              </div>
            </section>
          </div>
        )}
      </form>
    );

  return (
    <div className="plan-billing">
      {success && (
        <p role="status" className="notice success">
          {success}
        </p>
      )}
      <div className="plan-catalog">
        {plans.map((p) => {
          const monthly = p.prices.find(
            (x) => x.currency === 'EGP' && x.billingPeriod === 'monthly',
          );
          const lim = (k: string) => {
            const e = p.entitlements.find((x) => x.key === k);
            return e?.type === 'unlimited' ? (ar ? 'مفتوح' : '∞') : String(e?.value ?? '—');
          };
          return (
            <article className="panel plan-card-admin" key={p.key}>
              <div className="plan-summary-head">
                <div>
                  <strong className="plan-name">{ar ? p.name_ar : p.name_en}</strong>
                  {!p.is_public && (
                    <span className="status-pill warning">{ar ? 'مخفية' : 'Hidden'}</span>
                  )}
                  {!p.is_active && (
                    <span className="status-pill danger">{ar ? 'متوقفة' : 'Inactive'}</span>
                  )}
                </div>
                <div className="plan-price">
                  <bdi>
                    {monthly ? money(monthly.amountMinor, 'EGP', lang) : ar ? 'بالاتفاق' : 'Custom'}
                  </bdi>
                  {monthly && <small className="muted">{ar ? 'في الشهر' : 'a month'}</small>}
                </div>
              </div>
              <ul className="plan-limits">
                {limitKeys.map((k) => (
                  <li key={k}>
                    <span>{limitLabel(k, lang)}</span>
                    <bdi>{lim(k)}</bdi>
                  </li>
                ))}
              </ul>
              <div className="plan-card-foot">
                <small className="muted">
                  {ar ? `${p.merchants} محل عليها` : `${p.merchants} shops`}
                </small>
                <button className="secondary small" onClick={() => edit(p)}>
                  {ar ? 'عدّل' : 'Edit'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
