import { useEffect, useState, type FormEvent } from 'react';
import type { Language, Session } from '../../../../packages/contracts/src/index.js';
import {
  customerPhone,
  type WhatsAppProofPurpose,
} from '../../../../packages/contracts/src/customer-identity.js';
import { api, ApiError, errorText, setCsrf } from '../api.js';
import { PhoneInput } from '../controls/PhoneInput.js';
import { navigate } from '../useRoute.js';

const path = '/customer/whatsapp';
type Availability = {
  enabled: boolean;
  account: { phone: string | null; verified: boolean } | null;
};
type Proof = { code: string; url: string; expiresAt: string; phone: string };

function useWhatsAppAvailability() {
  const [availability, setAvailability] = useState<Availability | null>(null);
  useEffect(() => {
    let current = true;
    void api<Availability>(path)
      .then((result) => {
        if (current) setAvailability(result);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);
  return { availability, setAvailability };
}

export function CustomerPhoneSettings({ lang }: { lang: Language }) {
  const { availability, setAvailability } = useWhatsAppAvailability();
  if (!availability?.account) return null;
  const ar = lang === 'ar';
  return (
    <section className="panel">
      <h2>{ar ? 'رقم موبايلك' : 'Your mobile number'}</h2>
      {availability.account.phone && (
        <p>
          <bdi>{availability.account.phone}</bdi>
          {' · '}
          {availability.account.verified
            ? ar
              ? 'متأكد على واتساب'
              : 'Verified on WhatsApp'
            : ar
              ? 'محتاج تأكيد'
              : 'Verification needed'}
        </p>
      )}
      <p className="muted">
        {ar
          ? 'أكّد رقمك على واتساب عشان تقدر ترجع كروتك لو غيّرت الموبايل. لو رقمك اتغيّر، اكتب الجديد.'
          : 'Verify your number on WhatsApp to restore your cards on a new phone. If your number changed, enter the new one.'}
      </p>
      <WhatsAppProof
        lang={lang}
        purpose="update"
        onComplete={async () => {
          setAvailability(await api<Availability>(path));
        }}
      />
    </section>
  );
}

export function WhatsAppRestore({
  lang,
  phone,
  onRestored,
}: {
  lang: Language;
  phone?: string;
  onRestored: () => Promise<void>;
}) {
  const { availability } = useWhatsAppAvailability();
  if (!availability?.enabled) return null;
  const ar = lang === 'ar';
  return (
    <>
      <strong>{ar ? 'من واتساب' : 'Using WhatsApp'}</strong>
      <p className="muted">
        {ar
          ? 'لو أكدت رقمك قبل كده في حسابك، ابعت رسالة من نفس الرقم عشان تفتح كل كروتك هنا.'
          : 'If you verified your number in your account, send a message from that same number to open all your cards here.'}
      </p>
      <WhatsAppProof lang={lang} initialPhone={phone} purpose="restore" onComplete={onRestored} />
    </>
  );
}

export function WhatsAppRestorePage({
  lang,
  refresh,
}: {
  lang: Language;
  refresh: () => Promise<void>;
}) {
  return (
    <main id="main" className="join-page">
      <section className="panel">
        <h1>{lang === 'ar' ? 'رجّع كروتك' : 'Restore your cards'}</h1>
        <WhatsAppRestore
          lang={lang}
          onRestored={async () => {
            await refresh();
            navigate('/customer');
          }}
        />
        <button className="text-button" type="button" onClick={() => navigate('/customer/restore')}>
          {lang === 'ar' ? 'طرق تانية للاسترجاع' : 'Other ways to restore your cards'}
        </button>
      </section>
    </main>
  );
}

export function WhatsAppRestoreLink({ lang }: { lang: Language }) {
  const { availability } = useWhatsAppAvailability();
  return availability?.enabled ? (
    <li>
      <strong>{lang === 'ar' ? 'من واتساب' : 'Using WhatsApp'}</strong>
      <button
        type="button"
        className="secondary small"
        onClick={() => navigate('/customer/restore/whatsapp')}
      >
        {lang === 'ar' ? 'رجّع كروتك بواتساب' : 'Restore your cards with WhatsApp'}
      </button>
    </li>
  ) : null;
}

function WhatsAppProof({
  lang,
  purpose,
  initialPhone = '',
  onComplete,
}: {
  lang: Language;
  purpose: WhatsAppProofPurpose;
  initialPhone?: string;
  onComplete: () => Promise<void>;
}) {
  const ar = lang === 'ar';
  const [phone, setPhone] = useState(initialPhone);
  const [proof, setProof] = useState<Proof | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const start = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = customerPhone.safeParse(phone);
    if (!parsed.success) {
      setError(ar ? 'اكتب رقم موبايل صحيح.' : 'Enter a valid mobile number.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      try {
        const session = await api<Session>('/session');
        setCsrf(session.csrfToken);
      } catch (e) {
        if (purpose === 'update' || !(e instanceof ApiError) || e.status !== 401) throw e;
        const boot = await api<{ csrfToken: string }>('/customer/bootstrap');
        setCsrf(boot.csrfToken);
      }
      const result = await api<Omit<Proof, 'phone'>>(path + '/start', {
        method: 'POST',
        body: { phone: parsed.data, purpose },
      });
      setProof({ ...result, phone: parsed.data });
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!proof) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (Date.parse(proof.expiresAt) <= Date.now())
        throw new ApiError('WHATSAPP_PROOF_EXPIRED', 410);
      const result = await api<{ status: 'waiting' | 'updated' | 'restored'; csrfToken?: string }>(
        path + '/finish',
        {
          method: 'POST',
          body: { phone: proof.phone, code: proof.code },
        },
      );
      if (result.status === 'waiting') {
        setMessage(
          ar
            ? 'الرسالة لسه ما وصلتش. اتأكد إنك بعتها من نفس الرقم وجرّب تاني.'
            : 'The message hasn’t arrived yet. Check that you sent it from the same number and try again.',
        );
        return;
      }
      if (result.csrfToken) setCsrf(result.csrfToken);
      await onComplete();
      setProof(null);
      setPhone('');
      if (result.status === 'updated')
        setMessage(ar ? 'رقمك اتأكد واتحفظ.' : 'Your number was verified and saved.');
    } catch (e) {
      if (
        e instanceof ApiError &&
        [
          'WHATSAPP_PROOF_EXPIRED',
          'WHATSAPP_PHONE_IN_USE',
          'WHATSAPP_RECOVERY_UNAVAILABLE',
        ].includes(e.code)
      )
        setProof(null);
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {proof ? (
        <>
          <p>
            {ar
              ? 'افتح واتساب وابعت الرسالة الجاهزة من الرقم ده، وبعدها ارجع هنا.'
              : 'Open WhatsApp and send the prepared message from this number, then come back here.'}{' '}
            <bdi>{proof.phone}</bdi>
          </p>
          <div className="form-actions">
            <a className="primary" href={proof.url} target="_blank" rel="noopener noreferrer">
              {ar ? 'افتح واتساب' : 'Open WhatsApp'}
            </a>
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => void finish()}
            >
              {ar ? 'بعت الرسالة' : 'I sent the message'}
            </button>
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setProof(null);
                setError('');
                setMessage('');
              }}
            >
              {ar ? 'عدّل الرقم' : 'Edit number'}
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={(event) => void start(event)}>
          <label>
            {ar ? 'رقم واتساب' : 'WhatsApp number'}
            <PhoneInput
              lang={lang}
              aria-label={ar ? 'رقم واتساب' : 'WhatsApp number'}
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <button className="primary" disabled={busy} aria-busy={busy}>
            {ar ? 'كمّل على واتساب' : 'Continue on WhatsApp'}
          </button>
        </form>
      )}
      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
