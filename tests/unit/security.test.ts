import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  canonicalJson,
  keyedHash,
  opaqueToken,
  safeEqual,
  tokenHash,
  totp,
} from '../../apps/api/src/crypto.js';
import { readConfig, readWorkerConfig, trustedProxies } from '../../apps/api/src/config.js';
test('canonical operation payloads ignore object key order but preserve quantity', () => {
  assert.equal(
    canonicalJson({ qty: 2, reference: { b: 1, a: 2 } }),
    canonicalJson({ reference: { a: 2, b: 1 }, qty: 2 }),
  );
  assert.notEqual(canonicalJson({ qty: 2 }), canonicalJson({ qty: 3 }));
});
test('RFC6238 SHA1 TOTP vector and one-time token primitives', () => {
  assert.equal(totp('3132333435363738393031323334353637383930', 1), '287082');
  const a = opaqueToken(),
    b = opaqueToken();
  assert.notEqual(a, b);
  assert.equal(tokenHash(a).length, 64);
  assert.ok(safeEqual('123456', '123456'));
  assert.ok(!safeEqual('123456', '12345'));
  assert.notEqual(keyedHash('code', 'a'), keyedHash('code', 'b'));
});
test('deployment fails closed with local authentication or insecure cookies', () => {
  const base = {
    DATABASE_URL: 'postgresql://runtime@localhost/nuqta_test',
    AUTH_DATABASE_URL: 'postgresql://auth@localhost/nuqta_test',
    AUTH_PEPPER: 'test-pepper-at-least-thirty-two-characters',
    STORAGE_ROOT: resolve(tmpdir(), 'nuqta-production-config-fixture'),
    MAIL_TRANSPORT: 'smtp' as const,
    SMTP_HOST: 'localhost',
    SMTP_PORT: 587,
    SMTP_USER: 'test',
    SMTP_PASS: 'test-only',
    SMTP_FROM: 'test@nuqta.test',
  };
  assert.throws(
    () => readConfig({ ...base, APP_ENV: 'production', AUTH_PROVIDER: 'local' }),
    /Local authentication is forbidden/,
  );
  assert.throws(
    () =>
      readConfig({
        ...base,
        APP_ENV: 'production',
        AUTH_PROVIDER: 'password',
        COOKIE_SECURE: 'false',
      }),
    /HTTPS/,
  );
  assert.throws(() => readConfig({ ...base, HOST: '0.0.0.0', AUTH_PROVIDER: 'local' }), /loopback/);
  const production = {
    ...base,
    APP_ENV: 'production' as const,
    AUTH_PROVIDER: 'password' as const,
    COOKIE_SECURE: 'true' as const,
    PUBLIC_APP_ORIGIN: 'https://nuqta.example.test',
  };
  assert.throws(() => readConfig({ ...production, MAIL_TRANSPORT: 'file' }), /file mail sink/);
  assert.throws(() => readConfig({ ...production, SMTP_HOST: '' }), /SMTP_HOST/);
  assert.throws(() => readConfig({ ...production, STORAGE_ROOT: '.local' }), /STORAGE_ROOT/);
  assert.throws(
    () => readConfig({ ...production, STORAGE_ROOT: resolve('private-files') }),
    /outside/,
  );
  assert.throws(
    () => readConfig({ ...production, SMTP_STARTTLS: 'false', SMTP_SECURE: 'false' }),
    /TLS/,
  );
  assert.equal(
    readConfig({
      ...base,
      APP_ENV: 'production',
      AUTH_PROVIDER: 'password',
      COOKIE_SECURE: 'true',
      PUBLIC_APP_ORIGIN: 'https://nuqta.example.test',
    }).AUTH_PROVIDER,
    'password',
  );
  assert.throws(
    () =>
      readConfig({
        ...base,
        APP_ENV: 'production',
        AUTH_PROVIDER: 'password',
        COOKIE_SECURE: 'true',
        PUBLIC_APP_ORIGIN: 'https://nuqta.example.test',
        AUTH_DATABASE_URL: base.DATABASE_URL,
      }),
    /separate/,
  );
});

test('proxy configuration denies global trust, and worker config needs no other database credentials', () => {
  assert.deepEqual(trustedProxies(''), []);
  assert.deepEqual(trustedProxies('192.0.2.2/32, 2001:db8::1/128'), [
    '192.0.2.2/32',
    '2001:db8::1/128',
  ]);
  for (const value of [
    'true',
    '*',
    '0.0.0.0/0',
    '::/0',
    '192.0.2.1',
    '192.0.2.1/33',
    '2001:db8::/129',
    '192.0.2.1/32,',
  ])
    assert.throws(() => trustedProxies(value));
  const worker = readWorkerConfig(
    {},
    {
      APP_ENV: 'test',
      AUTH_PROVIDER: 'local',
      AUTH_PEPPER: 'test-pepper-at-least-thirty-two-characters',
      WORKER_DATABASE_URL: 'postgresql://worker@127.0.0.1/test',
    },
  );
  assert.equal('DATABASE_URL' in worker, false);
  assert.equal('AUTH_DATABASE_URL' in worker, false);
  assert.equal('DATABASE_MIGRATOR_URL' in worker, false);
  assert.throws(() =>
    readWorkerConfig(
      {},
      { APP_ENV: 'test', AUTH_PEPPER: 'test-pepper-at-least-thirty-two-characters' },
    ),
  );
});
