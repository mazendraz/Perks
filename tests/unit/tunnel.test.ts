import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../../apps/api/src/config.js';
import { quickOrigin, tunnelServer } from '../../tools/tunnel-policy.js';
import { requireTunnelBase, tunnelDirectory } from '../../tools/tunnel-fixture.js';
import { cloudflaredEnvironment } from '../../tools/cloudflared-runtime.js';
test('phone-test origin and file boundaries reject wildcard, credentials, ports, local folders and an unrelated database', async () => {
  assert.equal(
    quickOrigin('https://one-two.trycloudflare.com'),
    'https://one-two.trycloudflare.com',
  );
  for (const origin of [
    'http://one.trycloudflare.com',
    'https://one.trycloudflare.com.evil.test',
    'https://x@one.trycloudflare.com',
    'https://one.trycloudflare.com:443',
    'https://one.trycloudflare.com/',
    'https://a.b.trycloudflare.com',
  ])
    assert.throws(() => quickOrigin(origin));
  const server = tunnelServer('https://one.trycloudflare.com', 4110, 5173);
  assert.deepEqual(server.allowedHosts, ['one.trycloudflare.com']);
  assert.equal(server.host, '127.0.0.1');
  assert.equal(server.strictPort, true);
  assert.ok(server.fs!.deny!.includes('**/.local/**'));
  const c = readConfig();
  requireTunnelBase(c);
  for (const name of ['nuqta_manual_mazen', 'production']) {
    const url = new URL(c.DATABASE_MIGRATOR_URL!);
    url.pathname = '/' + name;
    assert.throws(() => requireTunnelBase({ ...c, DATABASE_MIGRATOR_URL: url.href }));
  }
  const url = new URL(c.DATABASE_URL);
  url.pathname = '/nuqta_manual_mazen';
  assert.throws(() => requireTunnelBase({ ...c, DATABASE_URL: url.href }));
  await assert.rejects(() => tunnelDirectory('../manual-demo'));
  const env = cloudflaredEnvironment();
  for (const key of [
    'AUTH_PEPPER',
    'DATABASE_URL',
    'DATABASE_MIGRATOR_URL',
    'SMTP_PASS',
    'MONITORING_TOKEN',
    'TUNNEL_TOKEN',
  ])
    assert.equal(env[key], undefined);
});
