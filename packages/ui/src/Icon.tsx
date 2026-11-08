export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    chevronDown: 'm6 9 6 6 6-6',
    upload: 'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',
    home: 'm3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9',
    cards: 'M3 7h18v13H3zM7 3h14v13M7 12h4m-4 4h7',
    shop: 'M4 10v11h16V10M3 4h18l1 6H2zM8 21v-7h8v7',
    scan: 'M3 8V3h5m8 0h5v5m0 8v5h-5M8 21H3v-5M7 12h10M9 8v8m6-8v8',
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
    >
      <path d={paths[name] || paths.spark} />
    </svg>
  );
}
