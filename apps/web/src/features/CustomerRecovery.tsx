import { WhyDisabled } from '../controls/WhyDisabled.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Grant, Language, Session } from '../../../../packages/contracts/src/index.js';
import { customerPhone } from '../../../../packages/contracts/src/customer-identity.js';
import { api, errorText, setCsrf } from '../api.js';
import { PhoneInput } from '../controls/PhoneInput.js';
import { Select } from '../controls/Select.js';
import { navigate } from '../useRoute.js';
import { WhatsAppRestoreLink } from './CustomerWhatsApp.js';
import { holdUpdates } from '../update-gate.js';

// Perks support on WhatsApp (same number as the business page and the plan sheets).
const SUPPORT_PHONE = '201006111380';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function CustomerDeviceHelp({
  lang,
  refresh,
}: {
  lang: Language;
  refresh: () => Promise<void>;
}) {
  const ar = lang === 'ar',
    [number, setNumber] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || number.length !== 6) return;
    setBusy(true);
    setError('');
    try {
      const boot = await api<{ csrfToken: string }>('/customer/bootstrap');
      setCsrf(boot.csrfToken);
      const result = await api<{ membershipId: string; csrfToken: string }>(
        '/customer/card-number-login',
        { method: 'POST', body: { cardNumber: number } },
        false,
      );
      setCsrf(result.csrfToken);
      await refresh();
      navigate('/customer/' + result.membershipId);
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main id="main" className="join-page">
      <section className="panel">
        <span className="eyebrow">{ar ? 'كارتك معاك' : 'Your loyalty card'}</span>
        <h1>{ar ? 'الكارت مش على الجهاز ده' : 'Your card is not on this device'}</h1>
        <form className="stack" onSubmit={(event) => void signIn(event)}>
          <label>
            {ar ? 'رقم الكارت' : 'Card number'}
            <input
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={number}
              onChange={(event) => {
                setNumber(
                  event.target.value
                    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
                    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0))
                    .replace(/[^0-9]/g, ''),
                );
                setError('');
              }}
            />
          </label>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy || number.length !== 6}>
            {ar ? 'افتح كارتي' : 'Open my card'}
          </button>
        </form>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => navigate('/customer/restore')}>
            {ar ? 'رجّع كروتك' : 'Restore my cards'}
          </button>
        </div>
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

// The card could not be read just now (offline, timeout, server error). The device link is
// untouched, so this never says the card is missing: it says try again.
export function CustomerCardUnavailable({
  lang,
  retry,
}: {
  lang: Language;
  retry: () => Promise<void>;
}) {
  const ar = lang === 'ar',
    [busy, setBusy] = useState(false);
  return (
    <main id="main" className="join-page">
      <section className="panel" role="status">
        <span className="eyebrow">{ar ? 'كارتك معاك' : 'Your loyalty card'}</span>
        <h1>{ar ? 'مش قادرين نفتح كارتك دلوقتي' : 'We could not open your card just now'}</h1>
        <p>
          {ar
            ? 'كارتك لسه محفوظ على الجهاز ده. اتأكد من النت وجرّب تاني.'
            : 'Your card is still saved on this device. Check your connection and try again.'}
        </p>
        <button
          className="primary full"
          disabled={busy}
          aria-busy={busy}
          onClick={() => {
            setBusy(true);
            void retry().finally(() => setBusy(false));
          }}
        >
          {ar ? 'جرّب تاني' : 'Try again'}
        </button>
      </section>
    </main>
  );
}

