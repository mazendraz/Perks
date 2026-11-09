import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../apps/api/src/server.js';

test('only explicit trusted CIDRs supply client IPs; forged forwarding cannot share or evade a client rate limit', async () => {
  const { app } = await buildApp({
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    TRUSTED_PROXIES: '192.0.2.10/32',
  });
  app.get('/test/ip', async (req) => ({ ip: req.ip }));
  try {
    const call = (remoteAddress: string, forwarded: string) =>
      app.inject({ url: '/test/ip', remoteAddress, headers: { 'x-forwarded-for': forwarded } });
    assert.equal((await call('192.0.2.10', '198.51.100.1')).json().ip, '198.51.100.1');
    assert.equal((await call('192.0.2.11', '198.51.100.1')).json().ip, '192.0.2.11');
    assert.equal((await call('192.0.2.10', '203.0.113.1, 198.51.100.2')).json().ip, '198.51.100.2');
    for (let i = 0; i < 300; i++)
      assert.equal((await call('192.0.2.10', '198.51.100.8')).statusCode, 200);
    assert.equal((await call('192.0.2.10', '198.51.100.8')).statusCode, 429);
    assert.equal((await call('192.0.2.10', '198.51.100.9')).statusCode, 200);
    for (let i = 0; i < 300; i++)
      assert.equal((await call('192.0.2.12', '203.0.113.' + (i % 255))).statusCode, 200);
    assert.equal((await call('192.0.2.12', '198.51.100.11')).statusCode, 429);
    const wrongOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password/login',
      remoteAddress: '192.0.2.10',
      headers: {
        origin: 'https://attacker.test',
        'x-forwarded-for': '198.51.100.21',
        'x-forwarded-host': 'attacker.test',
        'x-forwarded-proto': 'https',
      },
      payload: { email: 'nobody@nuqta.test', password: 'arbitrary password' },
    });
    assert.equal(wrongOrigin.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('default denies forwarding and readiness rejects the table-owner database connection', async () => {
  const { readConfig } = await import('../../apps/api/src/config.js');
  const c = readConfig();
  const { app } = await buildApp({
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    TRUSTED_PROXIES: '',
    DATABASE_URL: c.DATABASE_MIGRATOR_URL,
  });
  app.get('/test/ip', async (req) => ({ ip: req.ip }));
  try {
    assert.equal(
      (
        await app.inject({
          url: '/test/ip',
          remoteAddress: '192.0.2.10',
          headers: { 'x-forwarded-for': '198.51.100.2' },
        })
      ).json().ip,
      '192.0.2.10',
    );
    assert.equal((await app.inject({ url: '/health/live' })).statusCode, 200);
    assert.equal((await app.inject({ url: '/health/ready' })).statusCode, 503);
  } finally {
    await app.close();
  }
});

test('readiness rejects swapped runtime/auth connections', async () => {
  const { readConfig } = await import('../../apps/api/src/config.js');
  const c = readConfig();
  for (const overrides of [
    { DATABASE_URL: c.AUTH_DATABASE_URL },
    { AUTH_DATABASE_URL: c.DATABASE_URL },
  ]) {
    const { app } = await buildApp({ ...overrides, APP_ENV: 'test', LOG_LEVEL: 'silent' });
    try {
      assert.equal((await app.inject({ url: '/health/ready' })).statusCode, 503);
    } finally {
      await app.close();
    }
  }
});

test('session and health responses cannot persist in a browser HTTP cache', async () => {
  const { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
  try {
    const session = await app.inject({ url: '/api/v1/session' });
    assert.equal(session.statusCode, 401);
    assert.equal(session.headers['cache-control'], 'no-store');
    assert.ok(
      !String(session.headers['content-security-policy']).includes('upgrade-insecure-requests'),
    );
    assert.equal((await app.inject({ url: '/health/ready' })).headers['cache-control'], 'no-store');
  } finally {
    await app.close();
  }
});
