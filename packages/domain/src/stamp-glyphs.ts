import type { StampIcon } from '../../contracts/src/branding.js';
// Shared by the web card and the Apple Wallet strip so both draw identical stamps.
export const stampIconPaths: Record<StampIcon, string> = {
  check: 'M5.5 12.5 10 17 18.5 7.5',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
  heart:
    'M20.2 5.8a5 5 0 0 0-7.1 0L12 6.9l-1.1-1.1a5 5 0 0 0-7.1 7.1L12 21l8.2-8.1a5 5 0 0 0 0-7.1Z',
  coffee:
    'M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Zm12 1h2a3 3 0 0 1 0 6h-2M3 22h15M7 2v3m4-3v3m4-3v3',
  utensils: 'M4 3v6m3-6v6m3-6v6M4 7h6v2a3 3 0 0 1-6 0m3 3v9M20 3c-4 2-5 6-5 10h5m0-10v18',
  scissors:
    'M9 8 20 20M9 16 20 4M4.5 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0 11a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z',
  crown: 'm3 6 5 4 4-7 4 7 5-4-2 12H5ZM5 22h14',
  flame: 'M13 2c1 6-5 6-4 11 2-1 4-3 4-5 7 6 7 10 3 13a7 7 0 0 1-11-5c0-6 5-8 8-14Z',
};
