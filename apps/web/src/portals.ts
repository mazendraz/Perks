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
    ar: 'إدارة نقطة',
    en: 'Nuqta administration',
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
export function defaultPortal(session: Session): Portal {
  return ['platform_admin', 'platform_support'].includes(session.user.role)
    ? 'platform'
    : session.grants.some((g) => g.role !== 'cashier')
      ? 'merchant'
      : session.grants.length
        ? 'cashier'
        : 'customer';
}
