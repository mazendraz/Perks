import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { Socket } from 'node:net';
import { SMTPServer } from 'smtp-server';
import { generate } from 'selfsigned';
import pg from 'pg';
import { readConfig, type Config } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { SmtpMailer, MailFailure } from '../../apps/api/src/mail/mailer.js';
import { mailTemplate } from '../../apps/api/src/mail/templates.js';
import { runAuthMail } from '../../apps/worker/src/auth-mail.js';
import { runOne } from '../../apps/worker/src/runner.js';
import { emitOutbox, seal } from '../../apps/api/src/outbox.js';
import { opaqueToken, tokenHash } from '../../apps/api/src/crypto.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  worker = new pg.Pool({ connectionString: c.WORKER_DATABASE_URL });
assert.match(new URL(c.DATABASE_MIGRATOR_URL!).pathname, /^\/nuqta_test_\d+$/);
const origin = 'https://mail.nuqta.test',
  password = 'A private SMTP test password!';
let app: Awaited<ReturnType<typeof buildApp>>['app'],
  server: SMTPServer,
  smtp: Config,
  temp: string;
let dropReply = false;
const sockets = new Map<string, Socket>();
const messages: { raw: string; secure: boolean; to: string }[] = [];
before(async () => {
  await db.connect();
  await mkdir('.local', { recursive: true });
  temp = await mkdtemp(resolve('.local', 'smtp-test-'));
  const cert = await generate([{ name: 'commonName', value: 'localhost' }], {
    keyType: 'ec',
    algorithm: 'sha256',
    notBeforeDate: new Date(Date.now() - 60000),
    notAfterDate: new Date(Date.now() + 86400000),
    extensions: [
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', digitalSignature: true, keyCertSign: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
        ],
      },
    ],
  });
  const ca = resolve(temp, 'ca.pem');
  await writeFile(ca, cert.cert, { mode: 0o600 }); // The private key stays in memory.
  server = new SMTPServer({
    key: cert.private,
    cert: cert.cert,
    secure: false,
    logger: false,
    disableReverseLookup: true,
    onSecure(socket, session, callback) {
      sockets.set(session.id, socket);
      callback();
    },
    onAuth(auth, _session, callback) {
      callback(
        auth.username === 'test-user' && auth.password === 'test-only-password'
          ? null
          : new Error('Test authentication failed'),
        { user: 'test-user' },
      );
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('end', () => {
        messages.push({
          raw: Buffer.concat(chunks).toString('utf8'),
          secure: session.secure,
          to: session.envelope.rcptTo[0]!.address,
        });
        if (dropReply) sockets.get(session.id)!.destroy();
        else callback();
      });
    },
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.server.address();
  assert.ok(address && typeof address !== 'string');
  smtp = readConfig({
    APP_ENV: 'production',
    AUTH_PROVIDER: 'password',
    COOKIE_SECURE: 'true',
    PUBLIC_APP_ORIGIN: origin,
    MAIL_TRANSPORT: 'smtp',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: address.port,
    SMTP_USER: 'test-user',
    SMTP_PASS: 'test-only-password',
    SMTP_FROM: 'noreply@nuqta.test',
    SMTP_CA_FILE: ca,
    SMTP_STARTTLS: 'true',
    LOG_LEVEL: 'silent',
  });
  ({ app } = await buildApp({
    APP_ENV: 'test',
    PUBLIC_APP_ORIGIN: origin,
    LOG_LEVEL: 'silent',
    MAIL_TRANSPORT: 'file',
  }));
  await app.ready();
  for (let i = 0; i < 200 && (await runAuthMail(worker, c)); i++) {
    /* Other synthetic fixtures stay in the file sink. */
  }
});
after(async () => {
  await app?.close();
  await worker.end();
  await db.end();
  if (server) await new Promise<void>((done) => server.close(done));
  if (temp) {
    assert.ok(resolve(temp).startsWith(resolve('.local') + sep));
    await rm(temp, { recursive: true, force: true });
  }
});
async function register() {
  const email = 'smtp-' + randomUUID() + '@nuqta.test';
  const registered = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin, 'x-nuqta-language': 'en' },
    payload: { email, password },
  });
  assert.equal(registered.statusCode, 200);
  return { email, id: (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id };
}
test('reset mail survives an API restart, crosses a real TLS SMTP server once, opens a working reset link and queues the password-change confirmation', async () => {
  const user = await register();
  const request = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/password/reset-request',
    headers: { origin },
    payload: { email: user.email },
  });
  assert.equal(request.statusCode, 202);
  const job = (
    await db.query("SELECT * FROM auth_mail_outbox WHERE user_id=$1 AND kind='password_reset'", [
      user.id,
    ])
  ).rows[0];
  assert.ok(job.payload.encryptedToken);
  assert.ok(!JSON.stringify(job.payload).includes('/reset-password/'));
  await app.close();
  ({ app } = await buildApp({
    APP_ENV: 'test',
    PUBLIC_APP_ORIGIN: origin,
    MAIL_TRANSPORT: 'file',
    LOG_LEVEL: 'silent',
  }));
  await app.ready();
  assert.equal(await runAuthMail(worker, smtp), true);
  const delivered = messages.filter((message) => message.to === user.email);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0]!.secure, true);
  const decoded = delivered[0]!.raw.replace(/=\r?\n/g, '').replace(/=3D/gi, '=');
  const resetLink = decoded.match(
    /https:\/\/mail\.nuqta\.test\/reset-password\/[A-Za-z0-9_-]+/,
  )?.[0];
  assert.ok(resetLink);
  const subject = delivered[0]!.raw.split(/\r?\n\r?\n/)[0]!;
  const token = new URL(resetLink).pathname.split('/').at(-1)!;
  assert.ok(!subject.includes(token));
  const repeat = new SmtpMailer(smtp, worker);
  await repeat.send({
    ...mailTemplate('password_reset', 'en', { link: resetLink }),
    to: user.email,
    idempotencyKey: job.id,
  });
  assert.equal(messages.filter((message) => message.to === user.email).length, 1);
  const reset = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/password/reset',
    headers: { origin },
    payload: { token, password: 'A new SMTP reset password!' },
  });
  assert.equal(reset.statusCode, 200, reset.body);
  assert.equal(await runAuthMail(worker, smtp), true);
  assert.equal(messages.filter((message) => message.to === user.email).length, 2);
  assert.equal(
    (
      await db.query(
        "SELECT status FROM auth_mail_outbox WHERE user_id=$1 AND kind='password_changed'",
        [user.id],
      )
    ).rows[0].status,
    'sent',
  );
});
test('invitations use the same SMTP adapter in production and a lost SMTP acceptance reply is quarantined without a duplicate send', async () => {
  const merchant = (
    await db.query("INSERT INTO merchants(name,slug) VALUES('SMTP business',$1) RETURNING id", [
      'smtp-' + randomUUID(),
    ])
  ).rows[0].id;
  const branch = (
    await db.query("INSERT INTO branches(merchant_id,name) VALUES($1,'Main') RETURNING id", [
      merchant,
    ])
  ).rows[0].id;
  const token = opaqueToken(),
    email = 'invite-' + randomUUID() + '@nuqta.test';
  const invitation = (
    await db.query(
      "INSERT INTO invitations(merchant_id,email,role,max_qty,branch_ids,token_hash,expires_at) VALUES($1,$2,'cashier',3,$3,$4,now()+interval '7 days') RETURNING id",
      [merchant, email, [branch], tokenHash(token)],
    )
  ).rows[0].id;
  await emitOutbox(db, {
    merchantId: merchant,
    eventType: 'staff.invited',
    aggregateId: invitation,
    payload: { email, encryptedToken: seal(token, c.AUTH_PEPPER), locale: 'en' },
    dedupeKey: 'smtp-test:' + invitation,
    kind: 'invitation_email',
  });
  for (let i = 0; i < 200 && !messages.some((message) => message.to === email); i++)
    await runOne(worker, smtp);
  assert.equal(messages.filter((message) => message.to === email).length, 1);
  const unknownId = randomUUID(),
    uncertain = new SmtpMailer(smtp, worker),
    content = {
      ...mailTemplate('password_changed', 'en', { link: origin + '/login' }),
      to: 'ambiguous@nuqta.test',
      idempotencyKey: unknownId,
    };
  dropReply = true;
  await assert.rejects(
    uncertain.send(content),
    (error: unknown) => error instanceof MailFailure && error.outcome === 'unknown',
  );
  dropReply = false;
  await assert.rejects(
    uncertain.send(content),
    (error: unknown) => error instanceof MailFailure && error.outcome === 'unknown',
  );
  assert.equal(messages.filter((message) => message.to === content.to).length, 1);
  assert.equal(
    (await db.query('SELECT state FROM mail_delivery_receipts WHERE id=$1', [unknownId])).rows[0]
      .state,
    'unknown',
  );
  const concurrent = { ...content, to: 'concurrent@nuqta.test', idempotencyKey: randomUUID() };
  const attempts = await Promise.allSettled([
    uncertain.send(concurrent),
    uncertain.send(concurrent),
  ]);
  assert.equal(messages.filter((message) => message.to === concurrent.to).length, 1);
  assert.ok(
    attempts.every(
      (attempt) =>
        attempt.status === 'fulfilled' ||
        (attempt.reason instanceof MailFailure && attempt.reason.outcome === 'unknown'),
    ),
  );
});

