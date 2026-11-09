import type { FastifyInstance, FastifyReply } from 'fastify';
import { passwordEnabled, type Config } from './config.js';
import { transaction, type Pools } from './db.js';
import { authenticated } from './auth.js';
import { requireCondition } from './errors.js';
import { keyedHash, opaqueToken, tokenHash } from './crypto.js';
import { setTimeout } from 'node:timers/promises';
import { hashPassword, verifyPassword } from './passwords.js';
import { seal } from './outbox.js';
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
      const p = loginInput.parse(req.body);
      const result = await transaction(pools.authPool, async (db) => {
        const ipHash = keyedHash('login-ip:' + req.ip, c.AUTH_PEPPER);
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
        if (guard.locked_until > new Date() || pair.locked_until > new Date())
          return { user: null, delayMs };
        const u = (
          await db.query(
            'SELECT id,password_hash,password_version,status FROM users WHERE email=$1 FOR SHARE',
            [p.email],
          )
        ).rows[0];
        const correct = await verifyPassword(p.password, u?.password_hash, c.AUTH_PEPPER);
        if (!correct || !u || u.status !== 'active') {
          await db.query(
            "UPDATE password_login_guards SET failures=failures+1,locked_until=CASE WHEN failures+1>=20 THEN window_started_at+interval '15 minutes' ELSE NULL END,last_attempt_at=clock_timestamp() WHERE email=$1",
            [p.email],
          );
          await db.query(
            "UPDATE password_login_ip_guards SET failures=failures+1,locked_until=CASE WHEN failures+1>=5 THEN window_started_at+interval '15 minutes' ELSE NULL END,last_attempt_at=clock_timestamp() WHERE email=$1 AND ip_hash=$2",
            [p.email, ipHash],
          );
          return { user: null, delayMs };
        }
        await db.query('DELETE FROM password_login_ip_guards WHERE email=$1 AND ip_hash=$2', [
          p.email,
          ipHash,
        ]);
        const locale = req.headers['x-nuqta-language'];
        if (locale === 'ar' || locale === 'en')
          await db.query('UPDATE users SET preferred_locale=$2 WHERE id=$1', [u.id, locale]);
        return { user: u, delayMs: 0 };
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
      const version = await transaction(pools.authPool, async (db) => {
        const u = (
          await db.query(
            "SELECT password_hash FROM users WHERE id=$1 AND status='active' FOR UPDATE",
            [actor.id],
          )
        ).rows[0];
        requireCondition(
          await verifyPassword(p.currentPassword, u?.password_hash, c.AUTH_PEPPER),
          'INVALID_CREDENTIALS',
          401,
        );
        const updated = (
          await db.query(
            'UPDATE users SET password_hash=$1,password_version=password_version+1 WHERE id=$2 RETURNING password_version',
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
      await transaction(pools.authPool, async (db) => {
        const row = (
          await db.query(
            "SELECT t.id,t.user_id,u.email FROM password_reset_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.used_at IS NULL AND t.expires_at>clock_timestamp() AND t.credential_version=u.password_version AND u.status='active' AND password_session_portal(u.id)<>'customer' FOR UPDATE OF u,t",
            [tokenHash(p.token)],
          )
        ).rows[0];
        requireCondition(row, 'RESET_LINK_INVALID', 410);
        await db.query(
          'UPDATE users SET password_hash=$1,password_version=password_version+1 WHERE id=$2',
          [hash, row.user_id],
        );
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
      });
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
      return { changed: true };
    },
  );
}
