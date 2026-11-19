import type { Language } from '../../../packages/contracts/src/index.js';
import { api } from './api.js';

// Cashier phone notifications (Web Push), the browser half. Everything here is best effort and never
// throws into the UI: the feature stays invisible unless the server has it switched on.
export type PushState =
  | 'loading'
  // The server has Web Push off (no VAPID pair), or this page has no service worker (dev server).
  | 'unavailable'
  // iPhone/iPad Safari only delivers push to an app added to the Home Screen.
  | 'needs-install'
  | 'unsupported'
  | 'denied'
  | 'off'
  | 'on';
interface PushConfig {
  enabled: boolean;
  publicKey?: string;
}
const decodeKey = (value: string) => {
  const raw = atob(
    value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4),
  );
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
};
const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => {
  if (!a || a.byteLength !== b.length) return false;
  const left = new Uint8Array(a);
  return left.every((byte, i) => byte === b[i]);
};
export const pushSupported = () =>
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  typeof window !== 'undefined' &&
  'PushManager' in window &&
  'Notification' in window;
const iosBrowserTab = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  !(navigator as Navigator & { standalone?: boolean }).standalone &&
  !window.matchMedia?.('(display-mode: standalone)').matches;
// The service worker is only registered in production builds, so `ready` would never settle in dev.
async function readyRegistration() {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ]);
}
async function fetchConfig(): Promise<PushConfig> {
  try {
    return await api<PushConfig>('/me/push/config', { timeoutMs: 8000 });
  } catch {
    return { enabled: false };
  }
}
async function register(subscription: PushSubscription, lang: Language) {
  const json = subscription.toJSON();
  await api('/me/push/subscribe', {
    method: 'POST',
    body: { subscription: { endpoint: json.endpoint, keys: json.keys }, language: lang },
    timeoutMs: 10000,
  });
}
// Where this browser stands. When it already holds a subscription the server is told again, which
// re-binds the device to the current sign-in (and repairs a row the server dropped).
export async function pushState(lang: Language): Promise<PushState> {
  const config = await fetchConfig();
  if (!config.enabled || !config.publicKey) return 'unavailable';
  if (!pushSupported()) return iosBrowserTab() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const registration = await readyRegistration();
  if (!registration) return 'unavailable';
  const existing = await registration.pushManager.getSubscription();
  if (!existing || Notification.permission !== 'granted') return 'off';
  const key = decodeKey(config.publicKey);
  // The server's key pair was replaced: the old subscription can never be used again.
  if (!sameKey(existing.options.applicationServerKey, key)) {
    await existing.unsubscribe().catch(() => {});
    return 'off';
  }
  try {
    await register(existing, lang);
    return 'on';
  } catch {
    return 'off';
  }
}
// Must run from a tap: browsers refuse the permission prompt otherwise.
export async function enablePush(lang: Language): Promise<PushState> {
  const config = await fetchConfig();
  if (!config.enabled || !config.publicKey || !pushSupported()) return 'unavailable';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const registration = await readyRegistration();
  if (!registration) return 'unavailable';
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeKey(config.publicKey) as BufferSource,
    }));
  await register(subscription, lang);
  return 'on';
}
export async function sendTestPush(): Promise<boolean> {
  const registration = await readyRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return false;
  try {
    await api('/me/push/test', {
      method: 'POST',
      body: { endpoint: subscription.endpoint },
      timeoutMs: 15000,
    });
    return true;
  } catch {
    return false;
  }
}
// Removes this browser's subscription from the server and the browser. Used by "turn off" and by sign out.
export async function unlinkPushDevice(): Promise<void> {
  try {
    if (!pushSupported()) return;
    const registration = await readyRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    await api('/me/push/unsubscribe', {
      method: 'POST',
      body: { endpoint: subscription.endpoint },
      timeoutMs: 4000,
    }).catch(() => {});
    await subscription.unsubscribe().catch(() => {});
  } catch {
    /* Signing out must never wait on, or fail because of, a notification. */
  }
}
