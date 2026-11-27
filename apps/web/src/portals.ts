import type { Session } from '../../../packages/contracts/src/index.js';
import { setInstallPortal } from './install-prompt.js';
import { portalManifests, portalAppTitle } from './portal-apps.js';
export { portalManifests, portalAppTitle };
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
export function applyPortalManifest(portal: Portal | undefined) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) return;
  const href = portalManifests[portal ?? 'customer'];
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  document
    .querySelector('meta[name="apple-mobile-web-app-title"]')
    ?.setAttribute('content', portalAppTitle[portal ?? 'customer']);
  setInstallPortal(portal ?? 'customer');
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
/**
 * Where a signed-in person lands. A shop owner who signed up on their own and has not published
 * yet has no staff grant, so their portal would be the empty customer page: send them back to
 * the setup page they left instead.
 */
export function homeRoute(session: Session): string {
  const portal = defaultPortal(session);
  return portal === 'customer' && session.onboarding ? '/onboarding' : '/' + portal;
}
