import { APPLE_SERVICE_PREFIX } from './wallet/constants.js';
import { passwordAuth } from './password-auth.js';
import { requestPortal, portalCookies, portalAllowed } from './portal-auth.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { deployed, type Config } from './config.js';
import { mfaModule } from './mfa.js';
import { type Actor, type Pools, transaction } from './db.js';
import { keyedHash, opaqueToken, otpCode, safeEqual, tokenHash } from './crypto.js';
import { requireCondition } from './errors.js';
import { readLocalMailbox } from './mail/mailer.js';
import { issueDeviceSession, deviceCookie } from './customer-auth/device-auth.js';
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
  app.decorateRequest('actor', null);
  app.decorateRequest('sessionCookieName', '');
  app.decorateRequest('csrfCookieName', '');
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!req.url.startsWith('/api/')) return;
    // Apple's pass web service carries its own per-pass token and never browser cookies.
    if (req.url.startsWith(APPLE_SERVICE_PREFIX + '/v1/')) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method))
      requireCondition(req.headers.origin === c.PUBLIC_APP_ORIGIN, 'ORIGIN_REJECTED', 403);
    const portal = requestPortal(
      req.headers['x-nuqta-workspace'] ??
        (req.method === 'GET'
          ? (new URL(req.url, 'http://local').searchParams.get('__portal') ?? undefined)
          : undefined),
    );
    const scoped = portalCookies(c, portal);
    let cookieName = req.cookies[scoped.session] ? scoped.session : sessionCookie;
    const canRestoreDevice = portal === 'customer' && req.method === 'GET';
    if (canRestoreDevice && !req.cookies[scoped.session]) {
      if (await issueDeviceSession(pools, c, req, reply)) cookieName = scoped.session;
    }
    req.sessionCookieName = cookieName;
    req.csrfCookieName = cookieName === sessionCookie ? csrfCookie : scoped.csrf;
    let raw = req.cookies[cookieName];
    const lookup = async () =>
      raw
        ? (
            await pools.authPool.query(
              "SELECT u.id,u.email,u.display_name,u.global_role,u.status,u.preferred_locale,s.id AS session_id,s.csrf_hash,s.mfa_at,s.auth_method,s.customer_device_id,s.expires_at,s.created_at,s.portal,password_session_portal(u.id) AS current_portal FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND s.credential_version=u.password_version AND (s.auth_method<>'device' OR customer_device_active(s.customer_device_id,s.user_id))",
              [tokenHash(raw)],
            )
          ).rows[0]
        : undefined;
    let row = await lookup();
    if (!row && canRestoreDevice && cookieName === scoped.session) {
      const restored = await issueDeviceSession(pools, c, req, reply);
      if (restored) {
        raw = restored.token;
        row = await lookup();
      }
    }
    if (!row || !raw || row.status !== 'active') {
      if (raw) reply.clearCookie(cookieName, cookieOptions);
      return;
    }
    const policies = [row.portal, row.current_portal];
    const hardTtl = policies.includes('platform')
      ? 12 * 3600
      : policies.some((value) => value === 'merchant' || value === 'cashier')
        ? 7 * 86400
        : 30 * 86400;
    if (row.auth_method === 'password' && hardTtl) {
      const cap = new Date(row.created_at.getTime() + hardTtl * 1000);
      if (cap <= new Date()) {
        reply.clearCookie(cookieName, cookieOptions);
        return;
      }
      if (row.expires_at > cap) {
        await pools.authPool.query(
          'UPDATE sessions SET expires_at=least(expires_at,$2) WHERE id=$1',
          [row.session_id, cap],
        );
        row.expires_at = cap;
      }
    }
    req.actor = {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.global_role,
      sessionId: row.session_id,
      mfaAt: row.mfa_at,
      authMethod: row.auth_method,
      locale: row.preferred_locale,
      mfaRequired: deployed(c) && ['platform_admin', 'platform_support'].includes(row.global_role),
      csrfHash: row.csrf_hash,
    };
    // A customer device grants access to its holder's card only, even if that
    // same legacy user is later invited to work at a shop. It never becomes a
    // staff/platform credential by changing a header or a cookie name.
    if (
      row.auth_method === 'device' &&
      !/^\/api\/v1\/(?:session(?:\?|$)|me\/|customer\/|public\/|auth\/logout(?:\?|$))/.test(req.url)
    ) {
      req.actor = null;
      return;
    }
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
    if (
      req.actor.mfaRequired &&
      !req.url.startsWith('/api/v1/auth/') &&
      req.url.split('?')[0] !== '/api/v1/session'
    )
      requireCondition(
        row.mfa_at && Date.now() - row.mfa_at.getTime() < 900000,
        'MFA_REQUIRED',
        403,
      );
    // Existing legacy customer password sessions may finish their original
    // lifetime, but are no longer extended. New customers use a bound device.
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
    const primary = requestPortal(
      (await pools.authPool.query('SELECT password_session_portal($1) AS portal', [userId])).rows[0]
        .portal,
    );
    requireCondition(primary, 'INVALID_CREDENTIALS', 401);
    if (!portal) portal = primary;
    requireCondition(method !== 'password' || portal !== 'customer', 'PORTAL_ACCESS_REQUIRED', 403);
    if (method === 'password')
      ttl = primary === 'platform' ? 12 * 3600 : primary === 'customer' ? 30 * 86400 : 7 * 86400;
    const names = portalCookies(c, portal);
    requireCondition(await portalAllowed(pools, context, portal), 'PORTAL_ACCESS_REQUIRED', 403);
    const token = opaqueToken(),
      csrf = opaqueToken();
    const created = await pools.authPool.query(
      "INSERT INTO sessions(user_id,token_hash,csrf_hash,expires_at,mfa_at,auth_method,credential_version,portal) SELECT id,$2,$3,now()+$4*interval'1 second',CASE WHEN $5 THEN now() ELSE NULL END,$6,password_version,$8 FROM users WHERE id=$1 AND status='active' AND ($7::integer IS NULL OR password_version=$7)",
      [userId, tokenHash(token), tokenHash(csrf), ttl, mfa, method, version ?? null, primary],
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
  passwordAuth(app, pools, c, (reply, id, version) =>
    issue(reply, id, false, 8 * 60 * 60, 'password', version),
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
  app.get('/api/v1/auth/config', async () => ({
    provider: c.AUTH_PROVIDER,
    loginMethod: 'password',
    localMailAvailable:
      c.AUTH_PROVIDER === 'local' &&
      c.MAIL_TRANSPORT === 'file' &&
      ['development', 'test'].includes(c.APP_ENV),
  }));
  app.get('/api/v1/local/mail', async (req) => {
    requireCondition(
      c.AUTH_PROVIDER === 'local' &&
        c.MAIL_TRANSPORT === 'file' &&
        ['development', 'test'].includes(c.APP_ENV),
      'NOT_FOUND',
      404,
    );
    requireCondition(['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip), 'FORBIDDEN', 403);
    const messages: Record<string, unknown>[] = [...localMail.values()].filter(
      (m) => Date.parse(m.expiresAt) > Date.now(),
    );
    messages.push(...(await readLocalMailbox(c)));
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
        displayName: actor.displayName,
        deviceBound: actor.authMethod === 'device',
        role: actor.role,
        mfaRequired: actor.mfaRequired || !['password', 'device'].includes(actor.authMethod || ''),
        mfaVerified: !!actor.mfaAt && Date.now() - actor.mfaAt.getTime() < 900_000,
      },
      csrfToken: req.cookies[req.csrfCookieName] || '',
      grants,
    };
  });
  mfaModule(app, pools, c);
  app.post('/api/v1/auth/logout', async (req, reply) => {
    const actor = authenticated(req);
    await pools.authPool.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [
      actor.sessionId,
    ]);
    if (actor.authMethod === 'device') {
      await pools.authPool.query(
        'UPDATE customer_devices SET revoked_at=clock_timestamp() WHERE id=(SELECT customer_device_id FROM sessions WHERE id=$1 AND user_id=$2)',
        [actor.sessionId, actor.id],
      );
      reply.clearCookie(deviceCookie(c), {
        path: '/',
        secure: c.COOKIE_SECURE === 'true',
        httpOnly: true,
        sameSite: 'lax',
      });
    }
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
