import { WhyDisabled } from '../controls/WhyDisabled.js';
import { useEffect, useState, type FormEvent } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import {
  booleanFeatureKeys,
  enumFeatures,
  limitKeys,
  type EffectiveEntitlements,
} from '../../../../packages/contracts/src/entitlements.js';
import { moneyMinor } from '../../../../packages/domain/src/subscriptions.js';
import { api, ApiError, errorText } from '../api.js';
import { Select } from '../controls/Select.js';
import {
  addonLabel,
  day,
  eventLabel,
  featureLabel,
  levelLabel,
  limitLabel,
  money,
  statusLabel,
} from './billing-labels.js';

export interface CatalogPlan {
  key: string;
  name_ar: string;
  name_en: string;
  sort_order: number;
  is_public: boolean;
  is_active: boolean;
  is_custom: boolean;
  revision: number;
  merchants: number;
  prices: {
    currency: string;
    billingPeriod: 'monthly' | 'annual';
    amountMinor: number;
    setupFeePerBranchMinor: number;
  }[];
  entitlements: { key: string; type: string; value: number | boolean | string | null }[];
  addons: {
    key: 'extra_branch' | 'extra_staff';
    currency: string;
    unitAmountMinor: number;
    maxTotal: number | null;
    isActive: boolean;
  }[];
}
interface BillingState {
  subscription: {
    plan: string;
    status: string;
    currency: string;
    billingPeriod: 'monthly' | 'annual';
    priceMinor: number;
    trialEndsAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    pendingPlan: string | null;
    pendingEffectiveAt: string | null;
    pastDueSince: string | null;
    revision: number;
  };
  entitlements: EffectiveEntitlements;
  addons: { key: string; quantity: number; unit_amount_minor: number }[];
  overrides: {
    id: string;
    key: string;
    value_type: string;
    int_value: number | null;
    bool_value: boolean | null;
    enum_value: string | null;
    reason: string;
    expires_at: string | null;
    created_at: string;
    revoked_at: string | null;
    active: boolean;
    created_by_name: string | null;
  }[];
  events: {
    id: string;
    event_type: string;
    reason: string | null;
    created_at: string;
    actor_name: string | null;
  }[];
  locked: { kind: 'branch' | 'program' | 'staff'; id: string; name: string; locked_at: string }[];
  requests: {
    id: string;
    kind: 'change_plan' | 'addon';
    plan_key: string | null;
    billing_period: string | null;
    addon_key: string | null;
    quantity: number | null;
    note: string | null;
    status: string;
    created_at: string;
    requested_by_name: string | null;
  }[];
}
type Action =
  | { kind: 'plan' }
  | { kind: 'addon'; key: 'extra_branch' | 'extra_staff' }
  | { kind: 'override' }
  | { kind: 'revoke'; id: string; label: string }
  | { kind: 'trial' }
  | { kind: 'cancel' }
  | { kind: 'reactivate' }
  | { kind: 'price' }
  | { kind: 'approve'; id: string; label: string }
  | { kind: 'decline'; id: string; label: string };

const overrideKeys = [...limitKeys, ...booleanFeatureKeys, ...Object.keys(enumFeatures)];
const isLimit = (k: string) => (limitKeys as readonly string[]).includes(k);
const isEnum = (k: string): k is keyof typeof enumFeatures => k in enumFeatures;
const durations = [0, 7, 30, 90, 180, 365] as const;

