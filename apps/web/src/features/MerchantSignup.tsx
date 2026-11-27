import { useEffect, useState, type FormEvent } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';

const RESEND_AFTER_SECONDS = 60;

export function MerchantSignup({ lang }: { lang: Language }) {
  const ar = lang === 'ar';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Seconds until "send again" is offered, so a waiting owner does not hit the rate limit.
  const [wait, setWait] = useState(0);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (!wait) return;
    const timer = window.setTimeout(() => setWait((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  async function send() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/auth/merchant-signup', { method: 'POST', body: { name, email, locale: lang } });
      setResent(sent);
      setSent(true);
      setWait(RESEND_AFTER_SECONDS);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send();
  }

  return (
    <main id="main" className="auth-reset">
      <section className="panel" aria-labelledby="merchant-signup-title">
        {sent ? (
          <>
            <h1 id="merchant-signup-title">{ar ? 'بص على إيميلك' : 'Check your email'}</h1>
            <p role="status">
              {ar ? 'بعتنا لينك على ' : 'We sent a link to '}
              <bdi dir="ltr">
                <strong>{email}</strong>
              </bdi>
              {ar
                ? '. افتحه واختار باسورد لحسابك عشان تكمّل تجهيز محلك. اللينك شغال 24 ساعة.'
                : '. Open it and choose a password to carry on setting up your shop. The link works for 24 hours.'}
            </p>
            <p className="muted">
              {ar
                ? 'مش لاقيه؟ بص في الـSpam أو Promotions. ولو عندك حساب بالإيميل ده قبل كده، سجّل دخول أو استخدم «نسيت كلمة المرور».'
                : 'Not there? Check Spam or Promotions. If this email already has an account, sign in or use “Forgot password”.'}
            </p>
            {error != null && (
              <p className="notice error" role="alert">
                {errorText(error, lang)}
              </p>
            )}
            {resent && !wait && error == null && (
              <p className="notice success" role="status">
                {ar ? 'بعتنا اللينك تاني.' : 'We sent the link again.'}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="primary"
                disabled={busy || wait > 0}
                onClick={() => void send()}
              >
                {busy
                  ? ar
                    ? 'بنبعت…'
                    : 'Sending…'
                  : wait > 0
                    ? ar
                      ? `ابعت تاني (${wait})`
                      : `Send again in ${wait}s`
                    : ar
                      ? 'ابعت اللينك تاني'
                      : 'Send the link again'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setSent(false);
                  setResent(false);
                  setError(null);
                }}
              >
                {ar ? 'غيّر الإيميل' : 'Use another email'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 id="merchant-signup-title">
              {ar ? 'اعمل حساب لمحلّك' : 'Create your shop account'}
            </h1>
            <p className="muted">
              {ar
                ? 'اكتب اسمك وإيميلك وهنبعتلك لينك تختار منه باسورد. بعدها تجهّز محلك في 4 خطوات وتدفع الاشتراك الشهري بـ InstaPay.'
                : 'Enter your name and email and we will send you a link to choose a password. Then set up your shop in four steps and pay the monthly plan by InstaPay.'}
            </p>
            <form onSubmit={submit} aria-busy={busy}>
              <label>
                {ar ? 'اسمك' : 'Your name'}
                <input
                  autoComplete="name"
                  minLength={2}
                  maxLength={120}
                  required
                  disabled={busy}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                {ar ? 'الإيميل' : 'Email'}
                <input
                  type="email"
                  dir="ltr"
                  autoComplete="email"
                  maxLength={254}
                  required
                  disabled={busy}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              {error != null && (
                <p className="notice error" role="alert">
                  {errorText(error, lang)}
                </p>
              )}
              <p className="muted small-print">
                {ar ? 'بالتسجيل إنت موافق على ' : 'By signing up you agree to the '}
                <a href={'/terms?lang=' + lang}>{ar ? 'الشروط' : 'Terms'}</a>
                {ar ? ' و' : ' and '}
                <a href={'/privacy?lang=' + lang}>{ar ? 'سياسة الخصوصية' : 'Privacy policy'}</a>.
              </p>
              <div className="form-actions">
                <button className="primary" disabled={busy}>
                  {busy
                    ? ar
                      ? 'بنبعت…'
                      : 'Sending…'
                    : ar
                      ? 'ابعت لينك التسجيل'
                      : 'Send signup link'}
                </button>
              </div>
            </form>
          </>
        )}
        <p>
          <a href="/login">{ar ? 'عندك حساب؟ سجّل دخول' : 'Already registered? Sign in'}</a>
        </p>
      </section>
    </main>
  );
}
