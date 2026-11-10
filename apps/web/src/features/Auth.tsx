import { useEffect, useState, type FormEvent } from 'react';
import type { Language, CardData } from '../../../../packages/contracts/src/index.js';
import { LoyaltyCard } from '../../../../packages/ui/src/LoyaltyCard.js';
import { Icon } from '../../../../packages/ui/src/Icon.js';
import { api, errorText, setCsrf } from '../api.js';
import { portalInfo, type Portal } from '../portals.js';

const sample: CardData = {
  id: 'login-preview',
  merchant_id: 'preview',
  merchant_name: 'MORNING CLUB',
  alias: 'NOUR AHMED',
  program_name: 'A little ritual. A lovely reward.',
  threshold: 6,
  balance: 4,
  primary_color: '#173d37',
  accent_color: '#ddd3a7',
  surface_color: '#f5f1e7',
  template: 'classic',
  reward_title: 'Your next coffee, on us.',
  revision: 1,
  cycle_number: 1,
};
type Mail = { id: string; to: string; link?: string };
export function Login({
  lang,
  onSuccess,
  invited = false,
  portal,
}: {
  lang: Language;
  onSuccess: (portal?: Portal) => Promise<void>;
  invited?: boolean;
  portal?: Portal;
}) {
  const ar = lang === 'ar',
    [mode, setMode] = useState<'login' | 'reset'>('login'),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [sent, setSent] = useState(false),
    [local, setLocal] = useState(false),
    [mails, setMails] = useState<Mail[] | null>(null);
  useEffect(() => {
    void api<{ localMailAvailable: boolean }>('/auth/config')
      .then((config) =>
        setLocal(
          config.localMailAvailable && new URLSearchParams(location.search).get('dev') === '1',
        ),
      )
      .catch(() => {});
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'reset') {
        await api('/auth/password/reset-request', { method: 'POST', body: { email } });
        setSent(true);
      } else {
        const result = await api<{ csrfToken: string; portal?: Portal }>('/auth/login', {
          method: 'POST',
          body: { email, password },
        });
        setCsrf(result.csrfToken);
        setPassword('');
        await onSuccess(result.portal);
      }
    } catch (error) {
      setError(errorText(error, lang));
    } finally {
      setBusy(false);
    }
  };
  const switchMode = (next: typeof mode) => {
    setMode(next);
    setError('');
    setSent(false);
    setPassword('');
  };
  return (
    <main id="main" className="auth-layout">
      <section className="auth-story">
        <div className="auth-story-top">
          <span className="eyebrow">
            {ar ? 'Perks' : 'PERKS'} /{' '}
            {portal ? portalInfo[portal][lang] : ar ? 'كروت ولاء' : 'LOYALTY'}
          </span>
          <span className="auth-edition">
            {ar ? 'زيارات حلوة. وعلاقات بتكمّل.' : 'GOOD VISITS. GREAT RELATIONSHIPS.'}
          </span>
        </div>
        <h1>
          {portal === 'platform' ? (
            ar ? (
              'كل المحلات. رؤية واضحة.'
            ) : (
              'Every business. A clear view.'
            )
          ) : portal === 'cashier' ? (
            ar ? (
              'زيارة، ختم، ومكافأة.'
            ) : (
              'A visit. A stamp. A reward.'
            )
          ) : ar ? (
            <>
              زيارة حلوة.
              <br />
              وعلاقة <em>بتكمّل.</em>
            </>
          ) : (
            <>
              A good visit.
              <br />
              An even better <em>return.</em>
            </>
          )}
        </h1>
        <p>
          {portal
            ? portalInfo[portal][ar ? 'hintAr' : 'hintEn']
            : ar
              ? 'من أول ختم لحد المكافأة اللي ترجع عميلك. تجربة ولاء تشبه نشاطك، وتفضل معاه.'
              : 'From the first stamp to a reason to return. A loyalty experience with your name on it.'}
        </p>
        {portal === 'platform' || portal === 'cashier' ? (
          <div className="auth-role-story">
            <Icon name={portalInfo[portal].icon} size={68} />
            <strong>{portalInfo[portal][lang]}</strong>
            <span>{ar ? 'خطوات واضحة. تركيز على شغلك.' : 'Clear steps. Focus on your work.'}</span>
          </div>
        ) : (
          <div className="auth-card-stage">
            <div className="auth-card-back" aria-hidden="true" />
            <LoyaltyCard
              card={
                ar
                  ? {
                      ...sample,
                      merchant_name: 'نادي الصباح',
                      alias: 'نور أحمد',
                      program_name: 'زيارة حلوة ومكافأة أحلى.',
                      reward_title: 'قهوتك الجاية علينا.',
                    }
                  : sample
              }
              lang={lang}
            />
            <div className="auth-card-caption">
              <span className="caption-dot" />
              {ar ? 'كارت واحد. زيارات أكتر.' : 'ONE CARD. MORE REASONS TO RETURN.'}
            </div>
          </div>
        )}
        <div className="auth-story-foot">
          <span>
            01 — 02 — 03 — <b>{ar ? 'أقرب للمكافأة' : 'Closer to your reward'}</b>
          </span>
          <span>{ar ? 'معاك في كل زيارة.' : 'MADE FOR YOUR EVERYDAY.'}</span>
        </div>
      </section>

      <section className="auth-form-side">
        <div className="auth-form-wrap">
          <span className="eyebrow">
            {portal
              ? (ar ? 'دخول ' : 'SIGN IN / ') + portalInfo[portal][lang]
              : invited
                ? ar
                  ? 'أهلًا بيك في الفريق'
                  : 'WELCOME TO THE TEAM'
                : ar
                  ? 'أهلًا بيك في Perks'
                  : 'WELCOME TO PERKS'}
          </span>
          <h2>
            {mode === 'reset'
              ? ar
                ? 'نرجّعك لحسابك.'
                : 'Back to your account.'
              : ar
                ? 'حلو إنك رجعت.'
                : 'Good to have you back.'}
          </h2>
          <p className="auth-description">
            {mode === 'reset'
              ? ar
                ? 'اكتب بريدك وهنبعت لك رابط تعيين باسورد جديد.'
                : 'Enter your email for a link to choose a new password.'
              : ar
                ? 'ادخل بإيميلك وباسوردك. هنفتح لك مساحة حسابك تلقائيًا.'
                : 'Sign in with your email and password. Your account opens the right workspace automatically.'}
          </p>
          <form onSubmit={(event) => void submit(event)}>
            <label>
              {ar ? 'البريد الإلكتروني' : 'Email'}
              <input
                required
                type="email"
                autoComplete="username"
                dir="ltr"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
              />
            </label>
            {mode === 'login' && (
              <label>
                {ar ? 'كلمة المرور' : 'Password'}
                <div className="password-control">
                  <input
                    aria-label={ar ? 'كلمة المرور' : 'Password'}
                    required
                    type={visible ? 'text' : 'password'}
                    autoComplete="current-password"
                    maxLength={128}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    dir="ltr"
                  />
                  <button
                    type="button"
                    className="password-reveal"
                    aria-label={
                      ar
                        ? visible
                          ? 'إخفاء كلمة المرور'
                          : 'إظهار كلمة المرور'
                        : visible
                          ? 'Hide password'
                          : 'Show password'
                    }
                    onClick={() => setVisible(!visible)}
                  >
                    <Icon name={visible ? 'eyeOff' : 'eye'} size={19} />
                  </button>
                </div>
              </label>
            )}
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            {sent && (
              <p role="status" className="notice success">
                {ar
                  ? 'لو البريد مسجل، هنبعتلك رابط استعادة الحساب.'
                  : 'If the account exists, a recovery link is on its way.'}
              </p>
            )}
            <button className="primary auth-submit" disabled={busy} aria-busy={busy}>
              {busy
                ? ar
                  ? 'لحظة…'
                  : 'Please wait…'
                : mode === 'reset'
                  ? ar
                    ? 'ابعت رابط الاستعادة'
                    : 'Send recovery link'
                  : ar
                    ? 'دخول'
                    : 'Sign in'}
              <span aria-hidden="true">{ar ? '←' : '→'}</span>
            </button>
          </form>
          <div className="auth-switch">
            <button
              className="text-button"
              onClick={() => switchMode(mode === 'login' ? 'reset' : 'login')}
            >
              {mode === 'login'
                ? ar
                  ? 'نسيت كلمة المرور؟'
                  : 'Forgot password?'
                : ar
                  ? 'عندك حساب؟ سجّل دخول'
                  : 'Already have an account? Sign in'}
            </button>
          </div>
          {local && (
            <details className="local-inbox">
              <summary>
                {ar
                  ? 'بريد التجربة: الدعوات واستعادة الحساب'
                  : 'Test inbox: invitations and account recovery'}
              </summary>
              <button
                className="text-button"
                onClick={() =>
                  void api<{ messages: Mail[] }>('/local/mail')
                    .then((r) => setMails(r.messages))
                    .catch((e) => setError(errorText(e, lang)))
                }
              >
                {ar ? 'افتح البريد المحلي' : 'Open local mailbox'}
              </button>
              {mails && (
                <div className="mailbox">
                  {mails
                    .filter(
                      (m) =>
                        m.link?.startsWith(location.origin + '/invite/') ||
                        m.link?.startsWith(location.origin + '/reset-password/'),
                    )
                    .map((m) => (
                      <div key={m.id}>
                        <bdi>{m.to}</bdi>
                        <a href={m.link}>
                          {m.link?.includes('/invite/')
                            ? ar
                              ? 'افتح الدعوة'
                              : 'Open invitation'
                            : ar
                              ? 'اختار باسورد جديد'
                              : 'Choose a new password'}
                        </a>
                      </div>
                    ))}
                </div>
              )}
            </details>
          )}

          <div className="auth-trust">
            <Icon name="shield" size={18} />
            {ar
              ? 'مساحتك، فريقك، وعملاؤك. كل واحد بصلاحيته.'
              : 'Your workspace. The right access for everyone.'}
          </div>
        </div>
      </section>
    </main>
  );
}
export function ResetPassword({ token, lang }: { token: string; lang: Language }) {
  const ar = lang === 'ar',
    [password, setPassword] = useState(''),
    [confirm, setConfirm] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState(false);
  return (
    <main id="main" className="auth-reset">
      <section className="panel">
        <span className="eyebrow">PERKS ACCOUNT</span>
        <h1>{ar ? 'باسورد جديد. بداية سهلة.' : 'A fresh password.'}</h1>
        {done ? (
          <>
            <p role="status">
              {ar
                ? 'اتحفظ الباسورد الجديد. ادخل بيه دلوقتي.'
                : 'Password saved. Sign in with it now.'}
            </p>
            <button
              className="primary"
              onClick={() => {
                setCsrf('');
                location.assign('/');
              }}
            >
              {ar ? 'تسجيل الدخول' : 'Sign in'}
            </button>
          </>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (password !== confirm) {
                setError(ar ? 'كلمتا المرور مش متطابقين.' : 'Passwords do not match.');
                return;
              }
              setBusy(true);
              setError('');
              try {
                await api('/auth/password/reset', { method: 'POST', body: { token, password } });
                setDone(true);
                setPassword('');
                setConfirm('');
              } catch (e) {
                setError(errorText(e, lang));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {ar ? 'كلمة المرور الجديدة' : 'New password'}
              <input
                required
                type="password"
                autoComplete="new-password"
                minLength={10}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label>
              {ar ? 'تأكيد كلمة المرور' : 'Confirm password'}
              <input
                required
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy} aria-busy={busy}>
              {ar ? 'حفظ كلمة المرور' : 'Save password'}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
export function PasswordSettings({
  lang,
  refresh,
}: {
  lang: Language;
  refresh: () => Promise<void>;
}) {
  const ar = lang === 'ar',
    [current, setCurrent] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  return (
    <details className="panel password-settings">
      <summary>{ar ? 'تغيير كلمة المرور' : 'Change password'}</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          setMessage('');
          try {
            const r = await api<{ csrfToken: string }>('/auth/password/change', {
              method: 'POST',
              body: { currentPassword: current, password },
            });
            setCsrf(r.csrfToken);
            await refresh();
            setCurrent('');
            setPassword('');
            setMessage(
              ar
                ? 'اتغير الباسورد واتقفلت الجلسات القديمة.'
                : 'Password changed. Other sessions signed out.',
            );
          } catch (e) {
            setError(errorText(e, lang));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {ar ? 'كلمة المرور الحالية' : 'Current password'}
          <input
            required
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label>
          {ar ? 'كلمة المرور الجديدة' : 'New password'}
          <input
            required
            type="password"
            autoComplete="new-password"
            minLength={10}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="notice success">
            {message}
          </p>
        )}
        <button className="primary" disabled={busy} aria-busy={busy}>
          {ar ? 'حفظ الباسورد' : 'Save password'}
        </button>
      </form>
    </details>
  );
}