/** Super Admin: one merchant's plan, usage, add-ons, overrides and history. */
export function PlanBilling({ merchantId, lang }: { merchantId: string; lang: Language }) {
  const ar = lang === 'ar';
  const [data, setData] = useState<BillingState | null>(null),
    [plans, setPlans] = useState<CatalogPlan[]>([]),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [busy, setBusy] = useState(false),
    [action, setAction] = useState<Action | null>(null),
    [attemptKey, setAttemptKey] = useState(''),
    [dialogError, setDialogError] = useState('');
  // Dialog fields
  const [reason, setReason] = useState(''),
    [planKey, setPlanKey] = useState('growth'),
    [period, setPeriod] = useState<'monthly' | 'annual'>('monthly'),
    [when, setWhen] = useState<'now' | 'period_end'>('period_end'),
    [quantity, setQuantity] = useState(0),
    [oKey, setOKey] = useState<string>('max_branches'),
    [oNumber, setONumber] = useState('25'),
    [oUnlimited, setOUnlimited] = useState(false),
    [oBool, setOBool] = useState(true),
    [oEnum, setOEnum] = useState(''),
    [oDays, setODays] = useState(0),
    [trialDays, setTrialDays] = useState(14),
    [cancelNow, setCancelNow] = useState(false),
    [price, setPrice] = useState('');
  const base = '/platform/merchants/' + merchantId + '/billing';
  const load = async () => {
    try {
      const [state, catalog] = await Promise.all([
        api<BillingState>(base),
        api<{ plans: CatalogPlan[] }>('/platform/plans'),
      ]);
      setData(state);
      setPlans(catalog.plans);
      setError('');
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void load();
  }, [merchantId]);

  const planName = (key: string | null) => {
    const p = plans.find((x) => x.key === key);
    return p ? (ar ? p.name_ar : p.name_en) : key || '—';
  };
  const open = (next: Action) => {
    if (!data) return;
    const s = data.subscription;
    setAction(next);
    setAttemptKey(crypto.randomUUID());
    setDialogError('');
    setReason('');
    setSuccess('');
    if (next.kind === 'plan') {
      setPlanKey(s.plan === 'growth' ? 'pro' : 'growth');
      setPeriod(s.billingPeriod);
      setWhen(s.currentPeriodEnd ? 'period_end' : 'now');
    }
    if (next.kind === 'addon')
      setQuantity(data.addons.find((a) => a.key === next.key)?.quantity || 0);
    if (next.kind === 'override') {
      setOKey('max_branches');
      setONumber('25');
      setOUnlimited(false);
      setOBool(true);
      setOEnum('');
      setODays(0);
    }
    if (next.kind === 'trial') {
      setPlanKey('growth');
      setTrialDays(14);
    }
    if (next.kind === 'cancel') setCancelNow(false);
    if (next.kind === 'price') setPrice((s.priceMinor / 100).toFixed(0));
  };
  const overrideValue = () => {
    if (isLimit(oKey))
      return oUnlimited
        ? { key: oKey, type: 'unlimited' }
        : { key: oKey, type: 'int', value: Number(oNumber) };
    if (isEnum(oKey)) return { key: oKey, type: 'enum', value: oEnum || enumFeatures[oKey][0] };
    return { key: oKey, type: 'bool', value: oBool };
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!data || !action) return;
    let path = '',
      method: 'POST' | 'PUT' = 'POST',
      body: Record<string, unknown> = { reason };
    switch (action.kind) {
      case 'plan':
        path = '/plan';
        body = { plan: planKey, billingPeriod: period, effective: when, reason };
        break;
      case 'addon':
        path = '/addons/' + action.key;
        method = 'PUT';
        body = { quantity, reason };
        break;
      case 'override':
        if (isLimit(oKey) && !oUnlimited && !/^\d{1,6}$/.test(oNumber)) {
          setDialogError(ar ? 'اكتب رقم صحيح من غير كسور.' : 'Enter a whole number.');
          return;
        }
        path = '/overrides';
        body = {
          value: overrideValue(),
          expiresAt: oDays ? new Date(Date.now() + oDays * 86400000).toISOString() : null,
          reason,
        };
        break;
      case 'revoke':
        path = '/overrides/' + action.id + '/revoke';
        break;
      case 'trial':
        path = '/trial';
        body = { plan: planKey, days: trialDays, reason };
        break;
      case 'cancel':
        path = '/cancel';
        body = { atPeriodEnd: !cancelNow, reason };
        break;
      case 'reactivate':
        path = '/reactivate';
        break;
      case 'approve':
        path = '/requests/' + action.id + '/approve';
        break;
      case 'decline':
        path = '/requests/' + action.id + '/decline';
        break;
      case 'price': {
        const minor = moneyMinor(price);
        if (minor === null) {
          setDialogError(ar ? 'اكتب المبلغ بالجنيه.' : 'Enter the amount in EGP.');
          return;
        }
        path = '/price';
        body = { priceMinor: minor, reason };
      }
    }
    setBusy(true);
    setDialogError('');
    try {
      const result = await api<{
        billing?: BillingState;
        result?: { locked: unknown[]; unlocked: unknown[] };
      }>(base + path, { method, body, key: attemptKey, revision: data.subscription.revision });
      setAction(null);
      const moved = result.result ? result.result.locked.length + result.result.unlocked.length : 0;
      setSuccess(
        (ar ? 'اتحفظ التغيير واتسجل في السجل.' : 'Saved and added to the history.') +
          (moved
            ? ar
              ? ' بعض الفروع أو البرامج أو الموظفين اتقفلت أو اتفتحت حسب الباقة.'
              : ' Some branches, programs or staff were locked or unlocked for the plan.'
            : ''),
      );
      await load();
    } catch (e) {
      setDialogError(errorText(e, lang));
      // A dropped connection keeps the same key so a retry cannot apply twice.
      if (!(e instanceof ApiError) || e.status !== 0) {
        setAttemptKey(crypto.randomUUID());
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  if (!data)
    return error ? (
      <p role="alert" className="notice error">
        {error}
      </p>
    ) : (
      <p role="status">{ar ? 'بنفتح الباقة…' : 'Loading plan…'}</p>
    );
  const s = data.subscription,
    e = data.entitlements;
  const selected = plans.find((p) => p.key === planKey);
  const selectedPrice = selected?.prices.find(
    (p) => p.currency === s.currency && p.billingPeriod === period,
  );
  const addonCatalog = plans.find((p) => p.key === s.plan)?.addons.filter((a) => a.isActive) || [];
  const tone =
    s.status === 'active' || s.status === 'trialing'
      ? 'success'
      : s.status === 'past_due' || s.status === 'grace'
        ? 'warning'
        : 'danger';

  return (
    <section className="plan-billing">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{ar ? 'الباقة' : 'PLAN'}</span>
          <h2>{ar ? 'الباقة والحدود' : 'Plan and limits'}</h2>
        </div>
        <button className="primary" disabled={busy} onClick={() => open({ kind: 'plan' })}>
          {ar ? 'غيّر الباقة' : 'Change plan'}
        </button>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="notice success">
          {success}
        </p>
      )}

      {data.requests
        .filter((r) => r.status === 'open')
        .map((r) => {
          const label =
            r.kind === 'addon'
              ? addonLabel(r.addon_key || '', lang) + ' × ' + r.quantity
              : (ar ? 'باقة ' : 'Plan ') +
                planName(r.plan_key) +
                ' · ' +
                (r.billing_period === 'annual'
                  ? ar
                    ? 'سنوي'
                    : 'annual'
                  : ar
                    ? 'شهري'
                    : 'monthly');
          return (
            <div className="panel plan-request open" key={r.id}>
              <strong>{ar ? 'طلب من صاحب المحل' : 'Request from the owner'}</strong>
              <p>
                {label}
                <small className="muted">
                  {' '}
                  · {day(r.created_at, lang)} · {r.requested_by_name}
                </small>
              </p>
              {r.note && <p className="muted">«{r.note}»</p>}
              <div className="plan-actions">
                <button
                  className="primary small"
                  disabled={busy}
                  onClick={() => open({ kind: 'approve', id: r.id, label })}
                >
                  {ar ? 'وافق ونفّذ' : 'Approve and apply'}
                </button>
                <button
                  className="secondary small"
                  disabled={busy}
                  onClick={() => open({ kind: 'decline', id: r.id, label })}
                >
                  {ar ? 'ارفض' : 'Decline'}
                </button>
              </div>
            </div>
          );
        })}

      <div className="panel plan-summary">
        <div className="plan-summary-head">
          <div>
            <strong className="plan-name">{planName(s.plan)}</strong>
            <span className={'status-pill ' + tone}>{statusLabel(s.status, lang)}</span>
          </div>
          <div className="plan-price">
            <bdi>{money(s.priceMinor, s.currency, lang)}</bdi>
            <small className="muted">
              {s.billingPeriod === 'annual'
                ? ar
                  ? 'في السنة'
                  : 'a year'
                : ar
                  ? 'في الشهر'
                  : 'a month'}
            </small>
          </div>
        </div>
        <dl className="plan-facts">
          {s.status === 'trialing' && (
            <div>
              <dt>{ar ? 'التجربة بتخلص' : 'Trial ends'}</dt>
              <dd>{day(s.trialEndsAt, lang)}</dd>
            </div>
          )}
          <div>
            <dt>{ar ? 'الفترة الحالية' : 'Current period'}</dt>
            <dd>
              <bdi>
                {day(s.currentPeriodStart, lang)} – {day(s.currentPeriodEnd, lang)}
              </bdi>
            </dd>
          </div>
          {s.pastDueSince && (
            <div>
              <dt>{ar ? 'متأخر من' : 'Past due since'}</dt>
              <dd>{day(s.pastDueSince, lang)}</dd>
            </div>
          )}
        </dl>
        {s.pendingPlan && (
          <p className="notice">
            {ar
              ? `هتنزل لباقة ${planName(s.pendingPlan)} يوم ${day(s.pendingEffectiveAt, lang)}. اللي زيادة هيتقفل ومش هيتمسح.`
              : `Moves to ${planName(s.pendingPlan)} on ${day(s.pendingEffectiveAt, lang)}. Anything over the limit is locked, never deleted.`}
          </p>
        )}
        {s.cancelAtPeriodEnd && (
          <p className="notice warning">
            {ar
              ? `الاشتراك هيتلغي يوم ${day(s.currentPeriodEnd, lang)}.`
              : `The subscription ends on ${day(s.currentPeriodEnd, lang)}.`}
          </p>
        )}
        <div className="plan-actions">
          {addonCatalog.map((a) => (
            <button
              key={a.key}
              className="secondary small"
              disabled={busy}
              onClick={() => open({ kind: 'addon', key: a.key })}
            >
              {addonLabel(a.key, lang)}
            </button>
          ))}
          <button
            className="secondary small"
            disabled={busy}
            onClick={() => open({ kind: 'override' })}
          >
            {ar ? 'استثناء' : 'Override'}
          </button>
          <button
            className="secondary small"
            disabled={busy}
            onClick={() => open({ kind: 'trial' })}
          >
            {ar ? 'تجربة مجانية' : 'Trial'}
          </button>
          <button
            className="secondary small"
            disabled={busy}
            onClick={() => open({ kind: 'price' })}
          >
            {ar ? 'سعر متفق عليه' : 'Agreed price'}
          </button>
          {s.cancelAtPeriodEnd || s.status === 'cancelled' ? (
            <button
              className="secondary small"
              disabled={busy}
              onClick={() => open({ kind: 'reactivate' })}
            >
              {ar ? 'رجّع الاشتراك' : 'Reactivate'}
            </button>
          ) : (
            <button
              className="danger small"
              disabled={busy}
              onClick={() => open({ kind: 'cancel' })}
            >
              {ar ? 'إلغاء الاشتراك' : 'Cancel'}
            </button>
          )}
        </div>
      </div>

      <div className="panel">
        <h3>{ar ? 'الاستخدام' : 'Usage'}</h3>
        <ul className="usage-meters">
          {limitKeys.map((k) => {
            const limit = e.limits[k],
              used = e.usage[k] || 0;
            const ratio = limit === null ? 0 : limit === 0 ? 1 : Math.min(used / limit, 1),
              over = limit !== null && used > limit;
            return (
              <li key={k}>
                <div className="usage-label">
                  <span>{limitLabel(k, lang)}</span>
                  <bdi>
                    {limit === null
                      ? ar
                        ? `${used} · من غير حد`
                        : `${used} · unlimited`
                      : ar
                        ? `${used} من ${limit}`
                        : `${used} of ${limit}`}
                  </bdi>
                </div>
                <div
                  className={'usage-bar' + (over ? ' full' : ratio >= 0.8 ? ' near' : '')}
                  role="progressbar"
                  aria-label={limitLabel(k, lang)}
                  aria-valuemin={0}
                  aria-valuemax={limit ?? used}
                  aria-valuenow={used}
                >
                  <span style={{ inlineSize: (limit === null ? 0 : ratio * 100) + '%' }} />
                </div>
              </li>
            );
          })}
        </ul>
        <details className="plan-features">
          <summary>{ar ? 'المميزات' : 'Features'}</summary>
          <ul>
            {Object.entries(e.features).map(([k, v]) => (
              <li key={k}>
                <span>{featureLabel(k, lang)}</span>
                <strong>
                  {typeof v === 'boolean'
                    ? v
                      ? ar
                        ? 'متاح'
                        : 'On'
                      : ar
                        ? 'مش متاح'
                        : 'Off'
                    : levelLabel(v, lang)}
                </strong>
              </li>
            ))}
          </ul>
        </details>
      </div>

      {data.locked.length > 0 && (
        <div className="panel">
          <h3>{ar ? 'مقفول بسبب الباقة' : 'Locked by the plan'}</h3>
          <p className="muted">
            {ar
              ? 'دول محفوظين زي ما هم. بيرجعوا يشتغلوا أول ما الباقة تسمح.'
              : 'Kept exactly as they were. They come back as soon as the plan allows.'}
          </p>
          <ul className="locked-list">
            {data.locked.map((x) => (
              <li key={x.kind + x.id}>
                <span className="badge">
                  {x.kind === 'branch'
                    ? ar
                      ? 'فرع'
                      : 'Branch'
                    : x.kind === 'program'
                      ? ar
                        ? 'برنامج'
                        : 'Program'
                      : ar
                        ? 'موظف'
                        : 'Staff'}
                </span>
                <bdi>{x.name}</bdi>
                <small className="muted">{day(x.locked_at, lang)}</small>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(data.addons.some((a) => a.quantity > 0) || data.overrides.some((o) => o.active)) && (
        <div className="panel">
          <h3>{ar ? 'الإضافات والاستثناءات' : 'Add-ons and overrides'}</h3>
          <ul className="list-plain">
            {data.addons
              .filter((a) => a.quantity > 0)
              .map((a) => (
                <li key={a.key} className="list-row">
                  <div>
                    <strong>
                      {addonLabel(a.key, lang)} × <bdi>{a.quantity}</bdi>
                    </strong>
                    <small className="muted">
                      <bdi>{money(a.unit_amount_minor, s.currency, lang)}</bdi>{' '}
                      {ar ? 'للواحد في الشهر' : 'each a month'}
                    </small>
                  </div>
                </li>
              ))}
            {data.overrides
              .filter((o) => o.active)
              .map((o) => {
                const value =
                  o.value_type === 'unlimited'
                    ? ar
                      ? 'مفتوح'
                      : 'Unlimited'
                    : o.value_type === 'int'
                      ? String(o.int_value)
                      : o.value_type === 'bool'
                        ? o.bool_value
                          ? ar
                            ? 'متاح'
                            : 'On'
                          : ar
                            ? 'مش متاح'
                            : 'Off'
                        : levelLabel(o.enum_value || '', lang);
                const label =
                  (isLimit(o.key) ? limitLabel(o.key, lang) : featureLabel(o.key, lang)) +
                  ': ' +
                  value;
                return (
                  <li key={o.id} className="list-row">
                    <div>
                      <strong>{label}</strong>
                      <small className="muted">
                        {o.reason} ·{' '}
                        {o.expires_at
                          ? (ar ? 'لحد ' : 'until ') + day(o.expires_at, lang)
                          : ar
                            ? 'من غير ميعاد'
                            : 'no end date'}
                      </small>
                    </div>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => open({ kind: 'revoke', id: o.id, label })}
                    >
                      {ar ? 'شيله' : 'Remove'}
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      <details className="panel billing-history">
        <summary>
          <h3>{ar ? 'سجل التغييرات' : 'Change history'}</h3>
        </summary>
        {data.events.length ? (
          <ol className="timeline">
            {data.events.map((ev) => (
              <li key={ev.id}>
                <strong>{eventLabel(ev.event_type, lang)}</strong>
                <small className="muted">
                  {day(ev.created_at, lang)} · {ev.actor_name || (ar ? 'النظام' : 'System')}
                </small>
                {ev.reason && <p>{ev.reason}</p>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">{ar ? 'مفيش تغييرات لسه.' : 'No changes yet.'}</p>
        )}
      </details>

      {action && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="billing-action-title"
            onSubmit={submit}
          >
            <h2 id="billing-action-title">
              {action.kind === 'plan'
                ? ar
                  ? 'تغيير الباقة'
                  : 'Change plan'
                : action.kind === 'addon'
                  ? addonLabel(action.key, lang)
                  : action.kind === 'override'
                    ? ar
                      ? 'استثناء لحد أو ميزة'
                      : 'Override a limit or feature'
                    : action.kind === 'approve'
                      ? ar
                        ? 'الموافقة على الطلب'
                        : 'Approve request'
                      : action.kind === 'decline'
                        ? ar
                          ? 'رفض الطلب'
                          : 'Decline request'
                        : action.kind === 'revoke'
                          ? ar
                            ? 'شيل الاستثناء'
                            : 'Remove override'
                          : action.kind === 'trial'
                            ? ar
                              ? 'تجربة مجانية'
                              : 'Free trial'
                            : action.kind === 'cancel'
                              ? ar
                                ? 'إلغاء الاشتراك'
                                : 'Cancel subscription'
                              : action.kind === 'reactivate'
                                ? ar
                                  ? 'رجّع الاشتراك'
                                  : 'Reactivate subscription'
                                : ar
                                  ? 'سعر متفق عليه'
                                  : 'Agreed price'}
            </h2>

            {action.kind === 'plan' && (
              <>
                <div className="form-grid">
                  <label>
                    {ar ? 'الباقة' : 'Plan'}
                    <Select value={planKey} onChange={(x) => setPlanKey(x.target.value)}>
                      {plans
                        .filter((p) => p.is_active && p.key !== 'legacy')
                        .map((p) => (
                          <option key={p.key} value={p.key}>
                            {ar ? p.name_ar : p.name_en}
                          </option>
                        ))}
                    </Select>
                  </label>
                  <label>
                    {ar ? 'المدة' : 'Billing'}
                    <Select
                      value={period}
                      onChange={(x) => setPeriod(x.target.value as 'monthly' | 'annual')}
                    >
                      <option value="monthly">{ar ? 'شهري' : 'Monthly'}</option>
                      <option value="annual">{ar ? 'سنوي' : 'Annual'}</option>
                    </Select>
                  </label>
                </div>
                <fieldset className="choice-group">
                  <legend>{ar ? 'امتى؟' : 'When?'}</legend>
                  <label className="checkbox-label">
                    <input
                      type="radio"
                      name="when"
                      checked={when === 'now'}
                      onChange={() => setWhen('now')}
                    />
                    {ar ? 'دلوقتي (للترقية عادةً)' : 'Now (usually for upgrades)'}
                  </label>
                  <label className="checkbox-label">
                    <input
                      type="radio"
                      name="when"
                      checked={when === 'period_end'}
                      disabled={!s.currentPeriodEnd}
                      onChange={() => setWhen('period_end')}
                    />
                    {ar
                      ? `يوم التجديد ${day(s.currentPeriodEnd, lang)} (للتخفيض)`
                      : `On renewal ${day(s.currentPeriodEnd, lang)} (for downgrades)`}
                  </label>
                  <WhyDisabled>
                    {!s.currentPeriodEnd &&
                      (ar
                        ? 'الاشتراك ده مالوش تاريخ تجديد، فالتغيير هيبقى من دلوقتي.'
                        : 'This subscription has no renewal date, so the change applies now.')}
                  </WhyDisabled>
                </fieldset>
                <p className="muted">
                  {selectedPrice
                    ? (ar ? 'السعر الجديد: ' : 'New price: ') +
                      money(selectedPrice.amountMinor, selectedPrice.currency, lang) +
                      (period === 'annual'
                        ? ar
                          ? ' في السنة'
                          : ' a year'
                        : ar
                          ? ' في الشهر'
                          : ' a month')
                    : ar
                      ? 'الباقة دي ملهاش سعر للمدة دي. حط سعر متفق عليه بعد التغيير.'
                      : 'This plan has no price for that period. Set an agreed price after the change.'}
                </p>
                <p className="muted">
                  {ar
                    ? 'لو المحل بيستخدم أكتر من الباقة الجديدة، الزيادة بتتقفل ومفيش حاجة بتتمسح.'
                    : 'If the shop uses more than the new plan allows, the extra is locked; nothing is deleted.'}
                </p>
              </>
            )}

            {action.kind === 'addon' && (
              <>
                <label>
                  {ar ? 'العدد' : 'Quantity'}
                  <input
                    type="number"
                    dir="ltr"
                    min={0}
                    max={1000}
                    value={quantity}
                    onChange={(x) =>
                      setQuantity(Math.max(0, Math.floor(Number(x.target.value) || 0)))
                    }
                  />
                </label>
                {(() => {
                  const a = addonCatalog.find((x) => x.key === action.key);
                  return a ? (
                    <p className="muted">
                      <bdi>{money(a.unitAmountMinor, a.currency, lang)}</bdi>{' '}
                      {ar ? 'للواحد في الشهر' : 'each a month'}
                      {a.maxTotal !== null &&
                        (ar
                          ? ` · أقصى إجمالي ${a.maxTotal} مع الباقة`
                          : ` · at most ${a.maxTotal} in total with the plan`)}
                    </p>
                  ) : null;
                })()}
              </>
            )}

            {action.kind === 'override' && (
              <>
                <label>
                  {ar ? 'الحد أو الميزة' : 'Limit or feature'}
                  <Select
                    value={oKey}
                    onChange={(x) => {
                      setOKey(x.target.value);
                      setOEnum('');
                    }}
                  >
                    {overrideKeys.map((k) => (
                      <option key={k} value={k}>
                        {isLimit(k) ? limitLabel(k, lang) : featureLabel(k, lang)}
                      </option>
                    ))}
                  </Select>
                </label>
                {isLimit(oKey) ? (
                  <>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={oUnlimited}
                        onChange={(x) => setOUnlimited(x.target.checked)}
                      />
                      {ar ? 'مفتوح من غير حد' : 'Unlimited'}
                    </label>
                    {!oUnlimited && (
                      <label>
                        {ar ? 'الحد الجديد' : 'New limit'}
                        <input
                          dir="ltr"
                          inputMode="numeric"
                          required
                          value={oNumber}
                          onChange={(x) => setONumber(x.target.value)}
                        />
                      </label>
                    )}
                  </>
                ) : isEnum(oKey) ? (
                  <label>
                    {ar ? 'المستوى' : 'Level'}
                    <Select
                      value={oEnum || enumFeatures[oKey][0]}
                      onChange={(x) => setOEnum(x.target.value)}
                    >
                      {enumFeatures[oKey].map((v) => (
                        <option key={v} value={v}>
                          {levelLabel(v, lang)}
                        </option>
                      ))}
                    </Select>
                  </label>
                ) : (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={oBool}
                      onChange={(x) => setOBool(x.target.checked)}
                    />
                    {ar ? 'متاح' : 'Enabled'}
                  </label>
                )}
                <label>
                  {ar ? 'لمدة' : 'For'}
                  <Select value={String(oDays)} onChange={(x) => setODays(Number(x.target.value))}>
                    {durations.map((d) => (
                      <option key={d} value={d}>
                        {d === 0
                          ? ar
                            ? 'من غير ميعاد انتهاء'
                            : 'No end date'
                          : d === 7
                            ? ar
                              ? 'أسبوع'
                              : 'One week'
                            : d === 365
                              ? ar
                                ? 'سنة'
                                : 'One year'
                              : ar
                                ? d === 30
                                  ? 'شهر'
                                  : d / 30 + ' شهور'
                                : d / 30 + (d === 30 ? ' month' : ' months')}
                      </option>
                    ))}
                  </Select>
                </label>
                <p className="muted">
                  {ar
                    ? 'الاستثناء بيحل محل حد الباقة والإضافات للمفتاح ده لحد ما يخلص أو تشيله.'
                    : 'The override replaces the plan and add-ons for this key until it ends or you remove it.'}
                </p>
              </>
            )}

            {action.kind === 'revoke' && <p>{action.label}</p>}
            {action.kind === 'approve' && (
              <>
                <p>{action.label}</p>
                <p className="muted">
                  {ar
                    ? 'الترقية بتتطبق دلوقتي، والتخفيض يوم التجديد. سجّل الدفعة من قسم المدفوعات تحت.'
                    : 'Upgrades apply now, downgrades on the renewal date. Record the payment in Payments below.'}
                </p>
              </>
            )}
            {action.kind === 'decline' && (
              <>
                <p>{action.label}</p>
                <p className="muted">
                  {ar ? 'السبب بيظهر لصاحب المحل.' : 'The owner sees the reason.'}
                </p>
              </>
            )}

            {action.kind === 'trial' && (
              <div className="form-grid">
                <label>
                  {ar ? 'الباقة' : 'Plan'}
                  <Select value={planKey} onChange={(x) => setPlanKey(x.target.value)}>
                    {plans
                      .filter((p) => p.is_active && p.is_public)
                      .map((p) => (
                        <option key={p.key} value={p.key}>
                          {ar ? p.name_ar : p.name_en}
                        </option>
                      ))}
                  </Select>
                </label>
                <label>
                  {ar ? 'عدد الأيام' : 'Days'}
                  <input
                    type="number"
                    dir="ltr"
                    min={1}
                    max={60}
                    value={trialDays}
                    onChange={(x) =>
                      setTrialDays(
                        Math.min(60, Math.max(1, Math.floor(Number(x.target.value) || 1))),
                      )
                    }
                  />
                </label>
              </div>
            )}

            {action.kind === 'cancel' && (
              <>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={cancelNow}
                    onChange={(x) => setCancelNow(x.target.checked)}
                  />
                  {ar ? 'ألغيه دلوقتي بدل آخر الفترة' : 'Cancel now instead of at period end'}
                </label>
                <p className="muted">
                  {ar
                    ? 'بعد الإلغاء المحل يقدر يشوف بياناته وينزّل CSV لمدة 30 يوم. الكروت والمكافآت بتفضل محفوظة.'
                    : 'After cancelling, the shop can view and export its data for 30 days. Cards and rewards are kept.'}
                </p>
              </>
            )}

            {action.kind === 'price' && (
              <>
                <label>
                  {s.billingPeriod === 'annual'
                    ? ar
                      ? 'السعر في السنة بالجنيه'
                      : 'Price a year in EGP'
                    : ar
                      ? 'السعر في الشهر بالجنيه'
                      : 'Price a month in EGP'}
                  <input
                    dir="ltr"
                    inputMode="decimal"
                    required
                    value={price}
                    onChange={(x) => setPrice(x.target.value)}
                  />
                </label>
                <p className="muted">
                  {ar
                    ? 'السعر ده بيفضل ثابت للمحل حتى لو سعر الكتالوج اتغيّر.'
                    : 'This price stays fixed for the shop even if the catalog price changes.'}
                </p>
              </>
            )}

            <label>
              {ar ? 'السبب (بيتسجل في السجل)' : 'Reason (saved in the history)'}
              <textarea
                required
                minLength={4}
                maxLength={500}
                value={reason}
                onChange={(x) => setReason(x.target.value)}
              />
            </label>
            {dialogError && (
              <p role="alert" className="notice error">
                {dialogError}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                disabled={busy}
                onClick={() => setAction(null)}
              >
                {ar ? 'رجوع' : 'Go back'}
              </button>
              <button className={action.kind === 'cancel' ? 'danger' : 'primary'} disabled={busy}>
                {busy ? (ar ? 'بنحفظ…' : 'Saving…') : ar ? 'احفظ' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
