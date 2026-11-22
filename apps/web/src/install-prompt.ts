import type { Portal } from './portals.js';
import { portalManifests } from './portal-apps.js';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
type RelatedApp = { platform: string; url?: string; id?: string };
type InstallNavigator = Navigator & {
  standalone?: boolean;
  getInstalledRelatedApps?: () => Promise<RelatedApp[]>;
};

// Each portal is its own home-screen app, so "installed" and "not now" are kept per portal:
// installing Perks Cashier on a till phone must not hide the customer's "add My Cards" offer.
const installedKey = (portal: Portal) => 'nuqta-app-installed:' + portal;
const dismissedKey = (portal: Portal) => 'nuqta-install-dismissed:' + portal;
/** "Not now" hides the offer for a week, so a cashier working all day is not nagged. */
export const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

let pending: InstallEvent | null = null;
const installed = new Set<Portal>();
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((receive) => receive());

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Storage is optional: memory still holds the state for this visit. */
  }
}

export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (matchMedia('(display-mode: standalone)').matches ||
    !!(navigator as InstallNavigator).standalone);

function markInstalled(portal: Portal) {
  installed.add(portal);
  write(installedKey(portal), '1');
  write(dismissedKey(portal), null);
}

let currentPortal: Portal = 'customer';
if (typeof window !== 'undefined') {
  // The single key used before portals had their own apps only ever came from My Cards.
  if (read('nuqta-app-installed') === '1') {
    write(installedKey('customer'), '1');
    write('nuqta-app-installed', null);
  }
  for (const portal of Object.keys(portalManifests) as Portal[])
    if (read(installedKey(portal)) === '1') installed.add(portal);
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    pending = event as InstallEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    markInstalled(currentPortal);
    pending = null;
    notify();
  });
}

let checkTimer = 0;
/**
 * Called when the page switches portal (and its manifest link). Opened from the home-screen icon
 * counts as installed; on Chromium, getInstalledRelatedApps() also finds the app after storage was
 * cleared, and brings the offer back after the user removed the app.
 */
export function setInstallPortal(portal: Portal) {
  if (portal !== currentPortal) {
    currentPortal = portal;
    // A prompt that arrived for the previous portal's manifest would install the wrong app.
    pending = null;
  }
  if (isStandalone()) markInstalled(portal);
  notify();
  const nav = navigator as InstallNavigator;
  if (!nav.getInstalledRelatedApps || isStandalone()) return;
  clearTimeout(checkTimer);
  // Give the browser a moment to read the manifest the link now points to.
  checkTimer = window.setTimeout(() => {
    const asked = portal;
    nav
      .getInstalledRelatedApps?.()
      .then((apps) => {
        if (asked !== currentPortal) return;
        const manifest = portalManifests[asked];
        const found = apps.some((app) => app.platform === 'webapp' && app.url?.endsWith(manifest));
        if (found) markInstalled(asked);
        else if (/Android/.test(navigator.userAgent) && installed.has(asked)) {
          // Android reports reliably: the app was removed, so offer it again.
          installed.delete(asked);
          write(installedKey(asked), null);
        }
        notify();
      })
      .catch(() => {
        /* Not supported here: storage keeps deciding. */
      });
  }, 600);
}

export const installPromptReady = () => !!pending;
export const isInstalled = (portal: Portal) => isStandalone() || installed.has(portal);
export function isDismissed(portal: Portal, now = Date.now()) {
  const at = Number(read(dismissedKey(portal)) || 0);
  return !!at && now - at < DISMISS_MS;
}
export function dismissInstall(portal: Portal) {
  write(dismissedKey(portal), String(Date.now()));
  notify();
}
export function subscribeInstall(receive: () => void) {
  subscribers.add(receive);
  return () => {
    subscribers.delete(receive);
  };
}
/** Waits briefly for the browser's install event, which can land a moment after the page opens. */
export function waitForInstallPrompt(ms = 1200) {
  if (pending) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const stop = subscribeInstall(() => {
      if (!pending) return;
      clearTimeout(timer);
      stop();
      resolve(true);
    });
    const timer = setTimeout(() => {
      stop();
      resolve(!!pending);
    }, ms);
  });
}
/** Opens the system install dialog. Resolves with the user's answer, or null with no prompt. */
export async function promptInstall(portal: Portal) {
  const event = pending;
  if (!event) return null;
  pending = null;
  notify();
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === 'accepted') {
    markInstalled(portal);
    notify();
  }
  return outcome;
}
