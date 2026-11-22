import { WhyDisabled } from '../controls/WhyDisabled.js';
import { useEffect, useState, type FormEvent } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import {
  limitKeys,
  type EffectiveEntitlements,
} from '../../../../packages/contracts/src/entitlements.js';
import { annualPaidMonths } from '../../../../packages/contracts/src/plan-catalog.js';
import { api, ApiError, errorText } from '../api.js';
import { addonLabel, day, featureLabel, levelLabel, limitLabel, money } from './billing-labels.js';

export interface PlanState {
  entitlements: EffectiveEntitlements;
  subscription: {
    status: string;
    currency: string;
    billingPeriod: 'monthly' | 'annual';
    priceMinor: number;
    trialEndsAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    pastDueSince: string | null;
    pendingPlan: string | null;
    pendingEffectiveAt: string | null;
  };
  catalog: {
    key: string;
    name_ar: string;
    name_en: string;
    sort_order: number;
    is_custom: boolean;
    prices: { billingPeriod: 'monthly' | 'annual'; amountMinor: number }[];
    entitlements: Record<string, number | boolean | string | null>;
    addons: {
      key: 'extra_branch' | 'extra_staff';
      unitAmountMinor: number;
      maxTotal: number | null;
    }[];
  }[];
  addons: { key: string; quantity: number; unit_amount_minor: number }[];
  items: {
    kind: 'branch' | 'program' | 'staff';
    id: string;
    name: string;
    locked: boolean;
    kept: boolean;
  }[];
  keepLimits: Record<'branch' | 'program' | 'staff', number | null>;
  request: {
    id: string;
    kind: 'change_plan' | 'addon';
    plan_key: string | null;
    billing_period: string | null;
    addon_key: string | null;
    quantity: number | null;
    status: 'open' | 'approved' | 'declined' | 'withdrawn';
    created_at: string;
    close_reason: string | null;
  } | null;
}
type Ask =
  | { kind: 'change_plan'; plan: string; billingPeriod: 'monthly' | 'annual' }
  | { kind: 'addon'; addonKey: 'extra_branch' | 'extra_staff'; quantity: number };

const PHONE = '01006111380';
const taglines: Record<string, [string, string]> = {
  starter: ['لمحل واحد لسه بيبدأ', 'For one shop getting started'],
  growth: ['لما يبقى عندك فرعين', 'When you have two branches'],
  pro: ['لسلسلة صغيرة لحد 4 فروع', 'For a small chain, up to 4 branches'],
  scale: ['لسلسلة كبيرة لحد 10 فروع', 'For a larger chain, up to 10 branches'],
  enterprise: ['أكتر من 10 فروع أو احتياج خاص', 'Over 10 branches or special needs'],
};
const kindWords = {
  branch: ['الفروع', 'Branches'],
  program: ['برامج الأختام', 'Stamp programs'],
  staff: ['الموظفين', 'Staff'],
} as const;

