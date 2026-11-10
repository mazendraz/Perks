import { useEffect, useState } from 'react';
import type { Language } from '../../../packages/contracts/src/index.js';
import { networkUnavailable } from './network.js';
let registration: Promise<ServiceWorkerRegistration> | undefined;
export function PwaStatus({ lang }: { lang: Language }) {
  const [offline, setOffline] = useState(() => !navigator.onLine || networkUnavailable()),
    [waiting, setWaiting] = useState<ServiceWorker | null>(null),
    [updating, setUpdating] = useState(false);
  useEffect(() => {
    const online = () => setOffline(false),
      gone = () => setOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', gone);
    const network = () => setOffline(!navigator.onLine || networkUnavailable());
    window.addEventListener('nuqta:network-status', network);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', gone);
      window.removeEventListener('nuqta:network-status', network);
    };
  }, []);
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let alive = true,
      reg: ServiceWorkerRegistration | undefined;
    const installed = () => {
      if (alive) setWaiting(navigator.serviceWorker.controller ? (reg?.waiting ?? null) : null);
    };
    const updateFound = () => {
      reg?.installing?.addEventListener('statechange', installed);
    };
    const refresh = () => {
      void reg?.update().catch(() => {});
    };
    registration ||= navigator.serviceWorker
      .register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      })
      .catch((error) => {
        registration = undefined;
        throw error;
      });
    const visible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', visible);
    const interval = window.setInterval(() => {
      if (!document.hidden) refresh();
    }, 15 * 60000);
    void registration
      .then((value) => {
        if (!alive) return;
        reg = value;
        installed();
        reg.addEventListener('updatefound', updateFound);
        window.addEventListener('online', refresh);
        refresh();
      })
      .catch(() => {
        /* The online app remains usable when private browsing blocks cache storage. */
      });
    return () => {
      alive = false;
      reg?.removeEventListener('updatefound', updateFound);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', visible);
      window.clearInterval(interval);
    };
  }, [offline]);
  useEffect(() => {
    if (!updating || !('serviceWorker' in navigator)) return;
    const changed = () => location.reload();
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    waiting?.postMessage({ type: 'SKIP_WAITING' });
    return () => navigator.serviceWorker.removeEventListener('controllerchange', changed);
  }, [updating, waiting]);
  if (!offline && !waiting) return null;
  const ar = lang === 'ar';
  return (
    <aside className="pwa-status" role="status" aria-live="polite">
      <span>
        {offline
          ? ar
            ? 'مفيش نت دلوقتي. وصّل النت علشان تكمل.'
            : 'You’re offline. Reconnect to continue.'
          : ar
            ? 'فيه تحديث جاهز لـ Perks.'
            : 'A Perks update is ready.'}
      </span>
      {!offline && waiting && (
        <button className="primary small" disabled={updating} onClick={() => setUpdating(true)}>
          {updating ? (ar ? 'بيحدّث…' : 'Updating…') : ar ? 'حدّث دلوقتي' : 'Update now'}
        </button>
      )}
    </aside>
  );
}
