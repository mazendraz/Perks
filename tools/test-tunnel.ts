import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { chromium } from 'playwright';
import { prepareTunnel, serveTunnel } from './tunnel-fixture.js';
import { readConfig } from '../apps/api/src/config.js';
import { ids } from '../db/seed.js';
const report: {
  at: string;
  status: string;
  checks: string[];
  externalTunnelOpened: boolean;
  source: Record<string, string>;
  reason?: string;
} = {
  at: new Date().toISOString(),
  status: 'running',
  checks: [],
  externalTunnelOpened: false,
  source: {},
};
const pass = (message: string) => {
  report.checks.push(message);
  console.log('PASS ' + message);
};
for (const path of [
  'tools/dev-tunnel.ts',
  'tools/tunnel-fixture.ts',
  'tools/tunnel-policy.ts',
  'tools/cloudflared-runtime.ts',
  'tools/private-local.ts',
  'tools/test-tunnel.ts',
])
  report.source[path] = createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
async function port() {
  const server = createServer();
  await new Promise<void>((r, j) => {
    server.once('error', j);
    server.listen(0, '127.0.0.1', r);
  });
  const value = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return value;
}
let fixture: Awaited<ReturnType<typeof prepareTunnel>> | undefined,
  service: Awaited<ReturnType<typeof serveTunnel>> | undefined;
try {
  const base = readConfig();
  fixture = await prepareTunnel(base);
  assert.notEqual(fixture.config.AUTH_PEPPER, base.AUTH_PEPPER);
  assert.equal(fixture.config.COOKIE_SECURE, 'true');
  assert.equal(fixture.config.AUTH_PROVIDER, 'password');
  assert.equal(fixture.config.MAIL_TRANSPORT, 'file');
  assert.equal(fixture.config.TRUSTED_PROXIES, '');
  assert.ok(fixture.config.STORAGE_ROOT.startsWith(fixture.root));
  for (const key of [
    'DATABASE_URL',
    'AUTH_DATABASE_URL',
    'WORKER_DATABASE_URL',
    'DATABASE_MIGRATOR_URL',
  ] as const)
    assert.equal(new URL(fixture.config[key]!).pathname, '/' + fixture.database);
  pass(
    'Fresh synthetic database, files, credentials and pepper are isolated; secure password auth and no external mail',
  );
  const webPort = await port(),
    apiPort = await port(),
    origin = 'https://synthetic-check.trycloudflare.com';
  service = await serveTunnel(fixture, origin, webPort, apiPort);
  const local = 'http://127.0.0.1:' + webPort,
    request = (path: string, host = new URL(origin).hostname) =>
      new Promise<Response>((done, reject) => {
        const request = httpRequest(
          local + path,
          { headers: { host }, signal: AbortSignal.timeout(10000) },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            response.once('error', reject);
            response.once('end', () =>
              done(new Response(Buffer.concat(chunks), { status: response.statusCode })),
            );
          },
        );
        request.once('error', reject);
        request.end();
      });
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/health/ready')).status, 200);
  assert.equal((await request('/', 'unapproved.example.test')).status, 403);
  pass(
    'Actual Vite server binds loopback, accepts the exact tunnel host, rejects another Host, and proxies readiness',
  );
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ locale: 'en-US' }),
      errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(local + '/login');
    await page.getByLabel('Email', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    pass(
      'Actual Vite React login renders in Chromium with dependency prebundles and no page errors',
    );
  } finally {
    await browser.close();
  }
  const canary = 'PRIVATE-TUNNEL-' + randomBytes(20).toString('hex');
  await writeFile(resolve(fixture.root, 'private-canary.txt'), canary, { mode: 0o600, flag: 'wx' });
  for (const path of [
    '/@fs/' + resolve(fixture.root, 'private-canary.txt').replaceAll('\\', '/'),
    '/@fs/' + resolve('.env').replaceAll('\\', '/'),
    '/@fs/' + resolve('deploy/init-secrets.sh').replaceAll('\\', '/'),
    '/@fs/' + resolve('docs/execution/STATUS.md').replaceAll('\\', '/'),
    '/.local/tunnel-demo/private-canary.txt',
    '/%2elocal/tunnel-demo/private-canary.txt',
    '/internal/metrics',
  ]) {
    const response = await request(path);
    assert.ok(response.status >= 400, path);
    assert.ok(!(await response.text()).includes(canary));
  }
  assert.equal((await request('/src/main.tsx')).status, 200);
  pass(
    'Private canary, environment, deployment scripts and docs cannot be served through Vite, including encoded hidden paths',
  );
  assert.equal((await request('/api/v1/me/events')).status, 503);
  assert.equal((await request('/api/v1/branches/' + ids.branchA + '/events')).status, 503);
  pass(
    'Unsupported Quick Tunnel SSE paths fail explicitly, so the existing 3-second polling fallback remains active',
  );
  const login = fixture.logins.find((u) => u.role === 'cashier')!;
  const signed = await service.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email: login.email, password: login.password },
  });
  assert.equal(signed.statusCode, 200, signed.body);
  assert.ok(
    signed.cookies.some(
      (c) => c.name === '__Host-nq_session' && c.secure && c.httpOnly && c.sameSite === 'Strict',
    ),
  );
  assert.equal((await request('/api/v1/local/mail')).status, 404);
  assert.equal(
    (
      await service.app.inject({
        method: 'POST',
        url: '/api/v1/auth/challenges',
        headers: { origin },
        payload: { email: login.email },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await service.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: 'https://evil.example.test' },
        payload: { email: login.email, password: login.password },
      })
    ).statusCode,
    403,
  );
  const cookie = signed.cookies.map((c) => c.name + '=' + c.value).join('; ');
  const bad = await service.app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: { origin, cookie },
  });
  assert.equal(bad.statusCode, 403);
  pass(
    'Cashier password login sets Secure HttpOnly Strict cookies; OTP/mailbox remain closed, Origin and CSRF remain enforced',
  );
  const db = new pg.Client({ connectionString: fixture.config.DATABASE_MIGRATOR_URL });
  await db.connect();
  try {
    const row = (
      await db.query(
        'SELECT public_code,resolve_placement(public_code) AS value FROM placements LIMIT 1',
      )
    ).rows[0];
    assert.equal(row.value.status, 'active');
    assert.equal(row.value.slug, 'bunn');
    assert.equal((await request('/p/' + row.public_code)).status, 200);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM merchants')).rows[0].n, 2);
  } finally {
    await db.end();
  }
  pass(
    'Only the two newly seeded synthetic merchants are present, with an active QR landing route',
  );
  report.status = 'passed';
} catch (error) {
  if (fixture)
    await writeFile(
      resolve(fixture.root, 'validation-error.log'),
      error instanceof Error ? error.stack || error.name : 'Unknown failure',
      { mode: 0o600 },
    );
  report.status = 'failed';
  report.reason = 'Local tunnel fixture validation failed; no external tunnel was opened.';
  process.exitCode = 1;
} finally {
  await service?.stop();
  await service?.stop(); // SIGINT and process exit may arrive together.
  await fixture?.drop();
  await mkdir('docs/execution/evidence/implementation', { recursive: true });
  await writeFile(
    'docs/execution/evidence/implementation/tunnel.json',
    JSON.stringify(report, null, 2) + '\n',
  );
}
if (report.status !== 'passed') throw new Error(report.reason);
