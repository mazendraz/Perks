import { useEffect, useState, type FormEvent } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { LoyaltyCard } from '../../../../packages/ui/src/LoyaltyCard.js';
import { api, errorText } from '../api.js';
import type { MerchantOnboardingSetup } from '../../../../packages/contracts/src/merchant-onboarding.js';

type Draft = {
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
  amount_minor: number;
  recipient_account: string;
  submitted_reference?: string;
  confirmed_at?: string;
  rejection_reason?: string;
};
const endpoint = '/merchant-onboarding/draft';

export function MerchantOnboarding({ lang }: { lang: Language }) {
  const ar = lang === 'ar';
  const [draft, setDraft] = useState<Draft | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void api<{ draft: Draft | null }>(endpoint)
      .then(({ draft }) => {
        if (!active) return;
        setDraft(draft);
        setName(draft?.details.name ?? '');
        setLoaded(true);
      })
      .catch((failure: unknown) => {
        if (active) setError(failure);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !loaded || !name.trim()) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const current = draft ?? (await api<{ draft: Draft }>(endpoint, { method: 'POST' })).draft;
      setDraft(current);
      const result = await api<{ draft: Draft }>(endpoint, {
        method: 'PATCH',
        body: { name, revision: current.revision },
      });
      setDraft(result.draft);
      setName(result.draft.details.name ?? '');
      setSaved(true);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  if (draft?.publication) {
    const { merchantId, placementId, code } = draft.publication;
    return (
      <main id="main" className="join-page">
        <section className="panel">
          <h1>{draft.details.name}</h1>
          {draft.rejection_reason && (
            <p role="alert" className="notice error">
              {ar
                ? 'التحويل اترفض والمحل اتوقف.'
                : 'The transfer was rejected and the shop was suspended.'}{' '}
              {draft.rejection_reason}
            </p>
          )}
          {draft.rejection_reason && <PaymentCorrection draft={draft} lang={lang} />}
          <div className="form-actions">
            {!draft.rejection_reason && (
              <>
                <a
                  className="primary"
                  href={`/api/v1/merchants/${merchantId}/placements/${placementId}/qr?__portal=merchant`}
                >
                  {ar ? 'نزّل الـQR' : 'Download QR'}
                </a>
                <a className="secondary" href={'/p/' + code}>
                  {ar ? 'افتح لينك الانضمام' : 'Open enrollment link'}
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

  return (
    <main id="main" className="join-page">
      <section className="panel" aria-labelledby="merchant-onboarding-title">
        <h1 id="merchant-onboarding-title">{ar ? 'جهّز محلك' : 'Set up your shop'}</h1>
        <form onSubmit={save} aria-busy={busy}>
          {error != null && (
            <p role="alert" className="notice error">
              {errorText(error, lang)}
            </p>
          )}
          {busy && !loaded && <p role="status">{ar ? 'بنحمّل المسودة…' : 'Loading your draft…'}</p>}
          {loaded && (
            <>
              <label htmlFor="merchant-onboarding-name">{ar ? 'اسم المحل' : 'Shop name'}</label>
              <input
                id="merchant-onboarding-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaved(false);
                }}
                maxLength={120}
                disabled={busy}
                required
              />
              <div className="form-actions">
                <button className="primary" disabled={busy || !name.trim()}>
                  {busy ? (ar ? 'بنحفظ…' : 'Saving…') : ar ? 'احفظ المسودة' : 'Save draft'}
                </button>
                {error != null && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      setError(null);
                      setAttempt((value) => value + 1);
                    }}
                  >
                    {ar ? 'حمّل آخر نسخة' : 'Load latest draft'}
                  </button>
                )}
              </div>
            </>
          )}
          {!loaded && error != null && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setBusy(true);
                setError(null);
                setAttempt((value) => value + 1);
              }}
            >
              {ar ? 'جرّب تاني' : 'Try again'}
            </button>
          )}
          {saved && <p role="status">{ar ? 'المسودة اتحفظت.' : 'Draft saved.'}</p>}
        </form>
        {draft?.details.name && (
          <PaymentOrder
            lang={lang}
            draft={draft}
            onPublished={(publication) => setDraft({ ...draft, publication })}
          />
        )}
        {draft?.details.name && (
          <ShopSetup
            key={draft.id + ':' + draft.revision}
            draft={draft}
            lang={lang}
            onSaved={setDraft}
          />
        )}
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
        <PaymentReceipt order={order} onSaved={setOrder} lang={lang} />
      )}
    </section>
  );
}

