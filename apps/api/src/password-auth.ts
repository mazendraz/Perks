import type { FastifyInstance, FastifyReply } from 'fastify';
import { passwordEnabled, type Config } from './config.js';
import { transaction, type DB, type Pools } from './db.js';
import { authenticated } from './actor.js';
import { requireCondition } from './errors.js';
import { keyedHash, opaqueToken, tokenHash } from './crypto.js';
import { setTimeout } from 'node:timers/promises';
import { hashPassword, verifyPassword } from './passwords.js';
import { seal } from './outbox.js';
import { z } from 'zod';
import {
  loginInput,
  changePasswordInput,
  resetRequestInput,
  resetPasswordInput,
} from '../../../packages/contracts/src/auth.js';

type Issue = (reply: FastifyReply, id: string, version: number) => Promise<{ csrfToken: string }>;
export function passwordAuth(app: FastifyInstance, pools: Pools, c: Config, issue: Issue) {
  const enabled = () => requireCondition(passwordEnabled(c), 'PASSWORD_AUTH_NOT_CONFIGURED', 503);
  app.post(
    '/api/v1/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      enabled();
      const p = loginInput.parse(req.body),
        ipHash = keyedHash('login-ip:' + req.ip, c.AUTH_PEPPER);
      // Code-review H2: scrypt (~100 ms, 64 MB) must never run while an auth-pool connection
      // and the guard row lock are held, or a handful of logins stall every device session.
      // 1) short transaction: guards + read the stored hash, 2) hash with no connection,
      // 3) short transaction: record the outcome and recheck the credential version.
      const checked = await transaction(pools.authPool, async (db) => {
        await db.query(
          'INSERT INTO password_login_guards(email) VALUES($1) ON CONFLICT DO NOTHING',
          [p.email],
        );
        const guard = (
          await db.query('SELECT * FROM password_login_guards WHERE email=$1 FOR UPDATE', [p.email])
        ).rows[0];
        if (Date.now() - guard.window_started_at.getTime() >= 15 * 60_000) {
          await db.query(
            'UPDATE password_login_guards SET failures=0,locked_until=NULL,window_started_at=clock_timestamp() WHERE email=$1',
            [p.email],
          );
          guard.failures = 0;
          guard.locked_until = null;
        }
        await db.query(
          'INSERT INTO password_login_ip_guards(email,ip_hash) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [p.email, ipHash],
        );
        const pair = (
          await db.query(
            'SELECT * FROM password_login_ip_guards WHERE email=$1 AND ip_hash=$2 FOR UPDATE',
            [p.email, ipHash],
          )
        ).rows[0];
        if (Date.now() - pair.window_started_at.getTime() >= 15 * 60_000) {
          await db.query(
            'UPDATE password_login_ip_guards SET failures=0,locked_until=NULL,window_started_at=clock_timestamp() WHERE email=$1 AND ip_hash=$2',
            [p.email, ipHash],
          );
          pair.failures = 0;
          pair.locked_until = null;
        }
        const delayMs = Math.min(800, 50 * 2 ** Math.min(pair.failures, 4));
        // Security M3: the account-wide lock does not apply to an address that recently
        // signed in to this account; that address keeps its own per-address lock.
        const known = guard.locked_until > new Date() && (await knownAddress(db, p.email, ipHash));
        if ((guard.locked_until > new Date() && !known) || pair.locked_until > new Date())
          return { blocked: true as const, delayMs };
        const u = (
          await db.query(
            'SELECT id,password_hash,password_version,status FROM users WHERE email=$1',
            [p.email],
          )
        ).rows[0] as
          | { id: string; password_hash: string | null; password_version: number; status: string }
          | undefined;
        return { blocked: false as const, delayMs, user: u };
      });
      const correct =
        !checked.blocked &&
        (await verifyPassword(p.password, checked.user?.password_hash, c.AUTH_PEPPER));
      const result = checked.blocked
        ? { user: null, delayMs: checked.delayMs }
        : await transaction(pools.authPool, async (db) => {
            const u = checked.user;
            // The account may have changed while hashing: only the same credential counts.
            const current =
              correct && u
                ? (
                    await db.query(
                      "SELECT id,password_version FROM users WHERE id=$1 AND status='active' AND password_version=$2 AND password_hash IS NOT DISTINCT FROM $3 FOR SHARE",
                      [u.id, u.password_version, u.password_hash],
                    )
                  ).rows[0]
                : undefined;
            if (!current) return failed(db, p.email, ipHash, checked.delayMs);
            await db.query('DELETE FROM password_login_ip_guards WHERE email=$1 AND ip_hash=$2', [
              p.email,
              ipHash,
            ]);
            await db.query(
              `INSERT INTO password_login_known_addresses(email,ip_hash) VALUES($1,$2)
               ON CONFLICT(email,ip_hash) DO UPDATE SET last_success_at=clock_timestamp()`,
              [p.email, ipHash],
            );
            const locale = req.headers['x-nuqta-language'];
            if (locale === 'ar' || locale === 'en')
              await db.query('UPDATE users SET preferred_locale=$2 WHERE id=$1', [u!.id, locale]);
            return { user: current as { id: string; password_version: number }, delayMs: 0 };
          });
      if (result.delayMs) await setTimeout(result.delayMs);
      const user = result.user;
      requireCondition(user, 'INVALID_CREDENTIALS', 401);
      const primary = (
        await pools.authPool.query('SELECT password_session_portal($1) AS portal', [user.id])
      ).rows[0].portal;
      requireCondition(primary !== 'customer', 'CUSTOMER_DEVICE_REQUIRED', 410);
      return issue(reply, user.id, user.password_version);
    },
  );
  async function knownAddress(db: DB, email: string, ipHash: string) {
    return !!(
      await db.query(
        "SELECT 1 FROM password_login_known_addresses WHERE email=$1 AND ip_hash=$2 AND last_success_at>clock_timestamp()-interval '90 days'",
        [email, ipHash],
      )
    ).rowCount;
  }
  async function failed(db: DB, email: string, ipHash: string, delayMs: number) {
    await db.query(
      "UPDATE password_login_guards SET failures=failures+1,locked_until=CASE WHEN failures+1>=20 THEN window_started_at+interval '15 minutes' ELSE NULL END,last_attempt_at=clock_timestamp() WHERE email=$1",
      [email],
    );
    await db.query(
      "UPDATE password_login_ip_guards SET failures=failures+1,locked_until=CASE WHEN failures+1>=5 THEN window_started_at+interval '15 minutes' ELSE NULL END,last_attempt_at=clock_timestamp() WHERE email=$1 AND ip_hash=$2",
      [email, ipHash],
    );
    return { user: null, delayMs };
  }
  app.post(
    '/api/v1/auth/register',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async () => {
      enabled();
      requireCondition(false, 'REGISTRATION_CLOSED', 403);
    },
  );
  app.post(
    '/api/v1/auth/password/change',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      enabled();
      const actor = authenticated(req),
        p = changePasswordInput.parse(req.body),
        hash = await hashPassword(p.password, c.AUTH_PEPPER);
      requireCondition(
        (await pools.authPool.query('SELECT password_session_portal($1) AS portal', [actor.id]))
          .rows[0].portal !== 'customer',
        'CUSTOMER_DEVICE_REQUIRED',
        410,
      );
      if (actor.mfaRequired)
        requireCondition(
          actor.mfaAt && Date.now() - actor.mfaAt.getTime() < 900000,
          'MFA_REQUIRED',
          403,
        );
      // Verify outside any transaction (Code-review H2), then require the same stored hash
      // under the row lock so a concurrent change cannot be overwritten.
      const stored = (
        await pools.authPool.query(
          "SELECT password_hash FROM users WHERE id=$1 AND status='active'",
          [actor.id],
        )
      ).rows[0]?.password_hash as string | undefined;
      requireCondition(
        await verifyPassword(p.currentPassword, stored, c.AUTH_PEPPER),
        'INVALID_CREDENTIALS',
        401,
      );
      const version = await transaction(pools.authPool, async (db) => {
        const u = (
          await db.query(
            "SELECT password_hash FROM users WHERE id=$1 AND status='active' FOR UPDATE",
            [actor.id],
          )
        ).rows[0];
        requireCondition(u && u.password_hash === stored, 'INVALID_CREDENTIALS', 401);
        const updated = (
          await db.query(
            'UPDATE users SET password_hash=$1,password_version=password_version+1,password_must_change=false WHERE id=$2 RETURNING password_version',
            [hash, actor.id],
          )
        ).rows[0];
        await db.query(
          'UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL',
          [actor.id],
        );
        await db.query(
          'UPDATE password_login_guards SET failures=0,locked_until=NULL WHERE email=$1',
          [actor.email],
        );
        return updated.password_version as number;
      });
      return issue(reply, actor.id, version);
    },
  );
  app.post(
    '/api/v1/auth/merchant-signup',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      enabled();
      requireCondition(c.ONBOARDING_INSTAPAY_ADDRESS, 'ONBOARDING_PAYMENT_UNAVAILABLE', 503);
      const { email, name, locale } = z
        .object({
          email: z
            .email()
            .max(254)
            .transform((value) => value.toLowerCase()),
          name: z.string().trim().min(2).max(120),
          locale: z.enum(['ar', 'en']),
        })
        .strict()
        .parse(req.body);
      const token = opaqueToken();
      await transaction(pools.authPool, async (db) => {
        const { id } = (
          await db.query('SELECT start_merchant_signup($1,$2,$3) AS id', [email, name, locale])
        ).rows[0];
        if (!id) return;
        // A new owner may open the welcome email hours later, so its single-use link lasts a day
        // (a password reset link stays at 30 minutes).
        const created = (
          await db.query(
            `INSERT INTO password_reset_tokens(user_id,token_hash,credential_version,expires_at)
           SELECT id,$2,password_version,clock_timestamp()+interval '24 hours'
           FROM users WHERE id=$1 AND password_hash IS NULL
           RETURNING id,credential_version,expires_at`,
            [id, tokenHash(token)],
          )
        ).rows[0];
        if (!created) return;
        await db.query(
          `INSERT INTO auth_mail_outbox(user_id,kind,reset_token_id,credential_version,payload,locale,dedupe_key,expires_at)
           VALUES($1,'merchant_welcome',$2,$3,$4,$5,$6,$7)`,
          [
            id,
            created.id,
            created.credential_version,
            { encryptedToken: seal(token, c.AUTH_PEPPER) },
            locale,
            'merchant-welcome:' + created.id,
            created.expires_at,
          ],
        );
      });
      reply.code(202);
      return { accepted: true };
    },
  );
  app.post(
    '/api/v1/auth/password/reset-request',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      enabled();
      const p = resetRequestInput.parse(req.body),
        token = opaqueToken();
      await transaction(pools.authPool, async (db) => {
        const u = (
          await db.query(
            "SELECT id,password_version,preferred_locale FROM users WHERE email=$1 AND status='active' AND password_session_portal(id)<>'customer' FOR SHARE",
            [p.email],
          )
        ).rows[0];
        if (!u) return;
        const row = (
          await db.query(
            "INSERT INTO password_reset_tokens(user_id,token_hash,credential_version,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '30 minutes') RETURNING id,expires_at",
            [u.id, tokenHash(token), u.password_version],
          )
        ).rows[0];
        await db.query(
          "INSERT INTO auth_mail_outbox(user_id,kind,reset_token_id,credential_version,payload,locale,dedupe_key,expires_at) VALUES($1,'password_reset',$2,$3,$4,$5,$6,$7)",
          [
            u.id,
            row.id,
            u.password_version,
            { encryptedToken: seal(token, c.AUTH_PEPPER) },
            u.preferred_locale,
            'password-reset:' + row.id,
            row.expires_at,
          ],
        );
      });
      reply.code(202);
      return { accepted: true };
    },
  );
  app.post(
    '/api/v1/auth/password/reset',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      enabled();
      const p = resetPasswordInput.parse(req.body),
        hash = await hashPassword(p.password, c.AUTH_PEPPER);
      const reset = await transaction(pools.authPool, async (db) => {
        const row = (
          await db.query(
            "SELECT t.id,t.user_id,u.email,is_onboarding_owner(u.id) AS onboarding FROM password_reset_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.used_at IS NULL AND t.expires_at>clock_timestamp() AND t.credential_version=u.password_version AND u.status='active' AND password_session_portal(u.id)<>'customer' FOR UPDATE OF u,t",
            [tokenHash(p.token)],
          )
        ).rows[0];
        requireCondition(row, 'RESET_LINK_INVALID', 410);
        const { password_version: version } = (
          await db.query(
            'UPDATE users SET password_hash=$1,password_version=password_version+1,password_must_change=false WHERE id=$2 RETURNING password_version',
            [hash, row.user_id],
          )
        ).rows[0];
        await db.query('UPDATE password_reset_tokens SET used_at=clock_timestamp() WHERE id=$1', [
          row.id,
        ]);
        await db.query(
          'UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL',
          [row.user_id],
        );
        await db.query(
          'UPDATE password_login_guards SET failures=0,locked_until=NULL WHERE email=$1',
          [row.email],
        );
        return {
          userId: row.user_id as string,
          version: version as number,
          onboarding: row.onboarding === true,
        };
      });
      // A shop owner who has not published yet (welcome link or a later reset; either emailed link
      // proves they own the address) goes straight back to their setup instead of signing in again.
      if (reset.onboarding)
        return {
          changed: true,
          onboarding: true,
          ...(await issue(reply, reset.userId, reset.version)),
        };
      reply.clearCookie(c.COOKIE_SECURE === 'true' ? '__Host-nq_session' : 'nq_session', {
        path: '/',
        secure: c.COOKIE_SECURE === 'true',
        sameSite: 'strict',
      });
      reply.clearCookie(c.COOKIE_SECURE === 'true' ? '__Host-nq_csrf' : 'nq_csrf', {
        path: '/',
        secure: c.COOKIE_SECURE === 'true',
        sameSite: 'strict',
      });
      return { changed: true, onboarding: false };
    },
  );
}
