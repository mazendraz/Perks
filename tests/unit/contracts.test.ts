import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../apps/api/src/server.js';
import { awardInput } from '../../packages/contracts/src/commands.js';

test('command quantities are strict integers and never coerce strings or truncate fractions', () => {
  const body = {
    branchId: '20000000-0000-4000-8000-000000000001',
    membershipId: '20000000-0000-4000-8000-000000000002',
    quantity: 1,
    purchaseReference: { reference: 'TEST', businessDate: '2026-11-07' },
    presentationContext: 'test',
  };
  assert.equal(awardInput.safeParse(body).success, true);
  for (const quantity of ['1', 1.1, 0, 101, true, null])
    assert.equal(awardInput.safeParse({ ...body, quantity }).success, false);
});
test('OpenAPI describes the actual shared commands, field errors and concurrency requirements', async () => {
  const { app } = await buildApp({ LOG_LEVEL: 'silent' });
  try {
    await app.ready();
    const spec = app.swagger();
    // Serialize through the same representation delivered to API consumers.
    const paths = JSON.parse(JSON.stringify(spec)).paths;
    const award = paths['/api/v1/merchants/{m}/stamp-awards'].post;
    assert.equal(
      award.requestBody.content['application/json'].schema.properties.quantity.type,
      'integer',
    );
    assert.equal(award.requestBody.content['application/json'].schema.additionalProperties, false);
    assert.ok(
      award.parameters.some(
        (p: { name: string; required: boolean }) => p.name === 'Idempotency-Key' && p.required,
      ),
    );
    assert.ok(
      award.parameters.some(
        (p: { name: string; required: boolean }) => p.name === 'x-csrf-token' && p.required,
      ),
    );
    assert.ok(
      award.responses['422'].content['application/json'].schema.properties.error.properties.fields,
    );
    assert.ok(
      paths['/api/v1/platform/provisioning-drafts/{id}'].patch.parameters.some(
        (p: { name: string }) => p.name === 'If-Match',
      ),
    );
    assert.ok(
      paths['/api/v1/merchants/{m}/redemption-challenges/{id}/complete'].post.responses['200']
        .content['application/json'].schema.properties.cycleNumber,
    );
    assert.deepEqual(paths['/api/v1/auth/password/change'].post.security, [{ session: [] }]);
    const payment = paths['/api/v1/platform/merchants/{m}/subscription/payments'].post;
    assert.equal(
      payment.requestBody.content['application/json'].schema.properties.amountMinor.type,
      'integer',
    );
    assert.ok(
      payment.parameters.some(
        (p: { name: string; required: boolean }) => p.name === 'If-Match' && p.required,
      ),
    );
    assert.ok(
      paths['/api/v1/customer/register'].post.requestBody.content[
        'application/json'
      ].schema.required.includes('acceptedPrivacyHash'),
    );
    assert.deepEqual(paths['/api/v1/public/legal'].get.security, []);
  } finally {
    await app.close();
  }
});
