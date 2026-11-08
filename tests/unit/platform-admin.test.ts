import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  platformAdminInput,
  platformAdminCommand,
} from '../../packages/contracts/src/platform-admin.js';
test('admin account creation requires explicit full-access acknowledgement and cannot accept an existing identity or arbitrary role', () => {
  const body = {
    name: 'Platform colleague',
    email: 'Colleague@Example.test',
    password: 'A long test password',
    reason: 'Share platform support.',
    acknowledgeFullAccess: true,
  };
  assert.equal(platformAdminInput.parse(body).email, 'colleague@example.test');
  assert.equal(
    platformAdminInput.safeParse({ ...body, acknowledgeFullAccess: false }).success,
    false,
  );
  assert.equal(platformAdminInput.safeParse({ ...body, role: 'platform_admin' }).success, false);
  assert.equal(
    platformAdminInput.safeParse({ ...body, userId: '00000000-0000-4000-8000-000000000001' })
      .success,
    false,
  );
});
test('admin security commands are version fenced and keep passwords exclusive to the password action', () => {
  const base = {
    reason: 'Authorized account maintenance.',
    credentialVersion: 2,
    acknowledgeFullAccess: true,
  };
  assert.equal(
    platformAdminCommand.safeParse({
      ...base,
      action: 'sessions',
      password: 'A long test password',
    }).success,
    false,
  );
  assert.equal(platformAdminCommand.safeParse({ ...base, action: 'password' }).success, false);
  assert.equal(
    platformAdminCommand.safeParse({ ...base, action: 'disable', credentialVersion: -1 }).success,
    false,
  );
  assert.equal(
    platformAdminCommand.safeParse({
      ...base,
      action: 'password',
      password: 'A long test password',
    }).success,
    true,
  );
});