// /customer/open?w=<key>: the "Open your card" link on an Apple or Google Wallet pass. On the phone
// that holds the card it just opens it; on a new phone it brings every card of the customer back.
export function WalletOpenPage({
  lang,
  refresh,
}: {
  lang: Language;
  refresh: () => Promise<void>;
}) {
  const ar = lang === 'ar',
    [error, setError] = useState(''),
    started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(location.search).get('w') || '';
    void (async () => {
      try {
        const boot = await api<{ csrfToken: string }>('/customer/bootstrap');
        setCsrf(boot.csrfToken);
        const result = await api<{ membershipId: string; csrfToken: string }>(
          '/customer/wallet-restore',
          { method: 'POST', body: { token } },
        );
        setCsrf(result.csrfToken);
        await refresh();
        navigate('/customer/' + result.membershipId);
      } catch (e) {
        setError(errorText(e, lang));
      }
    })();
  }, []);
  return (
    <main id="main" className="join-page">
      <section className="panel wallet-open">
        <span className="eyebrow">{ar ? 'من الـWallet' : 'From your Wallet'}</span>
        {error ? (
          <>
            <h1>{ar ? 'الرابط ده مش شغال' : 'This link did not work'}</h1>
            <p className="notice error" role="alert">
              {error}
            </p>
            <p>
              {ar
                ? 'لو كارتك لسه متحدّثش، استنى دقيقة وافتحه تاني من الـWallet. أو رجّع كروتك من هنا.'
                : 'If your card has not updated yet, wait a minute and open it again from Wallet. Or bring your cards back here.'}
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="primary"
                onClick={() => navigate('/customer/restore')}
              >
                {ar ? 'رجّع كروتك' : 'Restore my cards'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h1>{ar ? 'بنفتح كروتك…' : 'Opening your cards…'}</h1>
            <p role="status">
              {ar
                ? 'لو ده موبايل جديد، كل كروتك هترجع عليه.'
                : 'If this is a new phone, all your cards come back to it.'}
            </p>
          </>
        )}
      </section>
    </main>
  );
}

// /customer/restore: every way back to the cards, in the order that is easiest for the customer.
// No number is typed here: nothing on this page tells anyone whether a number has cards.
export function RestoreCardsPage({ lang }: { lang: Language }) {
  const ar = lang === 'ar';
  const support =
    'https://wa.me/' +
    SUPPORT_PHONE +
    '?text=' +
    encodeURIComponent(
      ar
        ? 'حد سجّل في Perks برقمي ده، وأنا عايز أسجّل بيه.'
        : 'Someone registered on Perks with this number of mine, and I want to use it.',
    );
  return (
    <main id="main" className="join-page">
      <section className="panel restore-doors">
        <span className="eyebrow">{ar ? 'كروتك مش ضايعة' : 'Your cards are safe'}</span>
        <h1>{ar ? 'رجّع كروتك' : 'Restore my cards'}</h1>
        <ol className="restore-list">
          <li>
            <strong>{ar ? 'من الـWallet (الأسرع)' : 'From your Wallet (fastest)'}</strong>
            <span>
              {ar
                ? 'عندك كارت Perks في Apple Wallet أو Google Wallet؟ افتحه، ودوس «افتح كارتك». كل كروتك هترجع على الموبايل ده.'
                : 'Have a Perks card in Apple Wallet or Google Wallet? Open it and tap “Open your card”. All your cards come back to this phone.'}
            </span>
          </li>
          <li>
            <strong>{ar ? 'من أي محل عليه Perks' : 'At any Perks shop'}</strong>
            <span>
              {ar
                ? 'اعمل سكان لكود المحل واكتب رقمك. هيظهرلك كود، ورّيه للكاشير وكارتك هناك هيتفتح.'
                : 'Scan the shop’s code and type your number. A code appears: show it to the cashier and your card there opens.'}
            </span>
          </li>
          <WhatsAppRestoreLink lang={lang} />
          <li>
            <strong>
              {ar
                ? 'لو فتحت من واتساب أو إنستجرام'
                : 'If you opened a link in WhatsApp or Instagram'}
            </strong>
            <span>
              {ar
                ? 'افتح نفس الرابط في Safari أو Chrome. التطبيقات دي ليها متصفح لوحدها مش شايف كارتك.'
                : 'Open the same link in Safari or Chrome. Those apps have their own browser that cannot see your card.'}
            </span>
          </li>
          <li>
            <strong>{ar ? 'حد سجّل برقمك؟' : 'Someone used your number?'}</strong>
            <span>
              {ar
                ? 'ابعتلنا واتساب من نفس الرقم، وهنرجّعهولك.'
                : 'Message us on WhatsApp from that number and we will give it back to you.'}
            </span>
            <a className="secondary small" href={support} target="_blank" rel="noopener noreferrer">
              {ar ? 'ابعت واتساب للدعم' : 'WhatsApp support'}
            </a>
          </li>
        </ol>
      </section>
    </main>
  );
}

