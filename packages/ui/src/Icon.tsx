import type { ReactNode } from 'react';

export function ActionLabel({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <span className="action-label">
      <Icon name={icon} />
      <span>{children}</span>
    </span>
  );
}

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    chevronDown: 'm6 9 6 6 6-6',
    upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',
    home: 'm3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9',
    cards: 'M3 7h18v13H3zM7 3h14v13M7 12h4m-4 4h7',
    shop: 'M4 10v11h16V10M3 4h18l1 6H2zM8 21v-7h8v7',
    qr: 'M4 4h5v5H4zM15 4h5v5h-5zM4 15h5v5H4zM15 14h3v3h3m-7 3h3m4-1v2',
    scan: 'M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3m0 8v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3M8 8h3v3H8zM15 8h1m-8 8h1m5-2h2v2',
    camera:
      'M8 6l1.5-2h5L16 6h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
    keyboard:
      'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1ZM7 10h.01M12 10h.01M17 10h.01M7 14h.01M10 14h7',
    refresh: 'M20 8a8.5 8.5 0 0 0-14-3L3 8m0-5v5h5M4 16a8.5 8.5 0 0 0 14 3l3-3m0 5v-5h-5',
    close: 'm6 6 12 12M6 18 18 6',
    download: 'M12 3v12m-4-4 4 4 4-4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
    copy: 'M8 8h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2ZM16 4V3H5a2 2 0 0 0-2 2v11h1',
    plus: 'M12 5v14M5 12h14',
    stamp: 'M8 16v-3c0-2 2-2 2-4V6a2 2 0 0 1 4 0v3c0 2 2 2 2 4v3M5 16h14v4H5zM7 23h10',
    receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 7h6m-6 4h6m-6 4h3',
    message: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2ZM7 9h10m-10 4h6',
    support: 'M4 13v-1a8 8 0 0 1 16 0v1M4 12H3v6h4v-6ZM20 12h1v6h-4v-6ZM20 18v1a2 2 0 0 1-2 2h-4',
    save: 'M5 3h12l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM7 3v6h9V3M7 21v-7h10v7',
    shield: 'm12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6zM8 12l3 3 5-6',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    spark: 'm12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z',
    gift: 'M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z',
    people:
      'M16 21v-3c0-3-8-3-8 0v3M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM3 20v-2c0-2 1-3 3-3m15 5v-2c0-2-1-3-3-3',
    chart: 'M4 3v17h17M8 15l4-5 4 2 5-7',
    clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
    branch:
      'M6 3v12c0 3 3 3 6 3h3M6 6h9M21 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm0 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    check: 'm5 12 4 4L19 6',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    eyeOff:
      'm3 3 18 18M10.5 5.2 12 5c6.5 0 10 7 10 7a20 20 0 0 1-3.1 4M6.5 6.5A20 20 0 0 0 2 12s3.5 7 10 7a11 11 0 0 0 5.5-1.5M10 10a3 3 0 0 0 4 4',
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
    >
      <path d={paths[name] || paths.spark} />
    </svg>
  );
}
