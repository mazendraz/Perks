import assert from 'node:assert/strict';
import test from 'node:test';
import { transferMatchesOrder } from '../../packages/domain/src/onboarding-payment.js';

test('only a settled incoming transfer for the order amount, currency and recipient matches', () => {
  const order = { amountMinor: 150000, currency: 'EGP', recipientAccountId: 'primary' };
  const transfer = {
    ...order,
    reference: ' ABC123 ',
    direction: 'incoming',
    status: 'settled',
  };
  assert.equal(transferMatchesOrder(order, transfer), true);
  for (const mismatch of [
    { amountMinor: 149999 },
    { currency: 'USD' },
    { recipientAccountId: 'another' },
    { reference: '   ' },
    { direction: 'outgoing' },
    { status: 'pending' },
  ]) {
    assert.equal(transferMatchesOrder(order, { ...transfer, ...mismatch }), false);
  }
});
