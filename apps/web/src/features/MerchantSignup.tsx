import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText, setCsrf } from '../api.js';
import { PasswordField } from '../controls/PasswordField.js';

const RESEND_AFTER_SECONDS = 60;
/** The plan picked on the landing page, preselected later in the setup's payment step. */
export const SIGNUP_PLAN_KEY = 'perks-signup-plan';
const PLAN_NAMES: Record<string, string> = { starter: 'Starter', growth: 'Growth', pro: 'Pro' };

function rememberPlan(): string | null {
  const plan = new URLSearchParams(location.search).get('plan') ?? '';
  if (!PLAN_NAMES[plan]) return null;
  try {
    localStorage.setItem(SIGNUP_PLAN_KEY, plan);
  } catch {
    /* Storage blocked: the owner simply picks the plan again later. */
  }
  return plan;
}

/** Keeps the digits of a typed or pasted code, Arabic-Indic ones included, as Latin digits. */
const latinDigits = (value: string) =>
  value
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[^0-9]/g, '')
    .slice(0, 6);

type Step = 'details' | 'code' | 'password';

/**
 * Self sign-up in three steps on one page: name and email, the six-digit code emailed to that
 * address (proof the owner reads it), then the account password. Only then does the shop setup open.
 */
export function MerchantSignup({ lang }: { lang: Language }) {
  const ar = lang === 'ar';
  const [plan] = useState(rememberPlan);
  const [step, setStep] = useState<Step>('details');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Seconds until "send again" is offered, matching the server's one-minute spacing.
  const [wait, setWait] = useState(0);
  const [resent, setResent] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!wait) return;
    const timer = window.setTimeout(() => setWait((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);
  useEffect(() => {
    if (step === 'code') codeInput.current?.focus();
  }, [step]);

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  const sendCode = (again: boolean) =>
    run(async () => {
      await api('/auth/merchant-signup', { method: 'POST', body: { name, email, locale: lang } });
      setResent(again);
      setSentTo(email);
      setCode('');
      setStep('code');
      setWait(RESEND_AFTER_SECONDS);
    });
  const verify = () =>
    run(async () => {
      const result = await api<{ passwordToken: string }>('/auth/merchant-signup/verify', {
        method: 'POST',
        body: { email, code },
      });
      setToken(result.passwordToken);
      setStep('password');
    });
  const savePassword = () =>
    run(async () => {
      if (password !== confirm)
        throw new Error(ar ? 'كلمتا المرور مش متطابقين.' : 'Passwords do not match.');
      const result = await api<{ onboarding: boolean; csrfToken?: string }>(
        '/auth/password/reset',
        { method: 'POST', body: { token, password } },
      );
      if (result.csrfToken) setCsrf(result.csrfToken);
      location.assign(result.onboarding ? '/onboarding' : '/login');
    });
  const submit = (action: () => Promise<void>) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void action();
  };
  const failure =
    error != null ? (
      <p className="notice error" role="alert">
        {error instanceof Error && !('code' in error) ? error.message : errorText(error, lang)}
      </p>
    ) : null;
  const progress = (
    <ol className="signup-progress" aria-label={ar ? 'خطوات التسجيل' : 'Sign-up steps'}>
      {(['details', 'code', 'password'] as const).map((item, index) => (
        <li
          key={item}
          aria-current={item === step ? 'step' : undefined}
          className={
            ['details', 'code', 'password'].indexOf(step) > index
              ? 'done'
              : item === step
                ? 'current'
                : ''
          }
        >
          {
            {
              details: ar ? 'بياناتك' : 'Details',
              code: ar ? 'تأكيد الإيميل' : 'Verify email',
              password: ar ? 'الباسورد' : 'Password',
            }[item]
          }
        </li>
      ))}
    </ol>
  );

  return (
    <main id="main" className="auth-reset">
      <section className="panel" aria-labelledby="merchant-signup-title">
        {progress}
        {step === 'details' && (
          <>
            <h1 id="merchant-signup-title">
              {ar ? 'اعمل حساب لمحلّك' : 'Create your shop account'}
            </h1>
            <p className="muted">
              {ar
                ? 'اكتب اسمك وإيميلك وهنبعتلك كود من 6 أرقام نتأكد بيه إن الإيميل بتاعك. بعدها تختار باسورد، وتجهّز محلك وتدفع الاشتراك الشهري بـ InstaPay.'
                : 'Enter your name and email and we will send a 6-digit code to confirm the address is yours. Then choose a password, set up your shop and pay the monthly plan by InstaPay.'}
            </p>
            {plan && (
              <p className="notice">
                {ar ? 'اخترت باقة ' : 'You picked the '}
                <bdi>
                  <strong>{PLAN_NAMES[plan]}</strong>
                </bdi>
                {ar ? '. تقدر تغيّرها وقت الدفع.' : ' plan. You can change it at payment.'}
              </p>
            )}
            <form onSubmit={submit(() => sendCode(false))} aria-busy={busy}>
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
                  inputMode="email"
                  maxLength={254}
                  required
                  disabled={busy}
                  value={email}
                  onChange={(e) => setEmail(e.target.value.trim())}
                />
              </label>
              {failure}
              <p className="muted small-print">
                {ar ? 'بالتسجيل إنت موافق على ' : 'By signing up you agree to the '}
                <a href={'/terms?lang=' + lang}>{ar ? 'الشروط' : 'Terms'}</a>
                {ar ? ' و' : ' and '}
                <a href={'/privacy?lang=' + lang}>{ar ? 'سياسة الخصوصية' : 'Privacy policy'}</a>.
              </p>
              <div className="form-actions">
                <button className="primary" disabled={busy || (wait > 0 && email === sentTo)}>
                  {busy
                    ? ar
                      ? 'بنبعت…'
                      : 'Sending…'
                    : wait > 0 && email === sentTo
                      ? ar
                        ? `ابعت الكود (${wait})`
                        : `Send code in ${wait}s`
                      : ar
                        ? 'ابعت كود التأكيد'
                        : 'Send verification code'}
                </button>
              </div>
            </form>
          </>
        )}
        {step === 'code' && (
          <>
            <h1 id="merchant-signup-title">{ar ? 'اكتب كود التأكيد' : 'Enter your code'}</h1>
            <p>
              {ar ? 'بعتنا كود من 6 أرقام على:' : 'We sent a 6-digit code to:'}
              <span className="signup-email">
                <bdi dir="ltr">
                  <strong>{email}</strong>
                </bdi>
              </span>
              {ar ? 'الكود شغال 10 دقايق.' : 'It works for 10 minutes.'}
            </p>
            <form onSubmit={submit(verify)} aria-busy={busy}>
              <label>
                {ar ? 'الكود' : 'Code'}
                <input
                  ref={codeInput}
                  className="otp-input"
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  disabled={busy}
                  value={code}
                  onChange={(e) => setCode(latinDigits(e.target.value))}
                />
              </label>
              {failure}
              {resent && error == null && (
                <p className="notice success" role="status">
                  {ar
                    ? 'بعتنا كود جديد. استخدم آخر كود وصلك بس.'
                    : 'We sent a new code. Only the latest one works.'}
                </p>
              )}
              <p className="muted small-print">
                {ar
                  ? 'مش لاقيه؟ بص في الـSpam أو Promotions. ولو الإيميل ده عليه حساب قبل كده، مش هيوصلك كود: سجّل دخول أو استخدم «نسيت كلمة المرور».'
                  : 'Not there? Check Spam or Promotions. If this email already has an account no code is sent: sign in or use “Forgot password”.'}
              </p>
              <div className="form-actions">
                <button className="primary" disabled={busy || code.length !== 6}>
                  {busy ? (ar ? 'بنتأكد…' : 'Checking…') : ar ? 'تأكيد' : 'Verify'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || wait > 0}
                  onClick={() => void sendCode(true)}
                >
                  {wait > 0
                    ? ar
                      ? `ابعت كود جديد (${wait})`
                      : `New code in ${wait}s`
                    : ar
                      ? 'ابعت كود جديد'
                      : 'Send a new code'}
                </button>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setStep('details');
                  setResent(false);
                  setError(null);
                  setCode('');
                }}
              >
                {ar ? 'الإيميل غلط؟ صحّحه' : 'Wrong email? Change it'}
              </button>
            </form>
          </>
        )}
        {step === 'password' && (
          <>
            <h1 id="merchant-signup-title">{ar ? 'اختار باسورد لحسابك' : 'Choose a password'}</h1>
            <p className="notice success" role="status">
              {ar ? 'إيميلك اتأكد.' : 'Your email is verified.'}
            </p>
            <form onSubmit={submit(savePassword)} aria-busy={busy}>
              <input type="email" hidden readOnly autoComplete="username" value={email} />
              <PasswordField
                label={ar ? 'كلمة المرور' : 'Password'}
                lang={lang}
                required
                autoComplete="new-password"
                minLength={10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                hint={
                  <small className="field-hint">
                    {ar ? '10 حروف على الأقل.' : 'At least 10 characters.'}
                  </small>
                }
              />
              <PasswordField
                label={ar ? 'تأكيد كلمة المرور' : 'Confirm password'}
                lang={lang}
                required
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {failure}
              <div className="form-actions">
                <button className="primary" disabled={busy}>
                  {busy
                    ? ar
                      ? 'لحظة…'
                      : 'Please wait…'
                    : ar
                      ? 'احفظ وكمّل تجهيز المحل'
                      : 'Save and set up your shop'}
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
