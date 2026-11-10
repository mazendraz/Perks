import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RefreshQueue } from '../../apps/web/src/refresh-queue.js';

test('slow live reads publish their first result and coalesce a burst into one latest follow-up', async () => {
  const queue = new RefreshQueue(),
    reads: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = queue.run(async () => {
    await gate;
    reads.push('first result');
  });
  const next = queue.run(async () => {
    reads.push('superseded follow-up');
  });
  const latest = queue.run(async () => {
    reads.push('latest follow-up');
  });
  assert.equal(next, first);
  assert.equal(latest, first);
  release();
  await first;
  assert.deepEqual(reads, ['first result', 'latest follow-up']);
});

test('route invalidation retires queued reads without clearing a newer route or replaying old work', async () => {
  const queue = new RefreshQueue(),
    reads: string[] = [];
  let release!: () => void, finishNew!: () => void;
  const oldGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const newGate = new Promise<void>((resolve) => {
    finishNew = resolve;
  });
  const old = queue.run(async () => {
    await oldGate;
    reads.push('old complete');
  });
  void queue.run(async () => {
    reads.push('old queued');
  });
  queue.invalidate();
  const fresh = queue.run(async () => {
    await newGate;
    reads.push('new complete');
  });
  release();
  await old;
  assert.equal(
    queue.run(async () => {
      reads.push('new queued');
    }),
    fresh,
  );
  finishNew();
  await fresh;
  assert.deepEqual(reads, ['old complete', 'new complete', 'new queued']);
  await assert.rejects(
    queue.run(async () => {
      throw Error('read failed');
    }),
    /read failed/,
  );
  await queue.run(async () => {
    reads.push('retry');
  });
  assert.equal(reads.at(-1), 'retry');
});