function ShopSetup({
  draft,
  lang,
  onSaved,
}: {
  draft: Draft;
  lang: Language;
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

  return (
    <section aria-labelledby="onboarding-shop-setup">
      <h2 id="onboarding-shop-setup">{ar ? 'الفرع وكارت الولاء' : 'Branch and loyalty card'}</h2>
      <LoyaltyCard
        lang={lang}
        motion="quiet"
        card={{
          id: draft.id,
          merchant_id: draft.id,
          merchant_name: draft.details.name ?? '',
          alias: ar ? 'معاينة' : 'Preview',
          program_name: ar ? 'كارت الولاء' : 'Loyalty card',
          threshold: setup.threshold,
          balance: 0,
          primary_color: setup.cardColor,
          accent_color: '#ddd3a7',
          surface_color: '#f5f1e7',
          template: 'classic',
          reward_title: setup.rewardTitle,
          revision: draft.revision,
          cycle_number: 1,
        }}
      />
      <form onSubmit={save} aria-busy={busy}>
        <fieldset disabled={busy}>
          <label>
            {ar ? 'اسم أول فرع' : 'First branch name'}
            <input
              required
              minLength={2}
              maxLength={120}
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
          <label>
            {ar ? 'المكافأة' : 'Reward'}
            <input
              required
              minLength={2}
              maxLength={240}
              value={setup.rewardTitle}
              onChange={(e) => setSetup({ ...setup, rewardTitle: e.target.value })}
            />
          </label>
          <label>
            {ar ? 'الأختام المطلوبة للمكافأة' : 'Stamps needed for the reward'}
            <input
              type="number"
              min={2}
              max={50}
              required
              value={setup.threshold || ''}
              onChange={(e) => setSetup({ ...setup, threshold: Number(e.target.value) })}
            />
          </label>
          <label>
            {ar ? 'لون الكارت' : 'Card color'}
            <input
              type="color"
              value={setup.cardColor}
              onChange={(e) => setSetup({ ...setup, cardColor: e.target.value })}
            />
          </label>
        </fieldset>
        {error != null && (
          <p role="alert" className="notice error">
            {errorText(error, lang)}
          </p>
        )}
        {draft.details.setup && (
          <p role="status">
            {ar ? 'الإعدادات اتحفظت في المسودة.' : 'Settings saved to your draft.'}
          </p>
        )}
        <div className="form-actions">
          <button className="primary" disabled={busy}>
            {busy ? (ar ? 'بنحفظ…' : 'Saving…') : ar ? 'احفظ إعدادات المحل' : 'Save shop settings'}
          </button>
        </div>
      </form>
    </section>
  );
}

function PaymentOrder({
  lang,
  draft,
  onPublished,
}: {
  lang: Language;
  draft: Draft;
  onPublished: (publication: Publication) => void;
}) {
  const ar = lang === 'ar';
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [selected, setSelected] = useState('');
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const currency = new Intl.NumberFormat(ar ? 'ar-EG' : 'en-EG', {
    style: 'currency',
    currency: 'EGP',
  });

  useEffect(() => {
    let active = true;
    void Promise.all([
      api<{ plans: Plan[] }>('/merchant-onboarding/plans'),
      api<{ order: Order | null }>('/merchant-onboarding/order'),
    ])
      .then(([catalog, payment]) => {
        if (!active) return;
        setPlans(catalog.plans);
        setOrder(payment.order);
      })
      .catch((failure: unknown) => {
        if (active) setError(failure);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ order: Order }>('/merchant-onboarding/order', {
        method: 'POST',
        body: { planKey: selected },
      });
      setOrder(result.order);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ publication: Publication }>(
        endpoint + '/' + draft.id + '/publish',
        {
          method: 'POST',
          body: { revision: draft.revision },
        },
      );
      onPublished(result.publication);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="onboarding-payment-title">
      <h2 id="onboarding-payment-title">{ar ? 'الدفع بـ InstaPay' : 'Pay with InstaPay'}</h2>
      {error != null && (
        <p className="notice error" role="alert">
          {errorText(error, lang)}
        </p>
      )}
      {!plans && error == null && <p role="status">{ar ? 'بنحمّل الباقات…' : 'Loading plans…'}</p>}
      {!plans && error != null && (
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setError(null);
            setAttempt((value) => value + 1);
          }}
        >
          {ar ? 'جرّب تاني' : 'Try again'}
        </button>
      )}
      {plans?.length === 0 && !order && (
        <p>{ar ? 'الدفع غير متاح حاليًا.' : 'Payment is currently unavailable.'}</p>
      )}
      {order?.rejection_reason && (
        <p role="alert" className="notice error">
          {ar ? 'التحويل اترفض.' : 'Transfer rejected.'} {order.rejection_reason}
        </p>
      )}
      {!!plans?.length && (!order || order.rejection_reason) && (
        <form onSubmit={create} aria-busy={busy}>
          <label htmlFor="onboarding-plan">{ar ? 'الباقة الشهرية' : 'Monthly plan'}</label>
          <select
            id="onboarding-plan"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            required
            disabled={busy}
          >
            <option value="">{ar ? 'اختار باقة' : 'Choose a plan'}</option>
            {plans.map((plan) => (
              <option value={plan.plan_key} key={plan.plan_key}>
                {ar ? plan.name_ar : plan.name_en} · {currency.format(plan.amount_minor / 100)}
              </option>
            ))}
          </select>
          <div className="form-actions">
            <button className="primary" disabled={!selected || busy}>
              {ar ? 'اعرض بيانات التحويل' : 'Show transfer details'}
            </button>
          </div>
        </form>
      )}
      {order && !order.rejection_reason && (
        <>
          <dl aria-live="polite">
            <dt>{ar ? 'المبلغ' : 'Amount'}</dt>
            <dd>{currency.format(order.amount_minor / 100)}</dd>
            <dt>{ar ? 'عنوان الاستلام' : 'Recipient address'}</dt>
            <dd>
              <bdi dir="ltr">{order.recipient_account}</bdi>
            </dd>
            <dt>{ar ? 'رقم الطلب' : 'Order number'}</dt>
            <dd>
              <bdi dir="ltr">{order.id}</bdi>
            </dd>
          </dl>
          <PaymentReceipt order={order} onSaved={setOrder} lang={lang} />
          {order.submitted_reference && draft.details.setup && (
            <div className="form-actions">
              <button
                className="primary"
                type="button"
                disabled={busy}
                onClick={() => void publish()}
              >
                {busy ? (ar ? 'بننشر المحل…' : 'Publishing…') : ar ? 'انشر محلك' : 'Publish shop'}
              </button>
            </div>
          )}
          {order.submitted_reference && !order.confirmed_at && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setError(null);
                setAttempt((value) => value + 1);
              }}
            >
              {ar ? 'حدّث حالة الدفع' : 'Refresh payment status'}
            </button>
          )}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy) return;
    if (file.size > 2_000_000) {
      setError(ar ? 'اختار صورة حجمها أقل من ٢ ميجابايت.' : 'Choose an image under 2 MB.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const result = await api<{ order: Order }>(
        '/merchant-onboarding/order/' + order.id + '/receipt',
        {
          method: 'POST',
          body: { reference, image },
        },
      );
      onSaved(result.order);
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
      <p role="status">
        {ar ? 'الإيصال وصل والتحويل قيد المراجعة.' : 'Receipt received. Payment is under review.'}
      </p>
    );
  return (
    <form onSubmit={upload} aria-busy={busy}>
      <label htmlFor="onboarding-transfer-reference">
        {ar ? 'رقم العملية' : 'Transfer reference'}
      </label>
      <input
        id="onboarding-transfer-reference"
        dir="ltr"
        required
        minLength={3}
        maxLength={120}
        value={reference}
        disabled={busy}
        onChange={(e) => setReference(e.target.value)}
      />
      <label htmlFor="onboarding-receipt">{ar ? 'صورة الإيصال' : 'Receipt image'}</label>
      <input
        id="onboarding-receipt"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        required
        disabled={busy}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="primary" disabled={busy || !file}>
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
