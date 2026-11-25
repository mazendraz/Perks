import { useEffect, useId, useRef, useState } from 'react';
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

// The cashier header's notifications control: a small bell that opens a compact panel with the two
// things a cashier does here, turn notifications on (or off) and send a test. Nothing on the page
// itself, so the setting never pushes the work down.
export function HeaderNotifications({ lang }: { lang: Language }) {
  const ar = lang === 'ar',
    [state, setState] = useState<PushState>('loading'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [open, setOpen] = useState(false),
    panelId = useId(),
    titleId = useId(),
    root = useRef<HTMLDivElement>(null),
    bell = useRef<HTMLButtonElement>(null),
    // Bumped by every tap: a background check that started earlier must not undo what it did.
    version = useRef(0);
  const check = (fresh: boolean, alive: () => boolean) => {
    const started = version.current;
    void pushState(lang, fresh).then((next) => {
      if (alive() && started === version.current) setState(next);
    });
  };
  useEffect(() => {
    let alive = true;
    const refresh = () => check(false, () => alive);
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
  useEffect(() => {
    if (!open) return;
    // Opening re-checks: the first check can predate the sign-in finishing (a forced password
    // change) or a permission change made in the phone's settings.
    let alive = true;
    check(true, () => alive);
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      bell.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      alive = false;
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open, lang]);
  const run = async (action: () => Promise<void>) => {
    version.current++;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch {
      setMessage(
        ar ? 'ماقدرناش نغيّر الإشعارات. جرّب تاني.' : 'Could not change notifications. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };
  const on = state === 'on',
    status = on
      ? ar
        ? 'شغالة'
        : 'On'
      : state === 'loading'
        ? ar
          ? 'بنتأكد…'
          : 'Checking…'
        : ar
          ? 'مقفولة'
          : 'Off',
    hint =
      state === 'on'
        ? ar
          ? 'هيوصلك تنبيه مع كل سكان من عميل في فرعك، حتى والتطبيق مقفول.'
          : 'You are alerted on every customer scan at your branch, even with the app closed.'
        : state === 'needs-install'
          ? ar
            ? 'على الآيفون: ضيف Perks للشاشة الرئيسية الأول (مشاركة ← إضافة إلى الشاشة الرئيسية) وافتحه من هناك.'
            : 'On iPhone, add Perks to your Home Screen first (Share → Add to Home Screen), then open it from there.'
          : state === 'denied'
            ? ar
              ? 'الإشعارات متقفلة لـ Perks في إعدادات المتصفح. افتحها من إعدادات الموقع وجرّب تاني.'
              : 'Notifications are blocked for Perks in the browser settings. Allow them in the site settings and try again.'
            : state === 'unsupported'
              ? ar
                ? 'المتصفح ده مابيدعمش الإشعارات.'
                : 'This browser does not support notifications.'
              : state === 'unavailable'
                ? ar
                  ? 'الإشعارات مش متاحة على الجهاز ده دلوقتي.'
                  : 'Notifications are not available on this device right now.'
                : ar
                  ? 'اعرف فورًا مع كل سكان من عميل، حتى والتطبيق مقفول.'
                  : 'Know right away about every customer scan, even with the app closed.';
  return (
    <div className="header-notify" ref={root}>
      <button
        ref={bell}
        type="button"
        className="header-notify-bell"
        data-state={state}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={(ar ? 'الإشعارات: ' : 'Notifications: ') + status}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" size={20} />
      </button>
      {open && (
        <div className="header-notify-panel" id={panelId} role="dialog" aria-labelledby={titleId}>
          <div className="header-notify-title">
            <strong id={titleId}>{ar ? 'الإشعارات' : 'Notifications'}</strong>
            <span className="header-notify-status" data-state={state}>
              {status}
            </span>
          </div>
          <p className="muted">{hint}</p>
          <div className="header-notify-actions">
            {on ? (
              <button
                type="button"
                className="secondary small"
                disabled={busy}
                aria-busy={busy}
                onClick={() =>
                  void run(async () => {
                    await unlinkPushDevice();
                    setState('off');
                  })
                }
              >
                {ar ? 'إيقاف الإشعارات' : 'Turn off'}
              </button>
            ) : (
              <button
                type="button"
                className="primary small"
                disabled={busy || state !== 'off'}
                aria-busy={busy}
                onClick={() =>
                  void run(async () => {
                    const next = await enablePush(lang);
                    setState(next);
                    if (next === 'on')
                      setMessage(
                        ar
                          ? 'الإشعارات اشتغلت. ابعت إشعار تجربة عشان تتأكد.'
                          : 'Notifications are on. Send a test to check.',
                      );
                  })
                }
              >
                {ar ? 'فعّل الإشعارات' : 'Enable notifications'}
              </button>
            )}
            <button
              type="button"
              className="secondary small"
              disabled={busy || !on}
              aria-describedby={on ? undefined : panelId + '-test-why'}
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
          </div>
          {!on && (
            <small className="muted" id={panelId + '-test-why'}>
              {ar
                ? 'إشعار التجربة بيشتغل بعد تفعيل الإشعارات.'
                : 'The test works once notifications are on.'}
            </small>
          )}
          {message && (
            <p className="header-notify-message" role="status">
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
