import { portalForPath } from './portals.js';
// A new service worker activates and claims open tabs by itself. The page still runs the
// previous release's JavaScript until it reloads, so the reload happens at a moment the
// user won't notice: the next in-app navigation, or (on the cashier and customer pages,
// which stay open for long stretches) while the tab is hidden. Anything that must not be
// cut short (a stamp/redeem write in flight, an open cashier flow, a live camera scan)
// holds the gate and defers the reload until it is released. Other pages may hold
// half-typed forms, so they only update on their next navigation.
let ready = false;
const holds = new Set<symbol>();

const idle = () => holds.size === 0;

function reloadIfHidden() {
  if (!ready || !idle() || !document.hidden) return;
  const portal = portalForPath(location.pathname);
  if (portal === 'cashier' || portal === 'customer') location.reload();
}

/** Keeps the pending update from applying until the returned release is called. */
export function holdUpdates(): () => void {
  const token = Symbol('update-hold');
  holds.add(token);
  return () => {
    if (holds.delete(token)) reloadIfHidden();
  };
}

export function markUpdateReady() {
  ready = true;
  reloadIfHidden();
}

/** Returns true when it took over the navigation with a full page load of the new release. */
export function applyUpdateOnNavigation(path: string): boolean {
  if (!ready || !idle()) return false;
  location.assign(path);
  return true;
}

// Guarded so Node unit tests can import api.ts without a DOM.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', reloadIfHidden);
  addEventListener('popstate', (event) => {
    // Browser back/forward only; the app's own synthetic popstate events are not trusted.
    if (event.isTrusted && ready && idle()) location.reload();
  });
}
