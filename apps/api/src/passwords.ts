import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';
import { commonPasswords } from './data/common-passwords.js';
const denied = new Set(commonPasswords.map((password) => password.toLowerCase()));
export function assertPasswordPolicy(password: string) {
  if (password.length < 10 || password.length > 128) throw new AppError('PASSWORD_LENGTH', 422);
  if (denied.has(password.toLowerCase())) throw new AppError('PASSWORD_TOO_COMMON', 422);
}

// OWASP scrypt profile: N=2^15, r=8, p=3. A private pepper and a fresh salt
// protect each credential; plaintext passwords never enter DB rows or logs.
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const dummy = 'scrypt$32768$8$3$' + '00'.repeat(16) + '$' + '00'.repeat(64);
let active = 0;
async function derive(password: string, salt: Buffer, pepper: string) {
  if (active >= 4) throw new AppError('AUTH_BUSY', 503, true);
  active++;
  try {
    const input = createHmac('sha256', pepper).update(password, 'utf8').digest();
    return await new Promise<Buffer>((resolve, reject) =>
      scrypt(input, salt, 64, options, (error, key) => (error ? reject(error) : resolve(key))),
    );
  } finally {
    active--;
  }
}
export async function hashPassword(password: string, pepper: string) {
  assertPasswordPolicy(password);
  const salt = randomBytes(16),
    key = await derive(password, salt, pepper);
  return 'scrypt$32768$8$3$' + salt.toString('hex') + '$' + key.toString('hex');
}
export async function verifyPassword(
  password: string,
  encoded: string | null | undefined,
  pepper: string,
) {
  const valid = !!encoded && /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded);
  const parts = (valid ? encoded! : dummy).split('$');
  const actual = await derive(password, Buffer.from(parts[4]!, 'hex'), pepper);
  return timingSafeEqual(actual, Buffer.from(parts[5]!, 'hex')) && valid;
}
