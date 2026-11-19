import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Grant, Language, Session } from '../../../../packages/contracts/src/index.js';
import { customerPhone } from '../../../../packages/contracts/src/customer-identity.js';
import { api, errorText, setCsrf } from '../api.js';
import { PhoneInput } from '../controls/PhoneInput.js';
import { Select } from '../controls/Select.js';
import { navigate } from '../useRoute.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function CustomerDeviceHelp({ lang }: { lang: Language }) {
  const ar = lang === 'ar';
  return (
    <main id="main" className="join-page">
      <section className="panel">
        <span className="eyebrow">{ar ? 'كارتك معاك' : 'Your loyalty card'}</span>
        <h1>{ar ? 'الكارت مش على الجهاز ده' : 'Your card is not on this device'}</h1>
        <p>
          {ar
            ? 'افتح كارتك من سكان كود المحل، أو اطلب من الكاشير يرجّعهولك بكود يظهر على موبايلك. مش محتاج إيميل أو باسورد.'
            : 'Scan the shop code to open your card, or ask the cashier to restore it with a code shown on your phone. You do not need an email or password.'}
        </p>
        {/* Staff open the same home-screen app; without this they have no way to their sign-in. */}
        <a
          className="staff-sign-in"
          href="/login"
          onClick={(e) => {
            e.preventDefault();
            navigate('/login');
          }}
        >
          {ar ? 'دخول الموظفين' : 'Staff sign in'}
        </a>
      </section>
    </main>
  );
}

type PairingState = {
  id: string;
  status: string;
  code?: string;
  expiresAt: string;
  merchantName?: string;
};

