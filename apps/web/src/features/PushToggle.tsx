import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { enablePush, pushState, sendTestPush, unlinkPushDevice, type PushState } from '../push.js';

// "Enable notifications" for a cashier's phone. Renders nothing while the server has Web Push off.
export function PushToggle({ lang }: { lang: Language }) {
  const ar = lang === 'ar',
    [state, setState] = useState<PushState>('loading'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      void pushState(lang).then((next) => {
        if (alive) setState(next);
      });
    refresh();
    // The service worker asks for a fresh registration after the push service replaced the subscription.
    const changed = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED') refresh();
    };
    navigator.serviceWorker?.addEventListener('message', changed);
    return () => {
      alive = false;
      navigator.serviceWorker?.removeEventListener('message', changed);
    };
  }, [lang]);
  if (state === 'loading' || state === 'unavailable') return null;
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch {
      setMessage(
        ar ? 'ماقدرناش نفعّل الإشعارات. جرّب تاني.' : 'Could not change notifications. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel push-toggle" aria-labelledby="push-toggle-title">
      <h2 id="push-toggle-title">{ar ? 'إشعارات طلبات الأختام' : 'Stamp request notifications'}</h2>
      {state === 'on' ? (
        <>
          <p className="muted">
            {ar
              ? 'الإشعارات شغالة على الجهاز ده. هيوصلك تنبيه لما عميل يبعت طلب ختم لفرعك.'
              : 'Notifications are on for this device. You will be alerted when a customer sends a stamp request to your branch.'}
          </p>
          <div className="button-row">
            <button
              className="secondary small"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setMessage(
                    (await sendTestPush())
                      ? ar
                        ? 'بعتنا إشعار تجربة.'
                        : 'Test notification sent.'
                      : ar
                        ? 'الإشعار ماوصلش. جرّب تفعّل الإشعارات تاني.'
                        : 'The test did not arrive. Try turning notifications on again.',
                  );
                })
              }
            >
              {ar ? 'ابعت إشعار تجربة' : 'Send a test'}
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await unlinkPushDevice();
                  setState('off');
                })
              }
            >
              {ar ? 'إيقاف' : 'Turn off'}
            </button>
          </div>
        </>
      ) : state === 'needs-install' ? (
        <p className="muted">
          {ar
            ? 'علشان الإشعارات تشتغل على الآيفون، ضيف Perks للشاشة الرئيسية الأول (مشاركة ← إضافة إلى الشاشة الرئيسية) وافتحه من هناك.'
            : 'On iPhone, add Perks to your Home Screen first (Share → Add to Home Screen), then open it from there.'}
        </p>
      ) : state === 'unsupported' ? (
        <p className="muted">
          {ar ? 'المتصفح ده مابيدعمش الإشعارات.' : 'This browser does not support notifications.'}
        </p>
      ) : state === 'denied' ? (
        <p className="muted">
          {ar
            ? 'الإشعارات متقفلة لـ Perks في إعدادات المتصفح. افتحها من إعدادات الموقع وجرّب تاني.'
            : 'Notifications are blocked for Perks in the browser settings. Allow them in the site settings and try again.'}
        </p>
      ) : (
        <>
          <p className="muted">
            {ar
              ? 'اعرف فورًا لما عميل يبعت طلب ختم، حتى والتطبيق مقفول.'
              : 'Know right away when a customer sends a stamp request, even with the app closed.'}
          </p>
          <button
            className="primary small"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setState(await enablePush(lang));
              })
            }
          >
            {ar ? 'فعّل الإشعارات' : 'Enable notifications'}
          </button>
        </>
      )}
      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