test('mail payloads and delivery state are private; runtime/auth cannot dispatch and worker cannot read the unclaimed auth mailbox', async () => {
  const runtime = new pg.Client({ connectionString: c.DATABASE_URL }),
    auth = new pg.Client({ connectionString: c.AUTH_DATABASE_URL });
  await runtime.connect();
  await auth.connect();
  try {
    for (const query of [
      'SELECT * FROM auth_mail_outbox',
      'SELECT * FROM mail_delivery_receipts',
      'SELECT claim_auth_mail()',
    ])
      await assert.rejects(
        runtime.query(query),
        (error: { code?: string }) => error.code === '42501',
      );
    await assert.rejects(
      auth.query('SELECT begin_mail_delivery($1,$2,$3)', [
        randomUUID(),
        '0'.repeat(64),
        randomUUID(),
      ]),
      (error: { code?: string }) => error.code === '42501',
    );
    await assert.rejects(
      worker.query('SELECT * FROM auth_mail_outbox'),
      (error: { code?: string }) => error.code === '42501',
    );
  } finally {
    await runtime.end();
    await auth.end();
  }
});

test('a database connection error after SMTP acceptance cannot be mistaken for a safe transport retry', async () => {
  const id = randomUUID(),
    message = {
      ...mailTemplate('password_changed', 'en', { link: origin + '/login' }),
      to: 'db-ambiguity@nuqta.test',
      idempotencyKey: id,
    };
  const proxy = new Proxy(worker, {
    get(target, key) {
      if (key !== 'query') return Reflect.get(target, key);
      return async (sql: string, values: unknown[]) => {
        if (sql.includes("finish_mail_delivery($1,$2,'sent'"))
          throw Object.assign(new Error('Synthetic database outage'), {
            code: 'ECONNREFUSED',
            syscall: 'connect',
          });
        return target.query(sql, values);
      };
    },
  });
  await assert.rejects(
    new SmtpMailer(smtp, proxy).send(message),
    (error: unknown) => error instanceof MailFailure && error.outcome === 'unknown',
  );
  await assert.rejects(
    new SmtpMailer(smtp, worker).send(message),
    (error: unknown) => error instanceof MailFailure && error.outcome === 'unknown',
  );
  assert.equal(messages.filter((value) => value.to === message.to).length, 1);
  assert.equal(
    (await db.query('SELECT state FROM mail_delivery_receipts WHERE id=$1', [id])).rows[0].state,
    'unknown',
  );
});
