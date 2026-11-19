import type { Session } from '../../../packages/contracts/src/index.js';
export type Portal = 'platform' | 'merchant' | 'cashier' | 'customer';
export function portalAssetUrl(path: string) {
  const portal = portalForPath(location.pathname);
  if (!portal) return path;
  const url = new URL(path, location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return path;
  url.searchParams.set('__portal', portal);
  return url.pathname + url.search;
}
export const portalInfo = {
  platform: {
    ar: 'إدارة Perks',
    en: 'Perks administration',
    icon: 'shield',
    hintAr: 'المحلات، الحسابات ومتابعة التشغيل',
    hintEn: 'Businesses, accounts and platform operations',
  },
  merchant: {
    ar: 'صاحب المحل',
    en: 'Business owner',
    icon: 'shop',
    hintAr: 'عملاؤك، كارت الولاء وفريقك',
    hintEn: 'Your customers, loyalty card and team',
  },
  cashier: {
    ar: 'الكاشير',
    en: 'Cashier',
    icon: 'scan',
    hintAr: 'الأختام واستبدال المكافآت',
    hintEn: 'Award stamps and redeem rewards',
  },
  customer: {
    ar: 'العميل',
    en: 'Customer',
    icon: 'cards',
    hintAr: 'كروتك، أختامك ومكافآتك',
    hintEn: 'Your cards, stamps and rewards',
  },
} as const;
export function portalForPath(path: string): Portal | undefined {
  if (path.startsWith('/customer') || path.startsWith('/r/')) return 'customer';
  if (path.endsWith('/login')) return undefined;
  if (path.startsWith('/platform')) return 'platform';
  if (path.startsWith('/merchant')) return 'merchant';
  if (path.startsWith('/cashier')) return 'cashier';
  if (path.startsWith('/customer') || path.startsWith('/join/') || path.startsWith('/p/'))
    return 'customer';
}
// The cashier installs as its own home-screen app (own name, start page and scope) so a shop can keep
// Perks Cashier on the till phone, and iPhone delivers push only to an installed app. Every other
// portal keeps the customer manifest. Browsers read the link when the app is installed.
const portalManifests: Partial<Record<Portal, string>> = {
  cashier: '/manifest-cashier.webmanifest',
};
export function applyPortalManifest(portal: Portal | undefined) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) return;
  const href = (portal && portalManifests[portal]) || '/manifest.webmanifest';
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  document
    .querySelector('meta[name="apple-mobile-web-app-title"]')
    ?.setAttribute('content', portal === 'cashier' ? 'Perks Cashier' : 'My Cards');
}
export function defaultPortal(session: Session): Portal {
  return ['platform_admin', 'platform_support'].includes(session.user.role)
    ? 'platform'
    : session.grants.some((g) => g.role !== 'cashier')
      ? 'merchant'
      : session.grants.length
        ? 'cashier'
        : 'customer';
}
