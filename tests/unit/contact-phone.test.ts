import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contactPhone,
  staffSecurityCommand,
} from '../../packages/contracts/src/account-management.js';
test('contact numbers normalize supported local/international input and reject executable, ambiguous and overlong destinations', () => {
  for (const input of ['01012345678', '+20 (10) 1234-5678', '00201012345678'])
    assert.equal(contactPhone.parse(input), '+201012345678');
  assert.equal(contactPhone.parse(' +1 555 555 0101 '), '+15555550101');
  assert.equal(contactPhone.parse(''), '');
  for (const input of [
    'javascript:alert(1)',
    '<svg/>',
    '+0123456789',
    '15555550101',
    '+1234567890123456',
  ])
    assert.equal(contactPhone.safeParse(input).success, false);
});
test('staff security commands require account-wide acknowledgement and reject a password in non-password actions', () => {
  const body = {
    action: 'sessions',
    credentialVersion: 1,
    reason: 'Revoke old sessions',
    acknowledgeAccountWide: true,
  };
  assert.equal(staffSecurityCommand.safeParse(body).success, true);
  assert.equal(
    staffSecurityCommand.safeParse({ ...body, acknowledgeAccountWide: false }).success,
    false,
  );
  assert.equal(
    staffSecurityCommand.safeParse({ ...body, password: 'Do-not-store-this-password' }).success,
    false,
  );
});