// /r/<merchantId>: the customer's own phone shows a code; the shop enters it.
// Staff never receive a link that opens the card (Security H1).
export function CustomerRecoveryPage({
  token,
  lang,
  refresh,
}: {
  token: string;
  lang: Language;
  session: Session | null;
  refresh: () => Promise<void>;
}) {
  const ar = lang === 'ar',
    merchantId = uuidPattern.test(token) ? token : '',
    [merchantName, setMerchantName] = useState(''),
    [pairing, setPairing] = useState<PairingState | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const consuming = useRef(false);
  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const boot = await api<{ csrfToken: string }>('/customer/bootstrap');
      setCsrf(boot.csrfToken);
      setPairing(
        await api<PairingState>('/customer/pairings', {
          method: 'POST',
          body: { merchantId },
        }),
      );
    } catch (e) {
      setError(errorText(e, lang).split(' · ')[0]!);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!merchantId) return;
    let alive = true;
    void api<{ merchantName: string }>('/customer/pairing-merchants/' + merchantId)
      .then((info) => {
        if (!alive) return;
        setMerchantName(info.merchantName);
        void start();
      })
      .catch((e) => {
        if (alive) setError(errorText(e, lang).split(' · ')[0]!);
      });
    return () => {
      alive = false;
    };
  }, [merchantId]);
  // Poll until the shop enters the code (and, for a cashier, a manager approves).
  useEffect(() => {
    if (!pairing || !['waiting', 'awaiting_approval', 'approved'].includes(pairing.status)) return;
    const consume = async () => {
      if (consuming.current) return;
      consuming.current = true;
      try {
        const result = await api<{ membershipId: string | null; csrfToken: string }>(
          '/customer/pairings/' + pairing.id + '/consume',
          { method: 'POST', body: {} },
        );
        setCsrf(result.csrfToken);
        await refresh();
        navigate(result.membershipId ? '/customer/' + result.membershipId : '/customer');
      } catch (e) {
        consuming.current = false;
        setError(errorText(e, lang).split(' · ')[0]!);
      }
    };
    if (pairing.status === 'approved') {
      void consume();
      return;
    }
    const timer = setInterval(() => {
      void api<PairingState>('/customer/pairings/' + pairing.id)
        .then((next) => setPairing((current) => (current ? { ...current, ...next } : next)))
        .catch(() => {
          /* Keep polling; the code stays visible. */
        });
    }, 3000);
    return () => clearInterval(timer);
  }, [pairing?.id, pairing?.status]);

  const status = pairing?.status;
  return (
    <main id="main" className="join-page">
      <section className="panel pairing-panel">
        <span className="eyebrow">{ar ? 'رجّع كارتك' : 'Restore your card'}</span>
        <h1>{merchantName || (ar ? 'كارتك قريب منك' : 'Your card, always close')}</h1>
        {!merchantId && (
          <p className="notice error" role="alert">
            {ar
              ? 'الرابط ده مبقاش شغال. اطلب من المحل يرجّع كارتك بكود يظهر على موبايلك.'
              : 'This link no longer works. Ask the shop to restore your card with a code shown on your phone.'}
          </p>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {status === 'waiting' && pairing?.code && (
          <>
            <p>
              {ar
                ? 'ورّي الكود ده للكاشير أو ابعته للمحل. الكود شغال على الموبايل ده بس.'
                : 'Show this code to the cashier or send it to the shop. It only works on this phone.'}
            </p>
            <div
              className="match-code pairing-code"
              dir="ltr"
              aria-label={ar ? 'كود الاسترجاع' : 'Recovery code'}
            >
              {pairing.code.slice(0, 3)} {pairing.code.slice(3)}
            </div>
            <p className="muted" role="status">
              {ar ? 'مستنيين المحل يدخّل الكود…' : 'Waiting for the shop to enter the code…'}
            </p>
          </>
        )}
        {status === 'awaiting_approval' && (
          <p role="status">
            {ar
              ? 'الكاشير دخّل الكود. مستنيين موافقة المدير أو المالك، وهيفتح الكارت لوحده.'
              : 'The cashier entered the code. Waiting for a manager or owner to approve; your card opens automatically.'}
          </p>
        )}
        {status === 'approved' && <p role="status">{ar ? 'بنفتح كارتك…' : 'Opening your card…'}</p>}
        {status && ['rejected', 'expired', 'cancelled', 'consumed'].includes(status) && (
          <p className="notice error" role="alert">
            {ar
              ? 'الكود ده انتهى أو اترفض. اطلب كود جديد.'
              : 'This code expired or was declined. Get a new code.'}
          </p>
        )}
        {merchantId &&
          (!status || ['rejected', 'expired', 'cancelled', 'consumed'].includes(status)) && (
            <button className="primary full" disabled={busy} onClick={() => void start()}>
              {ar ? 'كود جديد' : 'Get a new code'}
            </button>
          )}
        {(error || !merchantId) && (
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
    [code, setCode] = useState(''),
    [result, setResult] = useState<'approved' | 'awaiting_approval' | null>(null);
  const base = '/merchants/' + grant.merchant_id;
  const reset = () => {
    setFound(null);
    setSearched(false);
    setRequested(false);
    setCode('');
    setResult(null);
  };
  useEffect(() => {
    setBranch(branchId || grant.branches[0]?.id || '');
    setPhone('');
    reset();
  }, [branchId, grant.id]);
  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    reset();
    try {
      const response = await api<{ customer: FoundCustomer | null }>(
        base + '/customer-recovery/search',
        { method: 'POST', body: { phone, branchId: branch } },
      );
      setFound(response.customer);
      setSearched(true);
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  const pair = async (event: FormEvent) => {
    event.preventDefault();
    if (!found || !requested || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await api<{ status: 'approved' | 'awaiting_approval' }>(
        base + '/customer-pairings',
        {
          method: 'POST',
          body: {
            customerId: found.customerId,
            branchId: branch,
            code: code.replace(/\D/g, ''),
            requestedByCustomer: true,
          },
        },
      );
      setResult(response.status);
      setCode('');
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  // The WhatsApp draft carries only the shop's generic restore page — never a credential.
  const normalized = customerPhone.safeParse(phone);
  const restoreLink = location.origin + '/r/' + grant.merchant_id;
  const whatsapp =
    normalized.success && found
      ? 'https://wa.me/' +
        normalized.data.slice(1) +
        '?text=' +
        encodeURIComponent(
          ar
            ? `أهلًا ${found.name}، افتح الرابط ده من موبايلك وابعتلنا الكود اللي هيظهر علشان نرجّعلك كارتك 👇\n${restoreLink}`
            : `Hi ${found.name}, open this on your phone and send us the code it shows so we can restore your card:\n${restoreLink}`,
        )
      : '';
  return (
    <details className="panel customer-recovery-tool">
      <summary>{ar ? 'رجّع كارت عميل' : 'Restore a customer card'}</summary>
      <p className="muted">
        {ar
          ? 'بطلب العميل بس. دوّر برقمه كامل، والعميل يفتح صفحة الاسترجاع من موبايله ويديك الكود.'
          : 'Only at the customer’s request. Search their full number; the customer opens the restore page on their phone and gives you the code.'}
      </p>
      <form className="stack" onSubmit={(event) => void search(event)}>
        {!branchId && (
          <label>
            {ar ? 'الفرع' : 'Branch'}
            <Select
              value={branch}
              disabled={busy}
              onChange={(event) => {
                setBranch(event.target.value);
                reset();
              }}
            >
              {grant.branches.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
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
              reset();
            }}
          />
        </label>
        <div className="form-actions">
          <button className="secondary" disabled={busy || !branch}>
            {ar ? 'دوّر على الكارت' : 'Find the card'}
          </button>
        </div>
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
        <div className="subpanel stack">
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
          {requested && !result && (
            <>
              <ol className="muted">
                <li>
                  {ar ? 'العميل يفتح من موبايله: ' : 'The customer opens on their phone: '}
                  <bdi dir="ltr">{restoreLink}</bdi>
                </li>
                <li>
                  {ar
                    ? 'هيظهرله كود من 6 أرقام. اكتبه هنا.'
                    : 'A 6-digit code appears on their phone. Enter it here.'}
                </li>
              </ol>
              {whatsapp && (
                <div className="form-actions">
                  <a
                    className="secondary"
                    href={whatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {ar ? 'ابعت الرابط على واتساب' : 'Send the link on WhatsApp'}
                  </a>
                </div>
              )}
              <form className="stack" onSubmit={(event) => void pair(event)}>
                <label>
                  {ar ? 'الكود اللي على موبايل العميل' : 'Code on the customer’s phone'}
                  <input
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9 ]{6,7}"
                    maxLength={7}
                    required
                    disabled={busy}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </label>
                <div className="form-actions">
                  <button
                    className="primary"
                    disabled={busy || code.replace(/\D/g, '').length !== 6}
                  >
                    {ar ? 'اربط موبايل العميل' : 'Pair the customer’s phone'}
                  </button>
                </div>
              </form>
            </>
          )}
          {result === 'approved' && (
            <p className="notice success" role="status">
              {ar
                ? 'تمام. كارت العميل هيفتح على موبايله دلوقتي.'
                : 'Done. The card opens on the customer’s phone now.'}
            </p>
          )}
          {result === 'awaiting_approval' && (
            <p className="notice" role="status">
              {ar
                ? 'اتبعت للمدير أو المالك يوافق. الكارت هيفتح عند العميل أول ما يوافقوا.'
                : 'Sent to a manager or owner for approval. The card opens on the customer’s phone once approved.'}
            </p>
          )}
        </div>
      )}
    </details>
  );
}

interface PairingQueue {
  pending: {
    id: string;
    customerName: string;
    phone: string;
    branchName: string;
    requestedBy: string;
    requestedAt: string;
  }[];
  flaggedStaff: { staffName: string; count: number }[];
}
// Owner/manager: approve cashier pairings; see staff with unusually many recoveries.
export function PairingApprovals({ merchantId, lang }: { merchantId: string; lang: Language }) {
  const ar = lang === 'ar',
    [queue, setQueue] = useState<PairingQueue | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState('');
  const path = '/merchants/' + merchantId + '/customer-pairings';
  const load = async () => {
    try {
      setQueue(await api<PairingQueue>(path));
      setError('');
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [merchantId]);
  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    setError('');
    try {
      await api(path + '/' + id + '/decision', { method: 'POST', body: { approve } });
      await load();
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy('');
    }
  };
  if (!queue || (!queue.pending.length && !queue.flaggedStaff.length && !error)) return null;
  return (
    <section className="panel pairing-approvals" aria-live="polite">
      <h2>{ar ? 'طلبات استرجاع كروت' : 'Card recovery requests'}</h2>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {queue.pending.map((item) => (
        <div className="subpanel stack" key={item.id}>
          <strong>{item.customerName}</strong>
          <bdi dir="ltr">{item.phone}</bdi>
          <p className="muted">
            {ar
              ? `طلبه ${item.requestedBy} · ${item.branchName}`
              : `Requested by ${item.requestedBy} · ${item.branchName}`}
          </p>
          <div className="form-actions">
            <button
              className="primary"
              disabled={!!busy}
              onClick={() => void decide(item.id, true)}
            >
              {ar ? 'وافق' : 'Approve'}
            </button>
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() => void decide(item.id, false)}
            >
              {ar ? 'ارفض' : 'Decline'}
            </button>
          </div>
        </div>
      ))}
      {queue.flaggedStaff.length > 0 && (
        <div className="notice" role="note">
          <strong>{ar ? 'استرجاع كتير من نفس الشخص' : 'Unusual recovery activity'}</strong>
          <ul>
            {queue.flaggedStaff.map((row) => (
              <li key={row.staffName}>
                {ar
                  ? `${row.staffName}: ${row.count} استرجاع آخر 7 أيام`
                  : `${row.staffName}: ${row.count} recoveries in the last 7 days`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

interface DeviceNotice {
  id: string;
  merchantName: string;
  createdAt: string;
  deviceFamily: string;
  canRemove: boolean;
}
// Shown on the customer's other devices after a shop pairs a new phone to the card.
export function DeviceNotices({ lang }: { lang: Language }) {
  const ar = lang === 'ar',
    [notices, setNotices] = useState<DeviceNotice[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    void api<{ notices: DeviceNotice[] }>('/me/device-notices')
      .then((result) => setNotices(result.notices))
      .catch(() => {
        /* Notices are advisory; the card still works. */
      });
  }, []);
  const resolve = async (id: string, removeDevice: boolean) => {
    setBusy(true);
    setError('');
    try {
      await api('/me/device-notices/' + id, { method: 'POST', body: { removeDevice } });
      setNotices((list) => list.filter((item) => item.id !== id));
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  if (!notices.length) return null;
  return (
    <>
      {notices.map((notice) => (
        <section className="panel notice device-notice" role="alert" key={notice.id}>
          <strong>{ar ? 'اتضاف موبايل جديد لكارتك' : 'A new phone was added to your card'}</strong>
          <p>
            {ar
              ? `${notice.merchantName} ربط جهاز (${notice.deviceFamily}) بكارتك في ${new Date(notice.createdAt).toLocaleString('ar-EG-u-nu-latn')}. لو مش إنت، شيله.`
              : `${notice.merchantName} linked a device (${notice.deviceFamily}) to your card on ${new Date(notice.createdAt).toLocaleString('en-GB')}. If this wasn’t you, remove it.`}
          </p>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void resolve(notice.id, false)}
            >
              {ar ? 'ده أنا' : 'This was me'}
            </button>
            {notice.canRemove && (
              <button
                className="danger"
                disabled={busy}
                onClick={() => void resolve(notice.id, true)}
              >
                {ar ? 'مش أنا، شيل الجهاز' : 'Not me, remove it'}
              </button>
            )}
          </div>
        </section>
      ))}
    </>
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
      .then((next) => {
        if (alive) setValue(next);
      })
      .catch((e) => {
        if (alive) setError(errorText(e, lang));
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
          ? 'الاسترجاع بطلب العميل فقط. طلبات الكاشير بتستنى موافقة المالك أو المدير.'
          : 'Recovery is only at the customer’s request. Cashier requests wait for an owner or manager to approve.'}
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
              } catch (e) {
                setError(errorText(e, lang));
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
            ? 'اسمح للكاشير يطلب استرجاع (بموافقة المدير)'
            : 'Allow cashiers to request recovery (manager approval)'}
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
