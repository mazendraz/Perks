// Web APIs are not covered by Babel/core-js. Idempotency keys still use secure randomness.
export function secureUUID(source: Pick<Crypto, 'getRandomValues'> = globalThis.crypto): string {
  if (!source?.getRandomValues) throw new Error('Secure randomness is unavailable.');
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return (
    hex.slice(0, 8) +
    '-' +
    hex.slice(8, 12) +
    '-' +
    hex.slice(12, 16) +
    '-' +
    hex.slice(16, 20) +
    '-' +
    hex.slice(20)
  );
}
if (typeof window !== 'undefined' && globalThis.crypto && !globalThis.crypto.randomUUID) {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => secureUUID(),
    configurable: true,
  });
}
