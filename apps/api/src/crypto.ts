import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
export const opaqueToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const otpCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const keyedHash = (value: string, pepper: string) =>
  createHmac('sha256', pepper).update(value).digest('hex');
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const o = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(o)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k]))
      .join(',') +
    '}'
  );
}
export function totp(secretHex: string, counter: number): string {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac('sha1', Buffer.from(secretHex, 'hex')).update(counterBytes).digest();
  const off = hash[19]! & 15;
  return String((hash.readUInt32BE(off) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
