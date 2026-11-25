import { useEffect, useId, useState } from 'react';
import { Icon } from '../../../../packages/ui/src/Icon.js';
import type { Language } from '../../../../packages/contracts/src/index.js';
import {
  enablePush,
  pushState,
  sendTestPush,
  unlinkPushDevice,
  type PushState,
  type TestPushResult,
} from '../push.js';

// What the test told us, in words a cashier can act on (and read out to support).
function testMessage(result: TestPushResult, ar: boolean) {
  if (result.delivered)
    return ar
      ? 'خدمة الإشعارات استلمت التجربة (' +
          result.status +
          '). لو ماظهرش إشعار في ثواني، راجع إعدادات الإشعارات لـ Perks على الموبايل ووضع التركيز / عدم الإزعاج.'
      : 'The push service accepted the test (' +
          result.status +
          '). If nothing shows within a few seconds, check Perks in the phone’s notification settings and Focus / Do Not Disturb.';
  switch (result.reason) {
    case 'NO_SUBSCRIPTION':
    case 'SUBSCRIPTION_GONE':
      return ar
        ? 'اشتراك الإشعارات على الجهاز ده خلص. اضغط "فعّل الإشعارات" تاني.'
        : 'This device’s notification subscription has expired. Tap “Enable notifications” again.';
    case 'NOT_REGISTERED':
      return ar
        ? 'السيرفر مش لاقي الجهاز ده حتى بعد ما سجلناه تاني. اقفل الإشعارات وافتحها تاني.'
        : 'The server still cannot find this device after registering it again. Turn notifications off and on.';
    case 'PUSH_SERVICE_REFUSED':
      return ar
        ? 'خدمة الإشعارات رفضت الإرسال (كود ' +
            (result.status ?? 0) +
            '). ' +
            (result.status === 403
              ? 'غالبًا مفتاح VAPID على السيرفر. بلّغ الدعم.'
              : 'جرّب كمان شوية.')
        : 'The push service refused the send (code ' +
            (result.status ?? 0) +
            '). ' +
            (result.status === 403
              ? 'Most likely the server’s VAPID key. Tell support.'
              : 'Try again in a moment.');
    default:
      return ar
        ? 'ماقدرناش نوصل للسيرفر. اتأكد من النت وجرّب تاني.'
        : 'Could not reach the server. Check the connection and try again.';
  }
}

// "Enable notifications" for a cashier's phone. Renders nothing while the server has Web Push off.
// Compact: a small status button that opens the same controls below it, so the setting sits
// beside the activity it is about without taking a whole panel.
export function PushToggle({ lang, compact = false }: { lang: Language; compact?: boolean }) {
  const ar = lang === 'ar',
    [state, setState] = useState<PushState>('loading'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [open, setOpen] = useState(false),
    bodyId = useId();
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
  const controls = (
    <>
      {state === 'on' ? (
        <>
          <p className="muted">
            {ar
              ? 'الإشعارات شغالة على الجهاز ده. هيوصلك تنبيه مع كل سكان من عميل في فرعك.'
              : 'Notifications are on for this device. You will be alerted on every customer scan at your branch.'}
          </p>
          <div className="button-row">
            <button
              className="secondary small"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await sendTestPush(lang);
                  setMessage(testMessage(result, ar));
                  if (
                    !result.delivered &&
                    (result.reason === 'NO_SUBSCRIPTION' || result.reason === 'SUBSCRIPTION_GONE')
                  )
                    setState('off');
                })
              }
            >
              {ar ? 'ابعت إشعار تجربة' : 'Send test notification'}
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
              ? 'اعرف فورًا مع كل سكان من عميل، حتى والتطبيق مقفول.'
              : 'Know right away about every customer scan, even with the app closed.'}
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
    </>
  );
  if (!compact)
    return (
      <section className="panel push-toggle" aria-labelledby="push-toggle-title">
        <h2 id="push-toggle-title">{ar ? 'إشعارات السكان' : 'Scan notifications'}</h2>
        {controls}
      </section>
    );
  const label =
    state === 'on'
      ? ar
        ? 'الإشعارات شغالة'
        : 'Alerts on'
      : ar
        ? 'فعّل الإشعارات'
        : 'Turn on alerts';
  return (
    <>
      <button
        type="button"
        className="push-compact"
        data-state={state}
        aria-expanded={open}
        aria-controls={bodyId}
        aria-label={ar ? 'إشعارات السكان: ' + label : 'Scan notifications: ' + label}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" size={16} />
        <span>{label}</span>
      </button>
      {open && (
        <div
          className="push-compact-body"
          id={bodyId}
          role="region"
          aria-label={ar ? 'إشعارات السكان' : 'Scan notifications'}
        >
          {controls}
        </div>
      )}
    </>
  );
}
