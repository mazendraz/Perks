import { useEffect, useState, type FormEvent } from 'react';
import type {
  Grant,
  Language,
  Session,
  SavedCard,
} from '../../../../packages/contracts/src/index.js';
import { api, ApiError, errorText, setCsrf } from '../api.js';
import { PhoneInput } from '../controls/PhoneInput.js';
import { Select } from '../controls/Select.js';
import { navigate } from '../useRoute.js';
export function CustomerDeviceHelp({ lang }: { lang: Language }) {
  const ar = lang === 'ar';
  return (
    <main id="main" className="join-page">
      <section className="panel">
        <span className="eyebrow">{ar ? 'كارتك معاك' : 'Your loyalty card'}</span>
        <h1>{ar ? 'الكارت مش على الجهاز ده' : 'Your card is not on this device'}</h1>
        <p>
          {ar
            ? 'افتح كارتك من سكان كود المحل،أو اطلب من الكاشير يبعتهولك على واتساب. مش محتاج إيميل أو باسورد.'
            : 'Scan the shop code to open your card, or ask the cashier to restore it on WhatsApp. You do not need an email or password.'}
        </p>
      </section>
    </main>
  );
}
export function CustomerRecoveryPage({
  token,
  lang,
  session,
  refresh,
}: {
  token: string;
  lang: Language;
  session: Session | null;
  refresh: () => Promise<void>;
}) {
  const ar = lang === 'ar',
    [preview, setPreview] = useState<{ merchantName: string; merchantId: string } | null>(null),
    [revoke, setRevoke] = useState(true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void Promise.all([
      api<NonNullable<typeof preview>>('/customer/recoveries/' + encodeURIComponent(token)),
      api<{ csrfToken: string }>('/customer/bootstrap'),
    ])
      .then(([info, boot]) => {
        if (!alive) return;
        setPreview(info);
        if (!session) setCsrf(boot.csrfToken);
        setReady(true);
      })
      .catch((error) => {
        if (alive) setError(errorText(error, lang).split(' · ')[0]!);
      });
    return () => {
      alive = false;
    };
  }, [token, session?.user.id]);
  const finish = async (id: string) => {
    await refresh();
    navigate('/customer/' + id);
  };
  const consume = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ membershipId: string; csrfToken: string }>(
        '/customer/recoveries/' + encodeURIComponent(token) + '/consume',
        { method: 'POST', body: { revokeOldDevices: revoke } },
      );
      setCsrf(result.csrfToken);
      await finish(result.membershipId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 0 && preview)
        try {
          const restored = await api<Session>('/session', { workspace: 'customer' });
          setCsrf(restored.csrfToken);
          const cards = await api<{ cards: SavedCard[] }>('/me/memberships', {
              workspace: 'customer',
            }),
            card = cards.cards.find((card) => card.merchant_id === preview.merchantId);
          if (card) {
            await finish(card.id);
            return;
          }
        } catch {
          /* Keep the uncertain outcome visible. */
        }
      setError(errorText(error, lang).split(' · ')[0]!);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main id="main" className="join-page">
      <section className="panel">
        <span className="eyebrow">{ar ? 'رجّع كارتك' : 'Restore your card'}</span>
        <h1>{preview?.merchantName || (ar ? 'كارتك قريب منك' : 'Your card, always close')}</h1>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {preview && (
          <>
            <p>
              {ar
                ? 'افتح الرابط من موبايلك علشان الكارت يتحفظ على الجهاز ده بنفس أختامك ومكافآتك.'
                : 'Open this on your phone to restore the same stamps and rewards on this device.'}
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={revoke}
                onChange={(event) => setRevoke(event.target.checked)}
              />
              {ar ? 'اقفل الكارت على الموبايل القديم' : 'Remove access from old devices'}
            </label>
            <button
              className="primary full"
              disabled={!ready || busy}
              onClick={() => void consume()}
            >
              {busy
                ? ar
                  ? 'بنرجّع كارتك…'
                  : 'Restoring your card…'
                : ar
                  ? 'افتح الكارت'
                  : 'Open my card'}
            </button>
          </>
        )}
        {!preview && !error && <p role="status">{ar ? 'بنراجع الرابط…' : 'Checking this link…'}</p>}
        {error && (
          <button className="secondary" onClick={() => navigate('/customer')}>
            {ar ? 'اعرض كروتي' : 'View my cards'}
          </button>
        )}
      </section>
    </main>
  );
}
interface FoundCustomer {
  customerId: string;
  profileId: string;
  name: string;
  phone: string;
  cards: { membershipId: string; programName: string; balance: number; threshold: number }[];
}
export function TeamCustomerRecovery({
  grant,
  lang,
  branchId,
}: {
  grant: Grant;
  lang: Language;
  branchId?: string;
}) {
  const ar = lang === 'ar',
    [phone, setPhone] = useState(''),
    [branch, setBranch] = useState(branchId || grant.branches[0]?.id || ''),
    [found, setFound] = useState<FoundCustomer | null>(null),
    [searched, setSearched] = useState(false),
    [requested, setRequested] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<{ url: string; expiresAt: string } | null>(null),
    [command, setCommand] = useState('');
  const base = '/merchants/' + grant.merchant_id;
  useEffect(() => {
    setBranch(branchId || grant.branches[0]?.id || '');
    setFound(null);
    setDraft(null);
    setPhone('');
    setSearched(false);
    setRequested(false);
    setCommand('');
  }, [branchId, grant.id]);
  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setFound(null);
    setDraft(null);
    setRequested(false);
    setSearched(false);
    setCommand('');
    try {
      const result = await api<{ customer: FoundCustomer | null }>(
        base + '/customer-recovery/search',
        { method: 'POST', body: { phone, branchId: branch } },
      );
      setFound(result.customer);
      setSearched(true);
    } catch (error) {
      setError(errorText(error, lang));
    } finally {
      setBusy(false);
    }
  };
  const prepare = async () => {
    if (!found || !requested || busy) return;
    setBusy(true);
    setError('');
    const key = command || crypto.randomUUID();
    setCommand(key);
    try {
      setDraft(
        await api(base + '/customer-recovery', {
          method: 'POST',
          key,
          body: { customerId: found.customerId, branchId: branch, requestedByCustomer: true },
        }),
      );
    } catch (error) {
      setError(errorText(error, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="panel customer-recovery-tool">
      <summary>{ar ? 'رجّع كارت عميل' : 'Restore a customer card'}</summary>
      <p className="muted">
        {ar
          ? 'بطلب العميل بس. دور برقمه كامل،وبعدها جهّز رسالة واتساب ليه.'
          : 'Only at the customer’s request. Search their full number, then prepare a WhatsApp message for them.'}
      </p>
      <form onSubmit={(event) => void search(event)}>
        {!branchId && (
          <label>
            {ar ? 'الفرع' : 'Branch'}
            <Select
              value={branch}
              disabled={busy}
              onChange={(event) => {
                setBranch(event.target.value);
                setFound(null);
                setDraft(null);
                setSearched(false);
                setCommand('');
              }}
            >
              {grant.branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          </label>
        )}
        <label>
          {ar ? 'رقم العميل كامل' : 'Full customer number'}
          <PhoneInput
            lang={lang}
            aria-label={ar ? 'رقم العميل كامل' : 'Full customer number'}
            required
            disabled={busy}
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              setFound(null);
              setDraft(null);
              setSearched(false);
              setCommand('');
            }}
          />
        </label>
        <button className="secondary" disabled={busy || !branch}>
          {ar ? 'دوّر على الكارت' : 'Find the card'}
        </button>
      </form>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {searched && !found && (
        <p role="status">
          {ar
            ? 'مفيش كارت بالرقم ده في نطاق الفرع.'
            : 'No card with this number is available in this branch.'}
        </p>
      )}
      {found && (
        <div className="subpanel">
          <strong>{found.name}</strong>
          <bdi dir="ltr">{found.phone}</bdi>
          {found.cards.map((card) => (
            <p key={card.membershipId}>
              {card.programName} · {card.balance}/{card.threshold} {ar ? 'أختام' : 'stamps'}
            </p>
          ))}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={requested}
              onChange={(event) => setRequested(event.target.checked)}
            />
            {ar ? 'العميل طلب يرجّع كارته' : 'The customer asked to restore their card'}
          </label>
          <button className="primary" disabled={busy || !requested} onClick={() => void prepare()}>
            {ar ? 'جهّز الاسترجاع على واتساب' : 'Prepare WhatsApp recovery'}
          </button>
          {draft && (
            <div className="notice success">
              <p>
                {ar
                  ? 'الرابط جاهز لمرة واحدة خلال24ساعة. واتساب هيفتح برسالة جاهزة،وإنت اللي هتبعتها للعميل.'
                  : 'A one-use link is ready for 24 hours. WhatsApp opens a draft; you send it to the customer.'}
              </p>
              <a className="primary" href={draft.url} target="_blank" rel="noopener noreferrer">
                {ar ? 'افتح واتساب' : 'Open WhatsApp'}
              </a>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
export function RecoveryPolicy({ merchantId, lang }: { merchantId: string; lang: Language }) {
  const ar = lang === 'ar',
    [value, setValue] = useState<{ cashierEnabled: boolean; revision: number } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const path = '/merchants/' + merchantId + '/customer-recovery-settings';
  useEffect(() => {
    let alive = true;
    void api<NonNullable<typeof value>>(path)
      .then((value) => {
        if (alive) setValue(value);
      })
      .catch((error) => {
        if (alive) setError(errorText(error, lang));
      });
    return () => {
      alive = false;
    };
  }, [merchantId]);
  return (
    <section className="subpanel">
      <h3>{ar ? 'استرجاع كروت العملاء' : 'Customer card recovery'}</h3>
      <p className="muted">
        {ar
          ? 'الاسترجاع بطلب العميل فقط. المالك والمدير يفضلوا قادرين عليه.'
          : 'Recovery is only at the customer’s request. Owners and managers retain access.'}
      </p>
      {value && (
        <label className="checkbox-label">
          <input
            type="checkbox"
            disabled={busy}
            checked={value.cashierEnabled}
            onChange={async (event) => {
              const enabled = event.target.checked;
              setBusy(true);
              setError('');
              try {
                setValue(
                  await api(path, {
                    method: 'PATCH',
                    revision: value.revision,
                    body: { cashierEnabled: enabled },
                  }),
                );
              } catch (error) {
                setError(errorText(error, lang));
                try {
                  setValue(await api(path));
                } catch {
                  /* Keep last committed setting. */
                }
              } finally {
                setBusy(false);
              }
            }}
          />
          {ar
            ? 'اسمح للكاشير يجهّز استرجاع على واتساب'
            : 'Allow cashiers to prepare WhatsApp recovery'}
        </label>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
