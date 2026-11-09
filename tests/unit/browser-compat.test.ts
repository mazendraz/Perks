import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secureUUID } from '../../apps/web/src/compat.js';
test('old-browser UUID fallback keeps v4 version/variant and secure random uniqueness, and fails closed without crypto', () => {
  const ids = new Set(Array.from({ length: 100 }, () => secureUUID()));
  assert.equal(ids.size, 100);
  for (const id of ids)
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.throws(() => secureUUID({} as Crypto), /Secure randomness/);
});
