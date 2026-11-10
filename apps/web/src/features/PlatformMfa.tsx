import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';

export function PlatformMfa({
  lang,
  onVerified,
}: {
  lang: Language;
  onVerified: () => Promise<void>;
}) {
  const ar = lang === 'ar';
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<{ configured: boolean }>('/auth/mfa/status')
      .then((r) => setConfigured(r.configured))
      .catch((e) => setError(errorText(e, lang)));
  }, [lang]);
  async function submit(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel platform-mfa">
      <span className="eyebrow">{ar ? 'حماية حساب الإدارة' : 'ADMIN ACCOUNT SECURITY'}</span>
      <h1>
        {codes.length
          ? ar
            ? 'احفظ أكواد الاسترجاع'
            : 'Save your recovery codes'
          : configured
            ? ar
              ? 'أكد هويتك'
              : 'Verify your identity'
            : ar
              ? 'جهّز تطبيق التحقق'
              : 'Set up your authenticator'}
      </h1>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {codes.length ? (
        <>
          <p>
            {ar
              ? 'الأكواد دي بتظهر مرة واحدة. احفظها في مكان خاص؛ كل كود بيشتغل مرة واحدة لو موبايلك مش متاح.'
              : 'These codes are shown once. Keep them somewhere private. Each code works once if your phone is unavailable.'}
          </p>
          <ol className="mfa-recovery-codes" dir="ltr">
            {codes.map((value) => (
              <li key={value}>
                <code>{value}</code>
              </li>
            ))}
          </ol>
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void submit(async () => {
                await onVerified();
                setCodes([]);
              })
            }
          >
            {ar ? 'حفظت الأكواد، كمّل' : 'I saved the codes. Continue'}
          </button>
        </>
      ) : configured === null ? (
        <p role="status">{ar ? 'بنراجع إعدادات الحماية…' : 'Loading security settings…'}</p>
      ) : !configured && !setup ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(async () => {
              const next = await api<{ secret: string; qrDataUrl: string }>('/auth/mfa/setup', {
                method: 'POST',
                body: { currentPassword: password },
              });
              setSetup(next);
              setPassword('');
            });
          }}
        >
          <p>
            {ar
              ? 'إدارة المنصة محتاجة تحقق إضافي في الإنتاج. افتح تطبيق تحقق على موبايلك؛ هنعرض QR توصله بحسابك.'
              : 'Platform administration requires extra verification in production. Use an authenticator app on your phone to scan your account QR.'}
          </p>
          <label>
            {ar ? 'الباسورد الحالي' : 'Current password'}
            <input
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            {ar ? 'عرض QR التحقق' : 'Show authenticator QR'}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(async () => {
              const result = await api<{ recoveryCodes?: string[] }>(
                setup ? '/auth/mfa/confirm' : recovery ? '/auth/mfa/recover' : '/auth/mfa/verify',
                { method: 'POST', body: { code } },
              );
              setCode('');
              setSetup(null);
              if (result.recoveryCodes) setCodes(result.recoveryCodes);
              else await onVerified();
            });
          }}
        >
          {setup && (
            <>
              <img
                className="mfa-qr"
                src={setup.qrDataUrl}
                width={240}
                height={240}
                alt={ar ? 'QR إعداد تطبيق التحقق' : 'Authenticator setup QR'}
              />
              <details>
                <summary>{ar ? 'إدخال المفتاح يدويًا' : 'Enter the key manually'}</summary>
                <p dir="ltr">
                  <code>{setup.secret}</code>
                </p>
              </details>
              <p>
                {ar
                  ? 'امسح QR من تطبيق التحقق، واكتب الرمز اللي ظهر. التجهيز صالح ١٠ دقايق.'
                  : 'Scan this QR in your authenticator and enter its code. Setup expires in 10 minutes.'}
              </p>
            </>
          )}
          <label>
            {recovery
              ? ar
                ? 'كود استرجاع غير مستخدم'
                : 'Unused recovery code'
              : ar
                ? 'رمز تطبيق التحقق'
                : 'Authenticator code'}
            <input
              dir="ltr"
              autoComplete="one-time-code"
              inputMode={recovery ? 'text' : 'numeric'}
              required
              pattern={recovery ? undefined : '[0-9]{6}'}
              maxLength={recovery ? 80 : 6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            {ar ? 'تأكيد الهوية' : 'Verify identity'}
          </button>
          {setup && (
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setSetup(null);
                setCode('');
              }}
            >
              {ar ? 'تجهيز QR جديد' : 'Start setup again'}
            </button>
          )}
          {configured && (
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setRecovery(!recovery);
                setCode('');
                setError('');
              }}
            >
              {recovery
                ? ar
                  ? 'استخدم تطبيق التحقق'
                  : 'Use authenticator'
                : ar
                  ? 'استخدم كود استرجاع'
                  : 'Use a recovery code'}
            </button>
          )}
        </form>
      )}
    </section>
  );
}
