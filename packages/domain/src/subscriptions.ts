export function moneyMinor(value: string): number | null {
  const normalized = value
    .trim()
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
    .replace(/[٫,]/g, '.');
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  // Parse integer parts separately; even intermediates stay below 2^53.
  const minor = Number(whole!) * 100 + Number(fraction.padEnd(2, '0'));
  return minor > 0 && minor <= 1000000000 ? minor : null;
}
