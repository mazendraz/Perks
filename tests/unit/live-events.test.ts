import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { subscribeLiveRefresh } from '../../apps/web/src/live-events.js';

test('device recovery replaces the shared stale stream immediately, ignores its late errors, and cleans up every listener', async () => {
  class Stream extends EventTarget {
    static all: Stream[] = [];
    closed = false;
    constructor(public url: string) {
      super();
      Stream.all.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  const documentTarget = Object.assign(new EventTarget(), { hidden: false });
  const windowTarget = Object.assign(new EventTarget(), {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
  const names = ['window', 'document', 'EventSource'] as const;
  const original = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperties(globalThis, {
    window: { value: windowTarget, configurable: true },
    document: { value: documentTarget, configurable: true },
    EventSource: { value: Stream, configurable: true },
  });
  let stopFirst = () => {},
    stopSecond = () => {};
  try {
    let first = 0,
      second = 0;
    stopFirst = subscribeLiveRefresh('/api/v1/me/events?__portal=customer', () => {
      first++;
    });
    stopSecond = subscribeLiveRefresh('/api/v1/me/events?__portal=customer', () => {
      second++;
    });
    assert.equal(Stream.all.length, 1, 'one shared connection');
    const old = Stream.all[0]!;
    old.dispatchEvent(new Event('open'));
    windowTarget.dispatchEvent(new Event('nuqta:customer-session-restored'));
    assert.equal(old.closed, true);
    assert.equal(Stream.all.length, 2, 'no wait for a 25-second heartbeat or 3-second polling');
    const fresh = Stream.all[1]!;
    fresh.dispatchEvent(new Event('open'));
    old.dispatchEvent(new Event('error'));
    assert.equal(fresh.closed, false, 'late old-stream events cannot close the new stream');
    fresh.dispatchEvent(new Event('activity'));
    await delay(110);
    assert.equal(first, 1);
    assert.equal(second, 1);
    stopFirst();
    assert.equal(fresh.closed, false, 'remaining consumer keeps the shared connection');
    stopSecond();
    assert.equal(fresh.closed, true);
    windowTarget.dispatchEvent(new Event('nuqta:customer-session-restored'));
    assert.equal(Stream.all.length, 2, 'unmounted channels never reopen');
  } finally {
    stopFirst();
    stopSecond();
    names.forEach((name, i) => {
      const descriptor = original[i];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});
