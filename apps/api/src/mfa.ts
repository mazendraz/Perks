import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { authenticated } from './auth.js';
import { transaction, type Actor, type DB, type Pools } from './db.js';
import { keyedHash, safeEqual, totp } from './crypto.js';
import { verifyPassword } from './passwords.js';
import { requireCondition } from './errors.js';

export function base32(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let buffer = 0,
    bits = 0,
    result = '';
  for (const byte of Buffer.from(secret, 'hex')) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(buffer >>> bits) & 31];
    }
  }
  if (bits) result += alphabet[(buffer << (5 - bits)) & 31];
  return result;
}
export function sealMfa(secret: string, pepper: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    createHash('sha256')
      .update('nuqta-mfa:' + pepper)
      .digest(),
    iv,
  );
  const bytes = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('hex'),
    cipher.getAuthTag().toString('hex'),
    bytes.toString('hex'),
  ].join(':');
}
export function openMfa(encoded: string, pepper: string) {
  // Existing, auth-role-only test/admin secrets predate encrypted enrollment.
  if (/^[a-f0-9]{40}$/.test(encoded)) return encoded;
  const [version, iv, tag, data] = encoded.split(':');
  requireCondition(version === 'v1' && iv && tag && data, 'INVALID_MFA_CODE', 401);
  const cipher = createDecipheriv(
    'aes-256-gcm',
    createHash('sha256')
      .update('nuqta-mfa:' + pepper)
      .digest(),
    Buffer.from(iv, 'hex'),
  );
  cipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([cipher.update(Buffer.from(data, 'hex')), cipher.final()]).toString('utf8');
}
const codeInput = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
export function mfaModule(app: FastifyInstance, pools: Pools, c: Config) {
  function admin(actor: Actor) {
    requireCondition(['platform_admin', 'platform_support'].includes(actor.role), 'FORBIDDEN', 403);
  }
  async function lockedUser(db: DB, actor: Actor) {
    const u = (
      await db.query(
        "SELECT id,email,password_hash,password_version,totp_secret,last_totp_counter FROM users WHERE id=$1 AND status='active' FOR UPDATE",
        [actor.id],
      )
    ).rows[0];
    requireCondition(u, 'UNAUTHENTICATED', 401);
    const session = await db.query(
      'SELECT id FROM sessions WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() AND credential_version=$3 FOR UPDATE',
      [actor.sessionId, actor.id, u.password_version],
    );
    requireCondition(session.rowCount, 'UNAUTHENTICATED', 401);
    return u;
  }
  function verifiedCounter(encoded: string | null, last: string, code: string) {
    if (!encoded) return undefined;
    const now = Math.floor(Date.now() / 30000);
    let secret: string;
    try {
      secret = openMfa(encoded, c.AUTH_PEPPER);
    } catch {
      return undefined;
    }
    return [now - 1, now, now + 1].find(
      (counter) => counter > Number(last) && safeEqual(totp(secret, counter), code),
    );
  }
  app.get('/api/v1/auth/mfa/status', async (req) => {
    const actor = authenticated(req);
    admin(actor);
    const r = (
      await pools.authPool.query(
        'SELECT totp_secret IS NOT NULL AS configured,(SELECT count(*)::int FROM mfa_recovery_codes WHERE user_id=u.id AND used_at IS NULL) AS remaining FROM users u WHERE id=$1',
        [actor.id],
      )
    ).rows[0];
    return { configured: r.configured, recoveryCodesRemaining: r.remaining };
  });
  app.post(
    '/api/v1/auth/mfa/setup',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req) => {
      const actor = authenticated(req);
      admin(actor);
      const p = z
        .object({ currentPassword: z.string().min(1).max(128) })
        .strict()
        .parse(req.body);
      const secret = randomBytes(20).toString('hex');
      await transaction(pools.authPool, async (db) => {
        const u = await lockedUser(db, actor);
        requireCondition(
          await verifyPassword(p.currentPassword, u.password_hash, c.AUTH_PEPPER),
          'INVALID_CREDENTIALS',
          401,
        );
        if (u.totp_secret)
          requireCondition(
            actor.mfaAt && Date.now() - actor.mfaAt.getTime() < 900000,
            'MFA_REQUIRED',
            403,
          );
        await db.query(
          "INSERT INTO mfa_enrollments(user_id,session_id,secret_encrypted,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '10 minutes') ON CONFLICT(user_id) DO UPDATE SET session_id=EXCLUDED.session_id,secret_encrypted=EXCLUDED.secret_encrypted,expires_at=EXCLUDED.expires_at",
          [actor.id, actor.sessionId, sealMfa(secret, c.AUTH_PEPPER)],
        );
        await db.query('SELECT record_mfa_event($1,$2,$3)', [actor.id, actor.sessionId, 'setup']);
      });
      const encoded = base32(secret);
      const uri =
        'otpauth://totp/' +
        encodeURIComponent('Nuqta:' + actor.email) +
        '?issuer=Nuqta&algorithm=SHA1&digits=6&period=30&secret=' +
        encoded;
      return {
        secret: encoded,
        qrDataUrl: await QRCode.toDataURL(uri, { width: 240, margin: 2 }),
        expiresIn: 600,
      };
    },
  );
  app.post(
    '/api/v1/auth/mfa/confirm',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req) => {
      const actor = authenticated(req);
      admin(actor);
      const { code } = codeInput.parse(req.body);
      const codes = Array.from({ length: 10 }, () =>
        randomBytes(12).toString('hex').match(/.{4}/g)!.join('-'),
      );
      await transaction(pools.authPool, async (db) => {
        await lockedUser(db, actor);
        const pending = (
          await db.query(
            'SELECT * FROM mfa_enrollments WHERE user_id=$1 AND session_id=$2 AND expires_at>clock_timestamp() FOR UPDATE',
            [actor.id, actor.sessionId],
          )
        ).rows[0];
        const counter = pending && verifiedCounter(pending.secret_encrypted, '-1', code);
        requireCondition(counter !== undefined, 'INVALID_MFA_CODE', 401);
        await db.query('UPDATE users SET totp_secret=$2,last_totp_counter=$3 WHERE id=$1', [
          actor.id,
          pending.secret_encrypted,
          counter,
        ]);
        await db.query('DELETE FROM mfa_enrollments WHERE user_id=$1', [actor.id]);
        await db.query('DELETE FROM mfa_recovery_codes WHERE user_id=$1', [actor.id]);
        for (const code of codes)
          await db.query('INSERT INTO mfa_recovery_codes(user_id,code_hash) VALUES($1,$2)', [
            actor.id,
            keyedHash('mfa-recovery:' + actor.id + ':' + code.replaceAll('-', ''), c.AUTH_PEPPER),
          ]);
        await db.query(
          'UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL',
          [actor.id, actor.sessionId],
        );
        await db.query('UPDATE sessions SET mfa_at=clock_timestamp() WHERE id=$1', [
          actor.sessionId,
        ]);
        await db.query('SELECT record_mfa_event($1,$2,$3)', [
          actor.id,
          actor.sessionId,
          'enrolled',
        ]);
      });
      return { verified: true, recoveryCodes: codes };
    },
  );
  app.post(
    '/api/v1/auth/mfa/verify',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req) => {
      const actor = authenticated(req);
      admin(actor);
      const { code } = codeInput.parse(req.body);
      await transaction(pools.authPool, async (db) => {
        const u = await lockedUser(db, actor);
        const counter = verifiedCounter(u.totp_secret, u.last_totp_counter, code);
        requireCondition(counter !== undefined, 'INVALID_MFA_CODE', 401);
        await db.query('UPDATE users SET last_totp_counter=$2 WHERE id=$1', [actor.id, counter]);
        await db.query('UPDATE sessions SET mfa_at=clock_timestamp() WHERE id=$1', [
          actor.sessionId,
        ]);
        await db.query('SELECT record_mfa_event($1,$2,$3)', [
          actor.id,
          actor.sessionId,
          'verified',
        ]);
      });
      return { verified: true };
    },
  );
  app.post(
    '/api/v1/auth/mfa/recover',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req) => {
      const actor = authenticated(req);
      admin(actor);
      const { code } = z
        .object({ code: z.string().min(12).max(80) })
        .strict()
        .parse(req.body);
      await transaction(pools.authPool, async (db) => {
        await lockedUser(db, actor);
        const hash = keyedHash(
          'mfa-recovery:' + actor.id + ':' + code.replace(/[-\s]/g, '').toLowerCase(),
          c.AUTH_PEPPER,
        );
        const used = await db.query(
          'UPDATE mfa_recovery_codes SET used_at=clock_timestamp() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING code_hash',
          [actor.id, hash],
        );
        requireCondition(used.rowCount, 'INVALID_MFA_CODE', 401);
        await db.query('UPDATE sessions SET mfa_at=clock_timestamp() WHERE id=$1', [
          actor.sessionId,
        ]);
        await db.query('SELECT record_mfa_event($1,$2,$3)', [
          actor.id,
          actor.sessionId,
          'recovered',
        ]);
      });
      return { verified: true };
    },
  );
}
