import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Config } from './config.js';
import { transaction, type Pools } from './db.js';
import { authenticated } from './auth.js';
import { requestPortal } from './portal-auth.js';
import { requireCondition } from './errors.js';
import { opaqueToken, tokenHash } from './crypto.js';
import { hashPassword, verifyPassword } from './passwords.js';
import {
  loginInput,
  registerInput,
  changePasswordInput,
  resetRequestInput,
  resetPasswordInput,
} from '../../../packages/contracts/src/auth.js';

type Issue = (reply: FastifyReply, id: string, version: number) => Promise<{ csrfToken: string }>;
export function passwordAuth(
  app: FastifyInstance,
  pools: Pools,
  c: Config,
  issue: Issue,
  resetMail: (id: string, email: string, token: string, expiresAt: string) => void,
) {
  const local = () =>
    requireCondition(
      c.AUTH_PROVIDER === 'local' && ['development', 'test'].includes(c.APP_ENV),
      'PASSWORD_AUTH_NOT_CONFIGURED',
      503,
    );
  app.post(
    '/api/v1/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      local();
      const p = loginInput.parse(req.body);
      const user = await transaction(pools.authPool, async (db) => {
        await db.query(
          'INSERT INTO password_login_guards(email) VALUES($1) ON CONFLICT DO NOTHING',
          [p.email],
        );
        const guard = (
          await db.query('SELECT * FROM password_login_guards WHERE email=$1 FOR UPDATE', [p.email])
        ).rows[0];
        const u = (
          await db.query(
            'SELECT id,password_hash,password_version,status FROM users WHERE email=$1 FOR SHARE',
            [p.email],
          )
        ).rows[0];
        const correct = await verifyPassword(p.password, u?.password_hash, c.AUTH_PEPPER);
        const locked = guard.locked_until && guard.locked_until > new Date();
        if (!correct || !u || u.status !== 'active' || locked) {
          await db.query(
            "UPDATE password_login_guards SET failures=CASE WHEN locked_until<=clock_timestamp() THEN 1 ELSE failures+1 END,locked_until=CASE WHEN locked_until>clock_timestamp() THEN locked_until WHEN (CASE WHEN locked_until<=clock_timestamp() THEN 1 ELSE failures+1 END)>=5 THEN clock_timestamp()+interval '15 minutes' ELSE NULL END,last_attempt_at=clock_timestamp() WHERE email=$1",
            [p.email],
          );
          return null;
        }
        await db.query(
          'UPDATE password_login_guards SET failures=0,locked_until=NULL,last_attempt_at=clock_timestamp() WHERE email=$1',
          [p.email],
        );
        return u;
      });
      requireCondition(user, 'INVALID_CREDENTIALS', 401);
      return issue(reply, user.id, user.password_version);
    },
  );
  app.post(
    '/api/v1/auth/register',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      local();
      const p = registerInput.parse(req.body),
        portal = requestPortal(req.headers['x-nuqta-workspace']);
      requireCondition(!portal || portal === 'customer', 'REGISTRATION_CLOSED', 403);
      const hash = await hashPassword(p.password, c.AUTH_PEPPER);
      const user = (
        await pools.authPool.query(
          'INSERT INTO users(email,display_name,password_hash,password_version) VALUES($1,$2,$3,1) ON CONFLICT(email) DO NOTHING RETURNING id,password_version',
          [p.email, p.displayName || p.email.split('@')[0], hash],
        )
      ).rows[0];
      requireCondition(user, 'ACCOUNT_UNAVAILABLE', 409);
      return issue(reply, user.id, user.password_version);
    },
  );
  app.post(
    '/api/v1/auth/password/change',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      local();
      const actor = authenticated(req),
        p = changePasswordInput.parse(req.body),
        hash = await hashPassword(p.password, c.AUTH_PEPPER);
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
      local();
      const p = resetRequestInput.parse(req.body),
        token = opaqueToken();
      const row = (
        await pools.authPool.query(
          "INSERT INTO password_reset_tokens(user_id,token_hash,credential_version,expires_at) SELECT id,$2,password_version,clock_timestamp()+interval '30 minutes' FROM users WHERE email=$1 AND status='active' RETURNING id,expires_at",
          [p.email, tokenHash(token)],
        )
      ).rows[0];
      if (row) resetMail(row.id, p.email, token, row.expires_at.toISOString());
      reply.code(202);
      return { accepted: true };
    },
  );
  app.post(
    '/api/v1/auth/password/reset',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      local();
      const p = resetPasswordInput.parse(req.body),
        hash = await hashPassword(p.password, c.AUTH_PEPPER);
      await transaction(pools.authPool, async (db) => {
        const row = (
          await db.query(
            "SELECT t.id,t.user_id,u.email FROM password_reset_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.used_at IS NULL AND t.expires_at>clock_timestamp() AND t.credential_version=u.password_version AND u.status='active' FOR UPDATE OF u,t",
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
