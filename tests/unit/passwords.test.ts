import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../../apps/api/src/passwords.js';
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
