import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpMetrics, operationalHealth } from '../../packages/domain/src/monitoring.js';
test('HTTP metrics retain bounded rolling counts and a conservative p95, omit stream timings, and expire the window without losing totals', () => {
  const metrics = new HttpMetrics(),
    now = 1800000000000;
  assert.equal(metrics.snapshot(now).window.p95Ms, null);
  for (let i = 0; i < 100; i++) metrics.observe(i === 0 ? 503 : 200, i < 95 ? 42 : 1200, now);
  metrics.observe(200, null, now);
  const value = metrics.snapshot(now);
  assert.equal(value.window.requests, 101);
  assert.equal(value.window.errors, 1);
  assert.equal(value.window.timedRequests, 100);
  assert.equal(value.window.p95Ms, 50);
  assert.equal(value.window.p95Above60000ms, false);
  assert.equal(metrics.snapshot(now + 300000).window.requests, 0);
  assert.equal(metrics.snapshot(now + 300000).total.requests, 101);
  metrics.observe(500, 65000, now + 300000);
  assert.equal(metrics.snapshot(now + 300000).window.p95Ms, null);
  assert.equal(metrics.snapshot(now + 300000).window.p95Above60000ms, true);
});
test('health thresholds distinguish above1percent, above80percent and above15minutes, and fail closed on missing probes', () => {
  const base = {
    errorRatio: 0.01,
    diskUsedRatio: 0.8,
    databaseHealthy: true,
    oldestPendingAgeMs: 15 * 60000,
    backupsHealthy: true,
  };
  assert.equal(operationalHealth(base).healthy, true);
  const bad = operationalHealth({
    ...base,
    errorRatio: 0.0101,
    diskUsedRatio: 0.80001,
    databaseHealthy: false,
    oldestPendingAgeMs: 15 * 60000 + 1,
    backupsHealthy: false,
  });
  assert.deepEqual(bad.reasons, [
    'database_unavailable',
    'http_5xx_above_1_percent',
    'disk_above_80_percent',
    'outbox_older_than_15m',
    'backup_unhealthy',
  ]);
  assert.ok(
    operationalHealth({ ...base, diskUsedRatio: null }).reasons.includes('disk_unavailable'),
  );
});
