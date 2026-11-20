import { useEffect, useState } from 'react';
import type { Language } from '../../../packages/contracts/src/index.js';
import { networkUnavailable } from './network.js';
import { markUpdateReady } from './update-gate.js';
let registration: Promise<ServiceWorkerRegistration> | undefined;
function register() {
  // The first claim of a never-controlled page is an install, not an update.
  let controlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlled) markUpdateReady();
    controlled = true;
  });
  return navigator.serviceWorker
    .register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    })
    .then((reg) => {
      // Workers from releases before silent updates wait for this message.
      reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
      return reg;
    })
    .catch((error) => {
      registration = undefined;
      throw error;
    });
}
export function PwaStatus({ lang }: { lang: Language }) {
  const [offline, setOffline] = useState(() => !navigator.onLine || networkUnavailable());
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
    const refresh = () => {
      void reg?.update().catch(() => {});
    };
    registration ||= register();
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
        window.addEventListener('online', refresh);
        refresh();
      })
      .catch(() => {
        /* The online app remains usable when private browsing blocks cache storage. */
      });
    return () => {
      alive = false;
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', visible);
      window.clearInterval(interval);
    };
  }, [offline]);
  if (!offline) return null;
  return (
    <aside className="pwa-status" role="status" aria-live="polite">
      <span>
        {lang === 'ar'
          ? 'مفيش نت دلوقتي. وصّل النت علشان تكمل.'
          : 'You’re offline. Reconnect to continue.'}
      </span>
    </aside>
  );
}
