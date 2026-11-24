import { useState, type FormEvent } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';

export function MerchantSignup({ lang }: { lang: Language }) {
  const ar = lang === 'ar';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/auth/merchant-signup', { method: 'POST', body: { name, email, locale: lang } });
      setSent(true);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className="auth-reset">
      <section className="panel" aria-labelledby="merchant-signup-title">
        <h1 id="merchant-signup-title">{ar ? 'اعمل حساب لمحلّك' : 'Create your shop account'}</h1>
        {sent ? (
          <>
            <p role="status">
              {ar
                ? 'لو الإيميل متاح للتسجيل، هيوصلك لينك تعيين كلمة المرور.'
                : 'If this email can be registered, you’ll receive a link to set your password.'}
            </p>
            <button type="button" className="secondary" onClick={() => setSent(false)}>
              {ar ? 'ارجع لبيانات التسجيل' : 'Back to signup details'}
            </button>
          </>
        ) : (
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
            <div className="form-actions">
              <button className="primary" disabled={busy}>
                {busy
                  ? ar
                    ? 'بنرسل…'
                    : 'Sending…'
                  : ar
                    ? 'ابعت لينك التسجيل'
                    : 'Send signup link'}
              </button>
            </div>
          </form>
        )}
        <p>
          <a href="/onboarding">{ar ? 'عندك حساب؟ سجّل دخول' : 'Already registered? Sign in'}</a>
        </p>
      </section>
    </main>
  );
}
