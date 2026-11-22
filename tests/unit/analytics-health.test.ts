import { test } from 'node:test';
import assert from 'node:assert/strict';
import { healthScore, healthTargets, sectionsFor } from '../../packages/contracts/src/analytics.js';
import { segmentMessages, audienceFor } from '../../packages/contracts/src/analytics-messages.js';

test('health: weights add to 100, targets cap each part, and the weakest is the furthest from its target', () => {
  assert.equal(
    Object.values(healthTargets).reduce((n, t) => n + t.weight, 0),
    100,
  );
  assert.equal(
    healthScore({ return: 100, second_visit: 100, completion: 100, redemption: 100, active: 100 })
      .score,
    100,
  );
  const h = healthScore({
    return: 25,
    second_visit: 50,
    completion: 25,
    redemption: 80,
    active: 50,
  });
  assert.equal(h.score, 85);
  assert.equal(h.weakest, 'return');
  assert.equal(
    healthScore({ return: 0, second_visit: 0, completion: 0, redemption: 0, active: 0 }).score,
    0,
  );
});

test('every analytics section is open on every plan for now', () => {
  for (const level of ['basic', 'branches', 'advanced', undefined])
    assert.ok(Object.values(sectionsFor(level)).every(Boolean));
});

test('every "what to do today" card has a ready message', () => {
  for (const key of ['at_risk', 'near_reward', 'one_time', 'reward_holder'] as const) {
    const audience = audienceFor(key)!;
    assert.ok(segmentMessages[audience], key);
    assert.ok(segmentMessages[audience]!.ar.length <= 150);
  }
  assert.equal(audienceFor('never'), null);
});
