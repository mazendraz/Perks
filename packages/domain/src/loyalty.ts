export function awardMath(balance: number, quantity: number, threshold: number) {
  if (
    !Number.isSafeInteger(balance) ||
    balance < 0 ||
    !Number.isSafeInteger(quantity) ||
    quantity < 1 ||
    !Number.isSafeInteger(threshold) ||
    threshold < 1
  )
    throw new Error('Invalid integer loyalty quantities.');
  const total = balance + quantity;
  if (!Number.isSafeInteger(total)) throw new Error('Quantity overflow.');
  return { balanceAfter: total % threshold, rewardCount: Math.floor(total / threshold) };
}
export function normalizeReceipt(value: string) {
  const ascii = value
    .normalize('NFKC')
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6f0));
  return ascii.trim().replace(/\s+/g, ' ').toUpperCase();
}
export function businessDate(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
