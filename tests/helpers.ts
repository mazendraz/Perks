import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { totp } from '../apps/api/src/crypto.js';
import { readConfig } from '../apps/api/src/config.js';
export async function login(app: FastifyInstance, email: string) {
  const origin = readConfig().PUBLIC_APP_ORIGIN;
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