/** The few lines an owner must not miss, shown at the top of the dashboard too. */
export function PlanBanners({
  state,
  lang,
  kind,
  merchantId,
  onOpen,
}: {
  state: PlanState;
  lang: Language;
  /** billing: past due, grace, cancelled (dashboard header). info: trial, downgrade, ending. */
  kind: 'billing' | 'info';
  merchantId?: string;
  onOpen?: () => void;
}) {
  const ar = lang === 'ar',
    s = state.subscription;
  // Only the past-due reminder can be dismissed, and only until the next time it changes.
  const dismissKey = 'perks-past-due-dismissed:' + merchantId + ':' + s.pastDueSince;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(dismissKey) === '1';
    } catch {
      return false;
    }
  });
  const name = (key: string | null) => {
    const p = state.catalog.find((x) => x.key === key);
    return p ? (ar ? p.name_ar : p.name_en) : key || '';
  };
  const lines: { tone: 'warning' | 'error' | 'info'; text: string; dismissible?: boolean }[] = [];
  if (kind === 'billing' && s.status === 'past_due' && !dismissed)
    lines.push({
      tone: 'warning',
      dismissible: true,
      text: ar
        ? `معاد التجديد عدّى. ادفع عشان كل حاجة تفضل شغالة، وكلّمنا على ${PHONE}.`
        : `Your renewal date has passed. Pay to keep everything running, and call us on ${PHONE}.`,
    });
  if (kind === 'billing' && s.status === 'grace')
    lines.push({
      tone: 'error',
      text: ar
        ? `الحساب في فترة سماح. مش هتقدر تضيف فروع أو موظفين جداد لحد ما الدفع يتسجل. الكروت والأختام شغالة عادي. كلّمنا على ${PHONE}.`
        : `Your account is in a grace period. New branches and staff wait until the payment is recorded. Cards and stamps keep working. Call ${PHONE}.`,
    });
  if (kind === 'billing' && s.status === 'cancelled')
    lines.push({
      tone: 'error',
      text: ar
        ? `الاشتراك اتلغى، فالحساب بقى للعرض بس. تقدر تنزّل عملاءك CSV لمدة 30 يوم. عايز ترجع؟ كلّمنا على ${PHONE}.`
        : `Your subscription ended, so the account is view-only. You can export customers for 30 days. Want to come back? Call ${PHONE}.`,
    });
  if (kind === 'info' && s.status === 'trialing' && s.trialEndsAt) {
    const days = Math.max(0, Math.ceil((Date.parse(s.trialEndsAt) - Date.now()) / 86400000));
    lines.push({
      tone: 'info',
      text: ar
        ? `أنت في التجربة المجانية لباقة ${name(state.entitlements.plan.key)}. فاضل ${days} يوم.`
        : `You are on a free trial of ${name(state.entitlements.plan.key)}. ${days} days left.`,
    });
  }
  if (kind === 'info' && s.pendingPlan) {
    const n = state.keepLimits.branch;
    lines.push({
      tone: 'info',
      text: ar
        ? `الباقة الجديدة (${name(s.pendingPlan)}) هتبدأ يوم ${day(s.pendingEffectiveAt, lang)}.` +
          (n !== null && state.items.filter((i) => i.kind === 'branch' && !i.locked).length > n
            ? ` اختار ${n === 1 ? 'فرع واحد يفضل شغال' : n === 2 ? 'فرعين يفضلوا شغالين' : n + ' فروع يفضلوا شغالين'}.`
            : '')
        : `Your new plan (${name(s.pendingPlan)}) starts on ${day(s.pendingEffectiveAt, lang)}.` +
          (n !== null && state.items.filter((i) => i.kind === 'branch' && !i.locked).length > n
            ? ` Choose ${n} branch${n === 1 ? '' : 'es'} to keep active.`
            : ''),
    });
  }
  if (kind === 'info' && s.cancelAtPeriodEnd && s.status !== 'cancelled')
    lines.push({
      tone: 'warning',
      text: ar
        ? `الاشتراك هيخلص يوم ${day(s.currentPeriodEnd, lang)}.`
        : `Your subscription ends on ${day(s.currentPeriodEnd, lang)}.`,
    });
  if (!lines.length) return null;
  return (
    <div className="plan-banners">
      {lines.map((l) => (
        <div key={l.text} className={'notice ' + (l.tone === 'info' ? '' : l.tone)} role="status">
          <span>{l.text}</span>
          <span className="banner-actions">
            {onOpen && (
              <button className="text-button" onClick={onOpen}>
                {ar ? 'افتح باقتي' : 'Open my plan'}
              </button>
            )}
            {l.dismissible && (
              <button
                className="text-button"
                aria-label={ar ? 'اقفل التنبيه' : 'Dismiss'}
                onClick={() => {
                  setDismissed(true);
                  try {
                    sessionStorage.setItem(dismissKey, '1');
                  } catch {
                    /* Dismissed for this view only. */
                  }
                }}
              >
                ✕
              </button>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

export function MyPlan({
  merchantId,
  lang,
  onState,
}: {
  merchantId: string;
  lang: Language;
  onState?: (s: PlanState) => void;
}) {
  const ar = lang === 'ar';
  const [state, setState] = useState<PlanState | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [period, setPeriod] = useState<'monthly' | 'annual'>('monthly'),
    [ask, setAsk] = useState<Ask | null>(null),
    [note, setNote] = useState(''),
    [askKey, setAskKey] = useState(''),
    [askError, setAskError] = useState(''),
    [busy, setBusy] = useState(false),
    [celebrate, setCelebrate] = useState<string | null>(null),
    [keepKind, setKeepKind] = useState<'branch' | 'program' | 'staff' | null>(null),
    [keepIds, setKeepIds] = useState<string[]>([]),
    [filled, setFilled] = useState(false);
  // Meters fill from empty once the numbers arrive (instantly with reduced motion: CSS).
  useEffect(() => {
    if (!state) return;
    const frame = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(frame);
  }, [state !== null]);
  const base = '/merchants/' + merchantId + '/plan';
  const apply = (next: PlanState) => {
    setState(next);
    onState?.(next);
    setPeriod((p) => (p === 'monthly' ? next.subscription.billingPeriod : p));
    // A bigger plan than last time: celebrate once.
    const current = next.catalog.find((p) => p.key === next.entitlements.plan.key);
    const storageKey = 'perks-plan-seen:' + merchantId;
    try {
      const seen = Number(localStorage.getItem(storageKey) ?? 'NaN');
      if (current && Number.isFinite(seen) && current.sort_order > seen)
        setCelebrate(ar ? current.name_ar : current.name_en);
      if (current) localStorage.setItem(storageKey, String(current.sort_order));
    } catch {
      /* Private mode: no celebration, nothing else changes. */
    }
  };
  const load = async () => {
    try {
      apply(await api<PlanState>(base));
      setError('');
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void load();
  }, [merchantId]);

  if (!state)
    return error ? (
      <p role="alert" className="notice error">
        {error}
      </p>
    ) : (
      <p role="status">{ar ? 'بنفتح باقتك…' : 'Loading your plan…'}</p>
    );

  const e = state.entitlements,
    s = state.subscription;
  const current = state.catalog.find((p) => p.key === e.plan.key);
  const planName = (key: string | null) => {
    const p = state.catalog.find((x) => x.key === key);
    return p
      ? ar
        ? p.name_ar
        : p.name_en
      : key === e.plan.key
        ? ar
          ? e.plan.nameAr
          : e.plan.nameEn
        : key || '';
  };
  const priceOf = (p: PlanState['catalog'][number], per: 'monthly' | 'annual') =>
    p.prices.find((x) => x.billingPeriod === per)?.amountMinor;
  const open = state.request?.status === 'open' ? state.request : null;
  const startAsk = (next: Ask) => {
    setAsk(next);
    setNote('');
    setAskError('');
    setAskKey(crypto.randomUUID());
  };
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!ask) return;
    setBusy(true);
    setAskError('');
    try {
      const r = await api<{ plan: PlanState }>(base + '/requests', {
        method: 'POST',
        key: askKey,
        body: { ...ask, ...(note.trim() ? { note: note.trim() } : {}) },
      });
      apply(r.plan);
      setAsk(null);
      setNotice(
        ar
          ? `طلبك وصل لفريق Perks. هنكلمك نأكد معاك ونسجّل الدفع، وبعدها التغيير يشتغل على طول.`
          : 'Your request reached the Perks team. We will call to confirm and record the payment, then it takes effect.',
      );
    } catch (x) {
      setAskError(errorText(x, lang));
      if (!(x instanceof ApiError) || x.status !== 0) setAskKey(crypto.randomUUID());
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async () => {
    if (!open) return;
    setBusy(true);
    try {
      const r = await api<{ plan: PlanState }>(base + '/requests/' + open.id + '/withdraw', {
        method: 'POST',
        key: crypto.randomUUID(),
        body: {},
      });
      apply(r.plan);
      setNotice(ar ? 'لغينا الطلب.' : 'Request withdrawn.');
    } catch (x) {
      setError(errorText(x, lang));
    } finally {
      setBusy(false);
    }
  };
  const saveKeep = async () => {
    if (!keepKind) return;
    setBusy(true);
    try {
      const r = await api<{ plan: PlanState }>(base + '/keep', {
        method: 'PUT',
        key: crypto.randomUUID(),
        body: { kind: keepKind, ids: keepIds },
      });
      apply(r.plan);
      setKeepKind(null);
      setNotice(
        s.pendingPlan
          ? ar
            ? 'اتحفظ اختيارك. هيتطبق يوم ما الباقة الجديدة تبدأ.'
            : 'Saved. It applies when the new plan starts.'
          : ar
            ? 'اتحفظ اختيارك واتطبق.'
            : 'Saved and applied.',
      );
    } catch (x) {
      setError(errorText(x, lang));
    } finally {
      setBusy(false);
    }
  };

  // Where the owner has to (or can) choose what stays active.
  const keepNeeds = (['branch', 'program', 'staff'] as const)
    .map((kind) => {
      const list = state.items.filter((i) => i.kind === kind);
      const limit = state.keepLimits[kind];
      const active = list.filter((i) => !i.locked).length;
      const needed =
        limit !== null && (list.some((i) => i.locked) || (s.pendingPlan && active > limit));
      return needed ? { kind, list, limit: limit! } : null;
    })
    .filter((x) => x !== null);

  const askText = (a: Ask) => {
    if (a.kind === 'addon') {
      const offer = current?.addons.find((x) => x.key === a.addonKey);
      return ar
        ? `${addonLabel(a.addonKey, lang)} × ${a.quantity}${offer ? ` = ${money(offer.unitAmountMinor * a.quantity, s.currency, lang)} في الشهر زيادة` : ''}`
        : `${addonLabel(a.addonKey, lang)} × ${a.quantity}${offer ? ` = ${money(offer.unitAmountMinor * a.quantity, s.currency, lang)} more a month` : ''}`;
    }
    const target = state.catalog.find((p) => p.key === a.plan);
    const amount = target ? priceOf(target, a.billingPeriod) : undefined;
    const lower = current && target && target.sort_order < current.sort_order;
    const head = ar
      ? `باقة ${planName(a.plan)}${amount !== undefined ? ` بـ ${money(amount, s.currency, lang)} ${a.billingPeriod === 'annual' ? 'في السنة' : 'في الشهر'}` : ''}.`
      : `${planName(a.plan)}${amount !== undefined ? ` for ${money(amount, s.currency, lang)} ${a.billingPeriod === 'annual' ? 'a year' : 'a month'}` : ''}.`;
    // The difference per month, so the owner sees exactly what changes.
    const perMonth = (minor: number, per: 'monthly' | 'annual') =>
      per === 'annual' ? Math.round(minor / 12) : minor;
    const diff =
      amount === undefined
        ? null
        : perMonth(amount, a.billingPeriod) - perMonth(s.priceMinor, s.billingPeriod);
    const delta =
      diff === null || diff === 0
        ? ''
        : ar
          ? ` يعني ${diff > 0 ? 'زيادة' : 'توفير'} ${money(Math.abs(diff), s.currency, lang)} في الشهر عن دلوقتي.`
          : ` That is ${money(Math.abs(diff), s.currency, lang)} a month ${diff > 0 ? 'more' : 'less'} than now.`;
    const when = lower
      ? ar
        ? ` التغيير بيبدأ يوم التجديد ${day(s.currentPeriodEnd, lang)}، وهتختار اللي يفضل شغال.`
        : ` It starts on your renewal date, ${day(s.currentPeriodEnd, lang)}, and you choose what stays active.`
      : ar
        ? ' بيبدأ أول ما الدفع يتسجل.'
        : ' It starts as soon as the payment is recorded.';
    return head + delta + when;
  };

  return (
    <section className="my-plan">
      <PlanBanners state={state} lang={lang} kind="info" />
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice success">
          {notice}
        </p>
      )}

      <div className="plan-hero">
        <div>
          <span className="eyebrow">{ar ? 'باقتي' : 'MY PLAN'}</span>
          <h2>{planName(e.plan.key)}</h2>
          {taglines[e.plan.key] && <p className="muted">{taglines[e.plan.key]![ar ? 0 : 1]}</p>}
        </div>
        <div className="plan-hero-price">
          <bdi>{money(s.priceMinor, s.currency, lang)}</bdi>
          <small>
            {s.billingPeriod === 'annual'
              ? ar
                ? 'في السنة · من غير ضريبة'
                : 'a year · excl. VAT'
              : ar
                ? 'في الشهر · من غير ضريبة'
                : 'a month · excl. VAT'}
          </small>
          {s.currentPeriodEnd && s.status !== 'cancelled' && (
            <small>{(ar ? 'التجديد: ' : 'Renews: ') + day(s.currentPeriodEnd, lang)}</small>
          )}
        </div>
      </div>

      {state.request && (
        <div className={'panel plan-request ' + state.request.status}>
          <strong>
            {state.request.status === 'open'
              ? ar
                ? 'طلبك مع فريق Perks'
                : 'Your request is with the Perks team'
              : state.request.status === 'approved'
                ? ar
                  ? 'طلبك اتنفذ 🎉'
                  : 'Your request is done 🎉'
                : state.request.status === 'declined'
                  ? ar
                    ? 'طلبك متنفذش'
                    : 'Your request was not applied'
                  : ar
                    ? 'لغيت الطلب'
                    : 'You withdrew the request'}
          </strong>
          <p>
            {askText(
              state.request.kind === 'addon'
                ? {
                    kind: 'addon',
                    addonKey: state.request.addon_key as 'extra_branch',
                    quantity: state.request.quantity ?? 1,
                  }
                : {
                    kind: 'change_plan',
                    plan: state.request.plan_key!,
                    billingPeriod: (state.request.billing_period as 'monthly') || 'monthly',
                  },
            )}
          </p>
          {state.request.close_reason && state.request.status === 'declined' && (
            <p className="muted">{state.request.close_reason}</p>
          )}
          {open && (
            <button className="text-button" disabled={busy} onClick={withdraw}>
              {ar ? 'الغي الطلب' : 'Withdraw request'}
            </button>
          )}
        </div>
      )}

      <div className="panel">
        <h3>{ar ? 'استخدامك' : 'Your usage'}</h3>
        <ul className="usage-meters">
          {limitKeys.map((k) => {
            const limit = e.limits[k],
              used = e.usage[k] || 0;
            const ratio = limit === null ? 0 : limit === 0 ? 1 : Math.min(used / limit, 1);
            return (
              <li key={k}>
                <div className="usage-label">
                  <span>
                    {limitLabel(k, lang)}
                    {k === 'manual_messages_per_month' && (
                      <small className="muted">
                        {' '}
                        {ar ? '· بتتجدد أول كل شهر' : '· renews monthly'}
                      </small>
                    )}
                  </span>
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
                  className={'usage-bar lime' + (ratio >= 1 ? ' full' : '')}
                  role="progressbar"
                  aria-label={limitLabel(k, lang)}
                  aria-valuemin={0}
                  aria-valuemax={limit ?? used}
                  aria-valuenow={used}
                >
                  <span
                    style={{ inlineSize: (filled && limit !== null ? ratio * 100 : 0) + '%' }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        {state.addons.some((a) => a.quantity > 0) && (
          <p className="muted">
            {(ar ? 'ضمن الحدود: ' : 'Included: ') +
              state.addons
                .filter((a) => a.quantity > 0)
                .map((a) => addonLabel(a.key, lang) + ' × ' + a.quantity)
                .join(' · ')}
          </p>
        )}
      </div>

      {keepNeeds.length > 0 && (
        <div className="panel keep-panel">
          <h3>{ar ? 'اختار اللي يفضل شغال' : 'Choose what stays active'}</h3>
          <p className="muted">
            {ar
              ? 'اللي مش هتختاره بيتقفل بس، مش بيتمسح. بياناته وعملاؤه بيفضلوا زي ما هم ويرجعوا أول ما الباقة تسمح.'
              : 'Anything you do not pick is only locked, never deleted. Its data and customers stay and come back when your plan allows.'}
          </p>
          {keepNeeds.map((k) => (
            <div key={k.kind} className="keep-group">
              <div className="keep-head">
                <strong>{kindWords[k.kind][ar ? 0 : 1]}</strong>
                <small className="muted">
                  {ar ? `تقدر تختار لحد ${k.limit}` : `Up to ${k.limit}`}
                </small>
              </div>
              <ul className="keep-list">
                {k.list.map((i) => (
                  <li key={i.id}>
                    <bdi>{i.name}</bdi>
                    <span className={'status-pill ' + (i.locked ? 'warning' : 'success')}>
                      {i.locked ? (ar ? 'مقفول' : 'Locked') : ar ? 'شغال' : 'Active'}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                className="secondary small"
                disabled={busy}
                onClick={() => {
                  setKeepKind(k.kind);
                  const kept = k.list.filter((i) => i.kept).map((i) => i.id);
                  setKeepIds(
                    (kept.length ? kept : k.list.filter((i) => !i.locked).map((i) => i.id)).slice(
                      0,
                      k.limit,
                    ),
                  );
                }}
              >
                {ar ? 'اختار' : 'Choose'}
              </button>
            </div>
          ))}
        </div>
      )}

      {current && current.addons.length > 0 && (
        <div className="panel">
          <h3>{ar ? 'محتاج حاجة زيادة بس؟' : 'Need just a little more?'}</h3>
          <div className="addon-offers">
            {current.addons.map((a) => {
              const base =
                current.entitlements[a.key === 'extra_branch' ? 'max_branches' : 'max_staff'];
              const room =
                a.maxTotal === null || typeof base !== 'number' ? null : a.maxTotal - base;
              const have = state.addons.find((x) => x.key === a.key)?.quantity ?? 0;
              const full = room !== null && have >= room;
              return (
                <div key={a.key} className="addon-offer">
                  <div>
                    <strong>{addonLabel(a.key, lang)}</strong>
                    <small className="muted">
                      <bdi>{money(a.unitAmountMinor, s.currency, lang)}</bdi>{' '}
                      {ar ? 'في الشهر' : 'a month'}
                    </small>
                  </div>
                  <button
                    className="secondary small"
                    disabled={busy || !!open || full}
                    onClick={() => startAsk({ kind: 'addon', addonKey: a.key, quantity: 1 })}
                  >
                    {full ? (ar ? 'وصلت للحد' : 'At the limit') : ar ? 'اطلب' : 'Request'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="section-heading">
          <h3>{ar ? 'قارن الباقات' : 'Compare plans'}</h3>
          <div
            className="period-toggle"
            role="radiogroup"
            aria-label={ar ? 'طريقة الدفع' : 'Billing'}
          >
            {(['monthly', 'annual'] as const).map((p) => (
              <button
                key={p}
                role="radio"
                aria-checked={period === p}
                className={period === p ? 'active' : ''}
                onClick={() => setPeriod(p)}
              >
                {p === 'monthly'
                  ? ar
                    ? 'شهري'
                    : 'Monthly'
                  : ar
                    ? `سنوي · ادفع ${annualPaidMonths} شهور`
                    : `Annual · pay ${annualPaidMonths} months`}
              </button>
            ))}
          </div>
        </div>
        <div className="compare-plans">
          {state.catalog
            .filter((p) => !p.is_custom)
            .map((p) => {
              const amount = priceOf(p, period);
              const isCurrent = p.key === e.plan.key && period === s.billingPeriod;
              const lower = current ? p.sort_order < current.sort_order : false;
              return (
                <article
                  key={p.key}
                  className={'compare-plan' + (p.key === e.plan.key ? ' current' : '')}
                >
                  <header>
                    <strong>{ar ? p.name_ar : p.name_en}</strong>
                    {p.key === e.plan.key && (
                      <span className="status-pill current">
                        {ar ? 'باقتك الحالية' : 'Your current plan'}
                      </span>
                    )}
                  </header>
                  <p className="compare-price">
                    {amount !== undefined ? (
                      <>
                        <bdi>
                          {money(
                            period === 'annual' ? Math.round(amount / 12) : amount,
                            s.currency,
                            lang,
                          )}
                        </bdi>
                        <small>{ar ? 'في الشهر' : 'a month'}</small>
                      </>
                    ) : (
                      <small>{ar ? 'بالاتفاق' : 'Custom'}</small>
                    )}
                  </p>
                  {period === 'annual' && amount !== undefined && (
                    <small className="muted">
                      {ar
                        ? `بتدفع ${money(amount, s.currency, lang)} مرة واحدة في السنة`
                        : `${money(amount, s.currency, lang)} paid once a year`}
                    </small>
                  )}
                  <small className="muted">{taglines[p.key]?.[ar ? 0 : 1]}</small>
                  <ul>
                    {limitKeys.map((k) => {
                      const v = p.entitlements[k];
                      return (
                        <li key={k}>
                          <span>{limitLabel(k, lang)}</span>
                          <bdi>{v === null ? (ar ? 'مفتوح' : 'Unlimited') : String(v ?? '—')}</bdi>
                        </li>
                      );
                    })}
                    {(['data_export_csv', 'customer_segments'] as const).map((k) => (
                      <li key={k}>
                        <span>{featureLabel(k, lang)}</span>
                        <span>{p.entitlements[k] ? '✓' : '—'}</span>
                      </li>
                    ))}
                    {typeof p.entitlements.analytics_level === 'string' && (
                      <li>
                        <span>{featureLabel('analytics_level', lang)}</span>
                        <span>{levelLabel(p.entitlements.analytics_level, lang)}</span>
                      </li>
                    )}
                  </ul>
                  {isCurrent ? (
                    <button className="secondary small" disabled>
                      {ar ? 'باقتك الحالية' : 'Current plan'}
                    </button>
                  ) : (
                    <button
                      className={lower ? 'secondary small' : 'primary small'}
                      disabled={busy || !!open || amount === undefined}
                      onClick={() =>
                        startAsk({ kind: 'change_plan', plan: p.key, billingPeriod: period })
                      }
                    >
                      {p.key === e.plan.key
                        ? ar
                          ? period === 'annual'
                            ? 'حوّل للسنوي'
                            : 'حوّل للشهري'
                          : period === 'annual'
                            ? 'Switch to annual'
                            : 'Switch to monthly'
                        : lower
                          ? ar
                            ? 'انزل للباقة دي'
                            : 'Move down'
                          : ar
                            ? 'اطلب الترقية'
                            : 'Request upgrade'}
                    </button>
                  )}
                  {!isCurrent && (
                    <WhyDisabled>
                      {amount === undefined &&
                        (ar
                          ? period === 'annual'
                            ? 'الباقة دي مش متاحة بالدفع السنوي. جرّب الشهري.'
                            : 'الباقة دي مش متاحة بالدفع الشهري. جرّب السنوي.'
                          : period === 'annual'
                            ? 'Not available yearly. Try monthly.'
                            : 'Not available monthly. Try yearly.')}
                    </WhyDisabled>
                  )}
                </article>
              );
            })}
          <article className="compare-plan enterprise">
            <header>
              <strong>Enterprise</strong>
            </header>
            <p className="compare-price">
              <small>{ar ? 'بالاتفاق' : 'Custom'}</small>
            </p>
            <small className="muted">{taglines.enterprise![ar ? 0 : 1]}</small>
            <a
              className="secondary small"
              href={'https://wa.me/2' + PHONE}
              target="_blank"
              rel="noopener noreferrer"
            >
              {ar ? 'كلّمنا' : 'Talk to us'}
            </a>
          </article>
        </div>
        {open && (
          <p className="muted">
            {ar
              ? 'عندك طلب مفتوح. استنى ردنا أو الغيه قبل ما تطلب حاجة تانية.'
              : 'You have an open request. Wait for our reply or withdraw it first.'}
          </p>
        )}
      </div>

      {ask && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plan-ask-title"
            onSubmit={send}
          >
            <h2 id="plan-ask-title">{ar ? 'تأكيد الطلب' : 'Confirm your request'}</h2>
            <p>{askText(ask)}</p>
            {ask.kind === 'addon' && (
              <label>
                {ar ? 'العدد' : 'Quantity'}
                <input
                  type="number"
                  dir="ltr"
                  min={1}
                  max={100}
                  value={ask.quantity}
                  onChange={(x) =>
                    setAsk({
                      ...ask,
                      quantity: Math.min(100, Math.max(1, Math.floor(Number(x.target.value) || 1))),
                    })
                  }
                />
              </label>
            )}
            <p className="muted">
              {ar
                ? 'الدفع بيتم يدوي (إنستاباي أو فودافون كاش أو تحويل). هنكلمك نأكد معاك.'
                : 'Payment is manual (InstaPay, Vodafone Cash or transfer). We will call to confirm.'}
            </p>
            <label>
              {ar ? 'ملاحظة لينا (اختياري)' : 'Note for us (optional)'}
              <textarea maxLength={500} value={note} onChange={(x) => setNote(x.target.value)} />
            </label>
            {askError && (
              <p role="alert" className="notice error">
                {askError}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                disabled={busy}
                onClick={() => setAsk(null)}
              >
                {ar ? 'رجوع' : 'Go back'}
              </button>
              <button className="primary" disabled={busy}>
                {busy ? (ar ? 'بنبعت…' : 'Sending…') : ar ? 'ابعت الطلب' : 'Send request'}
              </button>
            </div>
          </form>
        </div>
      )}

      {keepKind && (
        <div className="modal-backdrop">
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="keep-title">
            <h2 id="keep-title">
              {ar
                ? `اختار ${kindWords[keepKind][0]} اللي تفضل شغالة`
                : `Choose ${kindWords[keepKind][1].toLowerCase()} to keep`}
            </h2>
            {(() => {
              const limit = state.keepLimits[keepKind] ?? 0;
              const list = state.items.filter((i) => i.kind === keepKind);
              return (
                <>
                  <p className="muted">
                    {ar
                      ? `اخترت ${keepIds.length} من ${limit}.`
                      : `${keepIds.length} of ${limit} chosen.`}
                  </p>
                  <ul className="keep-choices">
                    {list.map((i) => {
                      const on = keepIds.includes(i.id);
                      return (
                        <li key={i.id}>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={!on && keepIds.length >= limit}
                              onChange={() =>
                                setKeepIds((ids) =>
                                  on ? ids.filter((x) => x !== i.id) : [...ids, i.id],
                                )
                              }
                            />
                            <bdi>{i.name}</bdi>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </>
              );
            })()}
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                disabled={busy}
                onClick={() => setKeepKind(null)}
              >
                {ar ? 'رجوع' : 'Go back'}
              </button>
              <button
                className="primary"
                disabled={busy || (keepKind === 'branch' && keepIds.length === 0)}
                onClick={saveKeep}
              >
                {ar ? 'احفظ اختياري' : 'Save my choice'}
              </button>
            </div>
          </section>
        </div>
      )}

      {celebrate && (
        <div className="modal-backdrop">
          <section
            className="dialog plan-celebrate"
            role="dialog"
            aria-modal="true"
            aria-labelledby="celebrate-title"
          >
            <div className="celebrate-burst" aria-hidden="true">
              <span>🎉</span>
            </div>
            <h2 id="celebrate-title">
              {ar ? `تمام! انت دلوقتي على ${celebrate} 🎉` : `Done! You are now on ${celebrate} 🎉`}
            </h2>
            <p className="celebrate-limits">
              {(() => {
                const b = e.limits.max_branches,
                  st = e.limits.max_staff;
                const branches =
                  b === null
                    ? ar
                      ? 'فروع من غير حد'
                      : 'unlimited branches'
                    : ar
                      ? b === 1
                        ? 'فرع واحد'
                        : b === 2
                          ? 'فرعين'
                          : `${b} فروع`
                      : `${b} branch${b === 1 ? '' : 'es'}`;
                const staff =
                  st === null
                    ? ar
                      ? 'موظفين من غير حد'
                      : 'unlimited staff'
                    : ar
                      ? `${st} موظف`
                      : `${st} staff`;
                return ar ? `عندك ${branches} و${staff}.` : `You have ${branches} and ${staff}.`;
              })()}
            </p>
            <p>
              {ar ? 'الحدود الجديدة شغالة من دلوقتي.' : 'Your new limits work from now on.'}
              {!state.items.some((i) => i.locked) &&
                (ar
                  ? ' وأي حاجة كانت مقفولة رجعت تشتغل لوحدها.'
                  : ' Anything that was locked is working again.')}
            </p>
            <div className="form-actions">
              <button className="primary" data-dialog-close onClick={() => setCelebrate(null)}>
                {ar ? 'يلا بينا' : 'Let’s go'}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
