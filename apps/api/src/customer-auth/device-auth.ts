import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import { transaction, customerLifecycleLock, type Pools } from '../db.js';
import { keyedHash, opaqueToken, safeEqual, tokenHash } from '../crypto.js';
import { portalCookies } from '../portal-auth.js';
import { requireCondition } from '../errors.js';

export const deviceCookie = (c: Config) =>
  c.COOKIE_SECURE === 'true' ? '__Host-nq_device' : 'nq_device';
const deviceOptions = (c: Config) => ({
  path: '/',
  httpOnly: true,
  secure: c.COOKIE_SECURE === 'true',
  sameSite: 'lax' as const,
  maxAge: 365 * 86400,
});
export function deviceAgentFamily(value: string) {
  if (/SamsungBrowser/i.test(value)) return 'Samsung Internet';
  if (/Edg\//i.test(value)) return 'Edge';
  if (/Firefox|FxiOS/i.test(value)) return 'Firefox';
  if (/Chrome|CriOS/i.test(value)) return 'Chrome';
  return /Safari/i.test(value) ? 'Safari' : 'Other';
}
export function prepareDevice(req: FastifyRequest, reply: FastifyReply, c: Config) {
  const name = deviceCookie(c);
  let raw = req.cookies[name];
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) raw = opaqueToken();
  req.cookies[name] = raw;
  reply.setCookie(name, raw, deviceOptions(c));
  return {
    hash: tokenHash(raw),
    csrfToken: keyedHash('customer-device-csrf:' + raw, c.AUTH_PEPPER),
  };
}
export function deviceCsrf(req: FastifyRequest, c: Config) {
  const raw = req.cookies[deviceCookie(c)],
    header = String(req.headers['x-csrf-token'] || '');
  requireCondition(raw && /^[A-Za-z0-9_-]{43}$/.test(raw), 'CSRF_REJECTED', 403);
  // Authenticated mutations have already passed the session's CSRF check.
  if (req.actor) return tokenHash(raw);
  requireCondition(
    raw && header && safeEqual(header, keyedHash('customer-device-csrf:' + raw, c.AUTH_PEPPER)),
    'CSRF_REJECTED',
    403,
  );
  return tokenHash(raw);
}
// Called only for customer GET requests. It never sets the shared login cookie
// and cannot replace a platform/merchant/cashier session.
export async function issueDeviceSession(
  pools: Pools,
  c: Config,
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const raw = req.cookies[deviceCookie(c)];
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const token = opaqueToken(),
    csrf = opaqueToken();
  const created = await transaction(pools.authPool, async (db) => {
    const identity = (
      await db.query('SELECT customer_id FROM customer_devices WHERE token_hash=$1', [
        tokenHash(raw),
      ])
    ).rows[0];
    if (!identity) return false;
    await customerLifecycleLock(db, identity.customer_id);
    const device = (
      await db.query(
        "SELECT d.id,d.customer_id,u.password_version FROM customer_devices d JOIN users u ON u.id=d.customer_id WHERE d.token_hash=$1 AND d.revoked_at IS NULL AND d.expires_at>clock_timestamp() AND u.status='active' AND u.global_role='customer' FOR UPDATE OF d",
        [tokenHash(raw)],
      )
    ).rows[0];
    if (!device) return false;
    await db.query(
      "UPDATE customer_devices SET last_seen_at=clock_timestamp(),expires_at=clock_timestamp()+interval '365 days' WHERE id=$1",
      [device.id],
    );
    await db.query(
      "INSERT INTO sessions(user_id,token_hash,csrf_hash,expires_at,auth_method,credential_version,portal,customer_device_id) VALUES($1,$2,$3,clock_timestamp()+interval '1 day','device',$4,'customer',$5)",
      [device.customer_id, tokenHash(token), tokenHash(csrf), device.password_version, device.id],
    );
    return true;
  });
  if (!created) return null;
  // Lax, not Strict: a customer arrives from the iPhone Camera (QR), an NFC tap, Wallet or
  // WhatsApp. Safari withholds Strict cookies from every request of a page opened that way,
  // so the stamp request after a scan or a first registration lost the card holder.
  // Cross-site writes stay blocked by the Origin check and the CSRF header.
  const names = portalCookies(c, 'customer'),
    options = {
      path: '/',
      secure: c.COOKIE_SECURE === 'true',
      sameSite: 'lax' as const,
      maxAge: 86400,
    };
  reply.setCookie(names.session, token, { ...options, httpOnly: true });
  reply.setCookie(names.csrf, csrf, { ...options, httpOnly: false });
  reply.setCookie(deviceCookie(c), raw, deviceOptions(c));
  req.cookies[names.session] = token;
  req.cookies[names.csrf] = csrf;
  return { token, csrfToken: csrf };
}
