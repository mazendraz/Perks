import { passwordAuth } from './password-auth.js';
import { requestPortal, portalCookies, portalAllowed } from './portal-auth.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import type { Config } from './config.js';
import { type Actor, type Pools, transaction } from './db.js';
import { keyedHash, opaqueToken, otpCode, safeEqual, tokenHash, totp } from './crypto.js';
import { AppError, requireCondition } from './errors.js';
import { readdir, readFile } from 'node:fs/promises';
declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
    sessionCookieName: string;
    csrfCookieName: string;
  }
}
type Mail = {
  id: string;
  to: string;
  code?: string;
  link?: string;
  expiresAt: string;
  createdAt: string;
};
export function authModule(app: FastifyInstance, pools: Pools, c: Config) {
  const localMail = new Map<string, Mail>();
  const sessionCookie = c.COOKIE_SECURE === 'true' ? '__Host-nq_session' : 'nq_session';
  const csrfCookie = c.COOKIE_SECURE === 'true' ? '__Host-nq_csrf' : 'nq_csrf';
  const cookieOptions = {
    path: '/',
    secure: c.COOKIE_SECURE === 'true',
    sameSite: 'strict' as const,
  };
  const jwks =
    c.AUTH_PROVIDER === 'supabase' ? createRemoteJWKSet(new URL(c.AUTH_JWKS_URL!)) : null;
  app.decorateRequest('actor', null);
  app.decorateRequest('sessionCookieName', '');
  app.decorateRequest('csrfCookieName', '');
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!req.url.startsWith('/api/')) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method))
      requireCondition(req.headers.origin === c.PUBLIC_APP_ORIGIN, 'ORIGIN_REJECTED', 403);
    const portal = requestPortal(
      req.headers['x-nuqta-workspace'] ??
        (req.method === 'GET'
          ? (new URL(req.url, 'http://local').searchParams.get('__portal') ?? undefined)
          : undefined),
    );
    const scoped = portalCookies(c, portal);
    const cookieName = req.cookies[scoped.session] ? scoped.session : sessionCookie;
    req.sessionCookieName = cookieName;
    req.csrfCookieName = cookieName === sessionCookie ? csrfCookie : scoped.csrf;
    const raw = req.cookies[cookieName];
    if (!raw) return;
    const s = await pools.authPool.query(
      'SELECT u.id,u.email,u.global_role,u.status,s.id AS session_id,s.csrf_hash,s.mfa_at,s.auth_method,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.credential_version=u.password_version',
      [tokenHash(raw)],
    );
    const row = s.rows[0];
    if (!row || row.status !== 'active') {
      reply.clearCookie(cookieName, cookieOptions);
      return;
    }
    req.actor = {
      id: row.id,
      email: row.email,
      role: row.global_role,
      sessionId: row.session_id,
      mfaAt: row.mfa_at,
      authMethod: row.auth_method,
      csrfHash: row.csrf_hash,
    };
    if (portal && !(await portalAllowed(pools, req.actor, portal, cookieName === sessionCookie))) {
      req.actor = null;
      return;
    }
    if (portal && cookieName === sessionCookie && req.url.split('?')[0] === '/api/v1/session') {
      const maxAge = Math.max(1, Math.floor((row.expires_at.getTime() - Date.now()) / 1000));
      reply.setCookie(scoped.session, raw, { ...cookieOptions, httpOnly: true, maxAge });
      if (req.cookies[csrfCookie])
        reply.setCookie(scoped.csrf, req.cookies[csrfCookie], {
          ...cookieOptions,
          httpOnly: false,
          maxAge,
        });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const csrf = String(req.headers['x-csrf-token'] || '');
      requireCondition(csrf && safeEqual(tokenHash(csrf), row.csrf_hash), 'CSRF_REJECTED', 403);
    }
  });
  async function issue(
    reply: FastifyReply,
    userId: string,
    mfa: boolean,
    ttl = 8 * 60 * 60,
    method: 'otp' | 'password' | 'managed' = 'otp',
    version?: number,
  ) {
    let portal = requestPortal(reply.request.headers['x-nuqta-workspace']);
    const u = (
      await pools.authPool.query('SELECT id,email,global_role FROM users WHERE id=$1', [userId])
    ).rows[0];
    requireCondition(u, 'INVALID_CREDENTIALS', 401);
    const context: Actor = {
      id: u.id,
      email: u.email,
      role: u.global_role,
      sessionId: '',
      csrfHash: '',
      mfaAt: null,
    };
    if (!portal) {
      if (['platform_admin', 'platform_support'].includes(u.global_role)) portal = 'platform';
      else {
        const role = await transaction(
          pools.pool,
          async (db) =>
            (
              await db.query(
                "SELECT role FROM staff_memberships WHERE user_id=$1 AND status='active' ORDER BY CASE WHEN role IN ('owner','manager') THEN 0 ELSE 1 END,id LIMIT 1",
                [userId],
              )
            ).rows[0]?.role,
          context,
        );
        portal =
          role === 'owner' || role === 'manager'
            ? 'merchant'
            : role === 'cashier'
              ? 'cashier'
              : 'customer';
      }
    }
    const names = portalCookies(c, portal);
    requireCondition(await portalAllowed(pools, context, portal), 'PORTAL_ACCESS_REQUIRED', 403);
    const token = opaqueToken(),
      csrf = opaqueToken();
    const created = await pools.authPool.query(
      "INSERT INTO sessions(user_id,token_hash,csrf_hash,expires_at,mfa_at,auth_method,credential_version) SELECT id,$2,$3,now()+$4*interval'1 second',CASE WHEN $5 THEN now() ELSE NULL END,$6,password_version FROM users WHERE id=$1 AND status='active' AND ($7::integer IS NULL OR password_version=$7)",
      [userId, tokenHash(token), tokenHash(csrf), ttl, mfa, method, version ?? null],
    );
    requireCondition(created.rowCount, 'INVALID_CREDENTIALS', 401);
    reply.setCookie(sessionCookie, token, { ...cookieOptions, httpOnly: true, maxAge: ttl });
    reply.setCookie(csrfCookie, csrf, { ...cookieOptions, httpOnly: false, maxAge: ttl });
    if (portal) {
      reply.setCookie(names.session, token, { ...cookieOptions, httpOnly: true, maxAge: ttl });
      reply.setCookie(names.csrf, csrf, { ...cookieOptions, httpOnly: false, maxAge: ttl });
    }
    return { csrfToken: csrf, portal };
  }
  passwordAuth(
    app,
    pools,
    c,
    (reply, id, version) => issue(reply, id, false, 8 * 60 * 60, 'password', version),
    (id, email, token, expiresAt) => {
      localMail.set(id, {
        id,
        to: email,
        link: c.PUBLIC_APP_ORIGIN + '/reset-password/' + token,
        expiresAt,
        createdAt: new Date().toISOString(),
      });
    },
  );
  app.post(
    '/api/v1/auth/challenges',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      requireCondition(c.AUTH_PROVIDER === 'local', 'MANAGED_AUTH_REQUIRED', 409);
      requireCondition(c.APP_ENV === 'test', 'PASSWORD_LOGIN_REQUIRED', 410);
      const { email } = z
        .object({
          email: z
            .email()
            .max(254)
            .transform((v) => v.trim().toLowerCase()),
        })
        .strict()
        .parse(req.body);
      requireCondition(
        !(
          await pools.authPool.query(
            'SELECT 1 FROM users WHERE email=$1 AND password_hash IS NOT NULL',
            [email],
          )
        ).rowCount,
        'PASSWORD_LOGIN_REQUIRED',
        410,
      );
      const code = otpCode();
      const row = await transaction(pools.authPool, async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['auth:' + email]);
        const recent = await db.query(
          "SELECT id,expires_at FROM auth_challenges WHERE email=$1 AND created_at>now()-interval '30 seconds' AND used_at IS NULL ORDER BY created_at DESC LIMIT 1",
          [email],
        );
        if (recent.rows[0]) return { ...recent.rows[0], existing: true };
        const result = await db.query(
          "INSERT INTO auth_challenges(email,code_hash,expires_at) VALUES($1,$2,now()+interval '5 minutes') RETURNING id,expires_at",
          [email, keyedHash(email + ':' + code, c.AUTH_PEPPER)],
        );
        return { ...result.rows[0], existing: false };
      });
      if (!row.existing)
        localMail.set(row.id, {
          id: row.id,
          to: email,
          code,
          expiresAt: row.expires_at.toISOString(),
          createdAt: new Date().toISOString(),
        });
      for (const [id, mail] of localMail)
        if (Date.parse(mail.expiresAt) < Date.now()) localMail.delete(id);
      reply.code(202);
      return { challengeId: row.id, expiresAt: row.expires_at };
    },
  );
  app.post(
    '/api/v1/auth/challenges/:id/verify',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      requireCondition(c.AUTH_PROVIDER === 'local', 'MANAGED_AUTH_REQUIRED', 409);
      requireCondition(c.APP_ENV === 'test', 'PASSWORD_LOGIN_REQUIRED', 410);
      const { id } = z.object({ id: z.uuid() }).parse(req.params),
        { code } = z
          .object({ code: z.string().regex(/^\d{6}$/) })
          .strict()
          .parse(req.body);
      const result = await transaction(pools.authPool, async (db) => {
        const r = await db.query('SELECT * FROM auth_challenges WHERE id=$1 FOR UPDATE', [id]),
          ch = r.rows[0];
        if (!ch || ch.used_at || ch.attempts >= 5 || ch.expires_at.getTime() <= Date.now())
          return null;
        await db.query('UPDATE auth_challenges SET attempts=attempts+1 WHERE id=$1', [id]);
        if (!safeEqual(ch.code_hash, keyedHash(ch.email + ':' + code, c.AUTH_PEPPER))) return null;
        await db.query('UPDATE auth_challenges SET used_at=now() WHERE id=$1', [id]);
        const u = await db.query(
          'INSERT INTO users(email,display_name) VALUES($1,$2) ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email WHERE users.password_hash IS NULL RETURNING id,status',
          [ch.email, ch.email.split('@')[0]],
        );
        return u.rows[0]?.status === 'active' ? u.rows[0].id : null;
      });
      requireCondition(result, 'INVALID_OR_EXPIRED_CODE', 401);
      localMail.delete(id);
      return issue(reply, result, false);
    },
  );
  app.post(
    '/api/v1/auth/exchange',
    { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      requireCondition(jwks && c.AUTH_PROVIDER === 'supabase', 'PROVIDER_NOT_CONFIGURED', 503);
      const { accessToken } = z
        .object({ accessToken: z.string().max(16000) })
        .strict()
        .parse(req.body);
      let identity: {
        id: string;
        email: string;
        email_confirmed_at?: string;
        is_anonymous?: boolean;
      };
      let aal: string;
      let expiry: number;
      try {
        const { payload } = await jwtVerify(accessToken, jwks, {
          issuer: c.AUTH_ISSUER,
          audience: c.AUTH_AUDIENCE,
          algorithms: ['ES256', 'RS256'],
        });
        const response = await fetch(c.AUTH_ISSUER + '/user', {
          headers: { Authorization: 'Bearer ' + accessToken, apikey: c.AUTH_PUBLIC_KEY || '' },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error('Invalid identity');
        identity = (await response.json()) as typeof identity;
        requireCondition(
          identity.id === payload.sub && identity.email_confirmed_at && !identity.is_anonymous,
          'VERIFIED_IDENTITY_REQUIRED',
          401,
        );
        aal = String(payload.aal || 'aal1');
        expiry = Math.max(1, Math.min(900, (payload.exp || 0) - Math.floor(Date.now() / 1000)));
      } catch {
        throw new AppError('INVALID_IDENTITY', 401);
      }
      const u = await pools.authPool.query(
        'INSERT INTO users(email,display_name,auth_subject) VALUES($1,$2,$3) ON CONFLICT(email) DO UPDATE SET auth_subject=EXCLUDED.auth_subject WHERE users.auth_subject IS NULL OR users.auth_subject=EXCLUDED.auth_subject RETURNING id,status',
        [identity.email.toLowerCase(), identity.email.split('@')[0], identity.id],
      );
      requireCondition(u.rows[0]?.status === 'active', 'INVALID_IDENTITY', 401);
      return issue(reply, u.rows[0].id, aal === 'aal2', expiry, 'managed');
    },
  );
  app.get('/api/v1/auth/config', async () => ({
    provider: c.AUTH_PROVIDER,
    loginMethod: 'password',
    publicUrl: c.AUTH_PUBLIC_URL || null,
    publicKey: c.AUTH_PUBLIC_KEY || null,
    localMailAvailable: c.AUTH_PROVIDER === 'local' && ['development', 'test'].includes(c.APP_ENV),
  }));
  app.get('/api/v1/local/mail', async (req) => {
    requireCondition(
      c.AUTH_PROVIDER === 'local' && ['development', 'test'].includes(c.APP_ENV),
      'NOT_FOUND',
      404,
    );
    requireCondition(['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip), 'FORBIDDEN', 403);
    const messages: Record<string, unknown>[] = [...localMail.values()].filter(
      (m) => Date.parse(m.expiresAt) > Date.now(),
    );
    try {
      for (const file of (await readdir('.local/mail'))
        .filter((f) => /^[0-9a-f-]{36}\.json$/.test(f))
        .slice(-30))
        messages.push(
          JSON.parse(await readFile('.local/mail/' + file, 'utf8')) as Record<string, unknown>,
        );
    } catch {
      /* no local invitation mail yet */
    }
    return {
      environment: c.APP_ENV,
      warning: 'Local development mail only. Never available in deployed environments.',
      messages,
    };
  });
  app.get('/api/v1/session', async (req) => {
    const actor = authenticated(req);
    const grants = await transaction(
      pools.pool,
      async (db) =>
        (
          await db.query(
            "SELECT s.id,s.merchant_id,s.role,s.max_qty,m.name,m.slug,m.status,m.timezone,m.primary_color,coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'name',b.name)) FROM staff_branch_grants g JOIN branches b ON b.id=g.branch_id AND b.merchant_id=g.merchant_id WHERE g.staff_id=s.id AND b.status='active'),'[]') AS branches FROM staff_memberships s JOIN merchants m ON m.id=s.merchant_id WHERE s.user_id=$1 AND s.status='active' ORDER BY m.name",
            [actor.id],
          )
        ).rows,
      actor,
    );
    return {
      user: {
        id: actor.id,
        email: actor.email,
        role: actor.role,
        mfaRequired: actor.authMethod !== 'password',
        mfaVerified: !!actor.mfaAt && Date.now() - actor.mfaAt.getTime() < 900_000,
      },
      csrfToken: req.cookies[req.csrfCookieName] || '',
      grants,
    };
  });
  app.post(
    '/api/v1/auth/mfa/verify',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req) => {
      const actor = authenticated(req);
      requireCondition(c.AUTH_PROVIDER === 'local', 'MANAGED_MFA_REQUIRED', 409);
      const { code } = z
        .object({ code: z.string().regex(/^\d{6}$/) })
        .strict()
        .parse(req.body);
      const verified = await transaction(pools.authPool, async (db) => {
        const row = (
          await db.query('SELECT totp_secret,last_totp_counter FROM users WHERE id=$1 FOR UPDATE', [
            actor.id,
          ])
        ).rows[0];
        if (!row?.totp_secret) return false;
        const current = Math.floor(Date.now() / 30000);
        const counter = [current - 1, current, current + 1].find(
          (n) => n > Number(row.last_totp_counter) && safeEqual(totp(row.totp_secret, n), code),
        );
        if (counter === undefined) return false;
        await db.query('UPDATE users SET last_totp_counter=$1 WHERE id=$2', [counter, actor.id]);
        await db.query('UPDATE sessions SET mfa_at=now() WHERE id=$1', [actor.sessionId]);
        return true;
      });
      requireCondition(verified, 'INVALID_MFA_CODE', 401);
      return { verified: true };
    },
  );
  app.post('/api/v1/auth/logout', async (req, reply) => {
    const actor = authenticated(req);
    await pools.authPool.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [
      actor.sessionId,
    ]);
    if (req.cookies[sessionCookie] === req.cookies[req.sessionCookieName]) {
      reply.clearCookie(sessionCookie, cookieOptions).clearCookie(csrfCookie, cookieOptions);
    }
    return reply
      .clearCookie(req.sessionCookieName, cookieOptions)
      .clearCookie(req.csrfCookieName, cookieOptions)
      .code(204)
      .send();
  });
}
export function authenticated(req: FastifyRequest): Actor {
  requireCondition(req.actor, 'UNAUTHENTICATED', 401);
  return req.actor;
}