// Enrollment with a number that already has cards on another phone (049): this phone shows a
// code, the cashier types the customer's number and the code, and a new card starts here.
export function JoinWithCode({
  merchantId,
  merchantName,
  phone,
  lang,
  onLinked,
  onBack,
}: {
  merchantId: string;
  merchantName: string;
  phone: string;
  lang: Language;
  onLinked: () => Promise<void>;
  onBack: () => void;
}) {
  const ar = lang === 'ar',
    [pairing, setPairing] = useState<PairingState | null>(null),
    [error, setError] = useState(''),
    started = useRef(false),
    linking = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void api<PairingState>('/customer/pairings', {
      method: 'POST',
      body: { merchantId, phone },
    })
      .then(setPairing)
      .catch((e) => setError(errorText(e, lang).split(' · ')[0]!));
  }, []);
  useEffect(() => {
    if (!pairing || !['waiting', 'approved'].includes(pairing.status)) return;
    if (pairing.status === 'approved') {
      if (linking.current) return;
      linking.current = true;
      void (async () => {
        try {
          const result = await api<{ csrfToken: string }>(
            '/customer/pairings/' + pairing.id + '/consume',
            { method: 'POST', body: {} },
          );
          setCsrf(result.csrfToken);
          await onLinked();
        } catch (e) {
          linking.current = false;
          setError(errorText(e, lang).split(' · ')[0]!);
        }
      })();
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
    <section className="panel pairing-panel" aria-live="polite">
      <span className="eyebrow">{merchantName}</span>
      <h2>{ar ? 'الرقم ده عليه كروت في Perks' : 'This number already has Perks cards'}</h2>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {status === 'waiting' && pairing?.code && (
        <>
          <p>
            {ar
              ? 'عشان نتأكد إنه رقمك، ورّي الكود ده للكاشير. هو هيكتب رقمك والكود، وكارتك هنا هيتفتح لوحده.'
              : 'To confirm it is your number, show this code to the cashier. They type your number and the code, and your card here opens by itself.'}
          </p>
          <div
            className="match-code pairing-code"
            dir="ltr"
            aria-label={ar ? 'كود الكاشير' : 'Code for the cashier'}
          >
            {pairing.code.slice(0, 3)} {pairing.code.slice(3)}
          </div>
          <p className="muted" role="status">
            {ar ? 'مستنيين الكاشير يدخّل الكود…' : 'Waiting for the cashier to enter the code…'}
          </p>
        </>
      )}
      {status === 'approved' && <p role="status">{ar ? 'بنفتح كارتك…' : 'Opening your card…'}</p>}
      {status && ['rejected', 'expired', 'cancelled'].includes(status) && (
        <p className="notice error" role="alert">
          {ar
            ? 'الكود ده خلص. ارجع واطلب كود جديد.'
            : 'This code ended. Go back and get a new one.'}
        </p>
      )}
      <p className="muted">
        {ar
          ? 'كروتك في المحلات التانية فاضلة على موبايلك القديم. عشان ترجعها كلها هنا، افتح أي كارت من الـWallet.'
          : 'Your other shops’ cards stay on your old phone. To bring them all here, open any card from your Wallet.'}
      </p>
      <div className="form-actions">
        <button type="button" className="text-button" onClick={onBack}>
          {ar ? 'رجوع' : 'Back'}
        </button>
        <button type="button" className="text-button" onClick={() => navigate('/customer/restore')}>
          {ar ? 'طرق تانية ترجّع كروتك' : 'Other ways to restore your cards'}
        </button>
      </div>
    </section>
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
    [revealed, setRevealed] = useState<{ membershipId: string; cardNumber: string } | null>(null),
    [searched, setSearched] = useState(false),
    [requested, setRequested] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [code, setCode] = useState(''),
    [result, setResult] = useState<'approved' | 'awaiting_approval' | null>(null),
    [joined, setJoined] = useState(false),
    [open, setOpen] = useState(false);
  // While open the cashier is mid-restore (a number or a code typed in): a silent update waits.
  useEffect(() => (open ? holdUpdates() : undefined), [open]);
  const base = '/merchants/' + grant.merchant_id;
  // No card here, but the customer's phone shows a code: their number is on Perks elsewhere.
  // The number and the code must both match; a new, empty card then starts at this shop.
  const join = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api(base + '/customer-pairings/join', {
        method: 'POST',
        body: { branchId: branch, phone, code: code.replace(/\D/g, '') },
      });
      setJoined(true);
      setCode('');
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  const reset = () => {
    setFound(null);
    setRevealed(null);
    setSearched(false);
    setRequested(false);
    setCode('');
    setResult(null);
    setJoined(false);
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
  const revealNumber = async (membershipId: string) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setRevealed(null);
    try {
      const { cardNumber } = await api<{ cardNumber: string }>(
        base + '/customer-recovery/card-number',
        { method: 'POST', body: { phone, branchId: branch, membershipId } },
      );
      setRevealed({ membershipId, cardNumber });
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
    <details
      className="panel customer-recovery-tool"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
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
          <WhyDisabled>
            {!branch &&
              (ar
                ? 'مفيش فرع شغال تختاره. فعّل فرع الأول من «الفروع».'
                : 'There is no active branch to choose. Activate one in Branches first.')}
          </WhyDisabled>
        </div>
      </form>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {searched && !found && (
        <div className="subpanel stack">
          <p role="status">
            {ar
              ? 'مفيش كارت بالرقم ده في نطاق الفرع.'
              : 'No card with this number is available in this branch.'}
          </p>
          {joined ? (
            <p className="notice success" role="status">
              {ar
                ? 'تمام. كارت العميل الجديد هيتفتح على موبايله دلوقتي.'
                : 'Done. The customer’s new card opens on their phone now.'}
            </p>
          ) : (
            <form className="stack" onSubmit={(e) => void join(e)}>
              <p className="muted">
                {ar
                  ? 'لو العميل قدامك وعلى موبايله كود من 6 أرقام (رقمه متسجّل في Perks في محل تاني)، اكتبه هنا.'
                  : 'If the customer is here and their phone shows a 6-digit code (their number is on Perks at another shop), type it here.'}
              </p>
              <label>
                {ar ? 'الكود اللي على موبايل العميل' : 'Code on the customer’s phone'}
                <input
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={7}
                  required
                  pattern="[0-9 ]{6,7}"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
              <div className="form-actions">
                <button className="primary" disabled={busy}>
                  {ar ? 'افتح له كارت هنا' : 'Start their card here'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
      {found && (
        <div className="subpanel stack">
          <strong>{found.name}</strong>
          <bdi dir="ltr">{found.phone}</bdi>
          {found.cards.map((card) => (
            <div key={card.membershipId} className="stack">
              <p>
                {card.programName} · {card.balance}/{card.threshold} {ar ? 'أختام' : 'stamps'}
              </p>
              {revealed?.membershipId === card.membershipId ? (
                <p role="status">
                  {ar ? 'رقم الكارت' : 'Card number'}{' '}
                  <strong>
                    <bdi dir="ltr">{revealed.cardNumber}</bdi>
                  </strong>{' '}
                  <button type="button" className="text-button" onClick={() => setRevealed(null)}>
                    {ar ? 'إخفاء' : 'Hide'}
                  </button>
                </p>
              ) : (
                <div className="form-actions">
                  <button
                    type="button"
                    className="secondary small"
                    disabled={busy}
                    onClick={() => void revealNumber(card.membershipId)}
                  >
                    {ar ? 'اعرض رقم الكارت' : 'Show card number'}
                  </button>
                </div>
              )}
            </div>
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
  kind: 'device_paired' | 'wallet_restored' | 'phone_verified' | 'card_number_login';
  merchantName: string | null;
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
            {notice.kind === 'wallet_restored'
              ? ar
                ? `كروتك اتفتحت على جهاز جديد (${notice.deviceFamily}) من كارت ${notice.merchantName} في الـWallet، في ${new Date(notice.createdAt).toLocaleString('ar-EG-u-nu-latn')}. لو مش إنت، شيله.`
                : `Your cards were opened on a new device (${notice.deviceFamily}) from the ${notice.merchantName} card in Wallet, on ${new Date(notice.createdAt).toLocaleString('en-GB')}. If this wasn’t you, remove it.`
              : notice.kind === 'card_number_login'
                ? ar
                  ? `رقم كارت ${notice.merchantName} اتستخدم لفتح الكارت على جهاز جديد (${notice.deviceFamily}). لو مش إنت، شيله.`
                  : `Your ${notice.merchantName} card number was used to sign in on a new device (${notice.deviceFamily}). If this wasn’t you, remove it.`
                : notice.kind === 'phone_verified'
                  ? ar
                    ? `كروتك اتفتحت على جهاز جديد (${notice.deviceFamily}) بعد تأكيد رقمك على واتساب، في ${new Date(notice.createdAt).toLocaleString('ar-EG-u-nu-latn')}. لو مش إنت، شيله.`
                    : `Your cards were opened on a new device (${notice.deviceFamily}) after your number was confirmed on WhatsApp, on ${new Date(notice.createdAt).toLocaleString('en-GB')}. If this wasn’t you, remove it.`
                  : ar
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
