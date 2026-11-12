interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let pending: InstallEvent | null = null,
  installed = false;
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((receive) => receive());
if (typeof window !== 'undefined') {
  try {
    installed = localStorage.getItem('nuqta-app-installed') === '1';
  } catch {
    /* Storage is optional. */
  }
  if (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone
  ) {
    installed = true;
    try {
      localStorage.setItem('nuqta-app-installed', '1');
    } catch {
      /* Memory fallback. */
    }
  }
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    pending = event as InstallEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    try {
      localStorage.setItem('nuqta-app-installed', '1');
    } catch {
      /* Memory fallback. */
    }
    pending = null;
    notify();
  });
}
export const installPromptReady = () => !!pending;
export const isInstalled = () =>
  installed ||
  matchMedia('(display-mode: standalone)').matches ||
  !!(navigator as Navigator & { standalone?: boolean }).standalone;
export function subscribeInstall(receive: () => void) {
  subscribers.add(receive);
  return () => {
    subscribers.delete(receive);
  };
}
export async function promptInstall() {
  const event = pending;
  if (!event) return false;
  pending = null;
  notify();
  await event.prompt();
  await event.userChoice;
  return true;
}
