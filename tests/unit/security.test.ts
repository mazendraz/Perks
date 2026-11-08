import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalJson,
  keyedHash,
  opaqueToken,
  safeEqual,
  tokenHash,
  totp,
} from '../../apps/api/src/crypto.js';
import { readConfig } from '../../apps/api/src/config.js';
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
        AUTH_PROVIDER: 'supabase',
        COOKIE_SECURE: 'false',
      }),
    /HTTPS/,
  );
  assert.throws(() => readConfig({ ...base, HOST: '0.0.0.0', AUTH_PROVIDER: 'local' }), /loopback/);
});
