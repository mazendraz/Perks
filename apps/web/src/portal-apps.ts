import type { Portal } from './portals.js';
// Every staff portal installs as its own home-screen app (own name, start page and scope): a shop
// keeps Perks Cashier on the till phone, the owner keeps Perks Business, and iPhone delivers push only
// to an installed app. Customers keep the root manifest. Browsers read the link when installing.
export const portalManifests: Record<Portal, string> = {
  customer: '/manifest.webmanifest',
  cashier: '/manifest-cashier.webmanifest',
  merchant: '/manifest-merchant.webmanifest',
  platform: '/manifest-platform.webmanifest',
};
export const portalAppTitle: Record<Portal, string> = {
  customer: 'My Cards',
  cashier: 'Perks Cashier',
  merchant: 'Perks Business',
  platform: 'Perks Admin',
};
