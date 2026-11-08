import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPasswordPolicy,
  hashPassword,
  verifyPassword,
} from '../../apps/api/src/passwords.js';
import { commonPasswords } from '../../apps/api/src/data/common-passwords.js';
import { base32, sealMfa, openMfa } from '../../apps/api/src/mfa.js';

test('new passwords use a local 10k denylist and a 10-character minimum without changing existing password verification', () => {
  assert.equal(commonPasswords.length, 10000);
  assert.throws(() => assertPasswordPolicy('123456789'), /PASSWORD_LENGTH/);
  for (const password of ['1234567890', 'qwertyuiop', 'QWERTYUIOP'])
    assert.throws(() => assertPasswordPolicy(password), /PASSWORD_TOO_COMMON/);
  assert.doesNotThrow(() => assertPasswordPolicy('An easy phrase I can remember'));
  assert.doesNotThrow(() => assertPasswordPolicy('mF7V!kA2xQ'));
});
test('authenticator secrets use standard base32 and authenticated encryption', () => {
  const secret = '3132333435363738393031323334353637383930';
  assert.equal(base32(secret), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  const sealed = sealMfa(secret, 'private-test-pepper');
  assert.ok(!sealed.includes(secret));
  assert.equal(openMfa(sealed, 'private-test-pepper'), secret);
  assert.throws(() => openMfa(sealed, 'different-pepper'));
  assert.throws(() =>
    openMfa(sealed.slice(0, -2) + (sealed.endsWith('00') ? '01' : '00'), 'private-test-pepper'),
  );
});
test('salted scrypt credentials preserve Unicode passwords, use the pepper and reject malformed/unknown hashes', async () => {
  const pw = 'كلمة مرور طويلة وسهلة أفتكرها',
    pepper = 'private fixture pepper',
    a = await hashPassword(pw, pepper),
    b = await hashPassword(pw, pepper);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword(pw, a, pepper), true);
  assert.equal(await verifyPassword(pw, a, 'wrong pepper'), false);
  assert.equal(await verifyPassword('wrong', a, pepper), false);
  assert.equal(await verifyPassword(pw, null, pepper), false);
  assert.equal(await verifyPassword(pw, 'scrypt$malformed', pepper), false);
});
