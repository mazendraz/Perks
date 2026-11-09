import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { totp } from '../apps/api/src/crypto.js';
import { readConfig } from '../apps/api/src/config.js';
import { hashPassword } from '../apps/api/src/passwords.js';
export async function createPasswordUser(
  db: pg.Client,
  email: string,
  password: string,
  role = 'owner',
) {
  const id = (
    await db.query(
      "INSERT INTO users(email,display_name,global_role,password_hash,password_version,preferred_locale) VALUES($1,$2,$3,$4,1,'en') RETURNING id",
      [
        email,
        'Synthetic password fixture',
        role.startsWith('platform_') ? role : 'customer',
        await hashPassword(password, readConfig().AUTH_PEPPER),
      ],
    )
  ).rows[0].id;
  if (role === 'owner' || role === 'cashier') {
    const mid = (
      await db.query(
        "INSERT INTO merchants(slug,name) VALUES($1,'Synthetic auth fixture') RETURNING id",
        ['auth-' + randomUUID()],
      )
    ).rows[0].id;
    const bid = (
      await db.query(
        "INSERT INTO branches(merchant_id,name) VALUES($1,'Auth branch') RETURNING id",
        [mid],
      )
    ).rows[0].id;
    const sid = (
      await db.query(
        'INSERT INTO staff_memberships(merchant_id,user_id,email,name,role) VALUES($1,$2,$3,$4,$4) RETURNING id',
        [mid, id, email, role],
      )
    ).rows[0].id;
    await db.query(
      'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3)',
      [mid, sid, bid],
    );
  }
  return id as string;
}
export async function login(
  app: FastifyInstance,
  email: string,
  origin = readConfig().PUBLIC_APP_ORIGIN,
) {
  const challenge = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/challenges',
    headers: { origin },
    payload: { email },
  });
  assert.equal(challenge.statusCode, 202);
  const id = challenge.json().challengeId;
  const mailbox = (
    await app.inject({ url: '/api/v1/local/mail', remoteAddress: '127.0.0.1' })
  ).json();
  const code = mailbox.messages.find((m: { id: string }) => m.id === id).code;
  const result = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/challenges/' + id + '/verify',
    headers: { origin },
    payload: { code },
  });
  assert.equal(result.statusCode, 200);
  return {
    cookie: result.cookies.map((x) => x.name + '=' + x.value).join('; '),
    origin,
    'x-csrf-token': result.json().csrfToken as string,
  };
}
export async function adminLogin(app: FastifyInstance, db: pg.Client) {
  const email = 'admin-' + randomUUID() + '@nuqta.test',
    secret = randomBytes(20).toString('hex');
  await db.query(
    "INSERT INTO users(email,display_name,global_role,totp_secret) VALUES($1,'Test admin','platform_admin',$2)",
    [email, secret],
  );
  const headers = await login(app, email);
  const result = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/mfa/verify',
    headers,
    payload: { code: totp(secret, Math.floor(Date.now() / 30_000)) },
  });
  assert.equal(result.statusCode, 200);
  return headers;
}
export const key = () => ({ 'idempotency-key': randomUUID() });

export async function enrollmentTerms(app: FastifyInstance, programId: string) {
  const r = await app.inject({ url: '/api/v1/public/programs/' + programId + '/terms' });
  assert.equal(r.statusCode, 200);
  return r.json().termsHash as string;
}
