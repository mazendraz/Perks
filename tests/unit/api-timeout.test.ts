import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../../apps/web/src/api.js';

test('a bounded card read aborts its transport and reports a retryable timeout without replaying it', async () => {
  const names = ['fetch', 'document', 'location'] as const;
  const saved = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  let attempts = 0,
    aborted = false;
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: { documentElement: { lang: 'ar' } } },
    location: { configurable: true, value: { pathname: '/customer' } },
    fetch: {
      configurable: true,
      value: (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          attempts++;
          assert.equal(options.method, 'GET');
          assert.equal(options.credentials, 'same-origin');
          options.signal!.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    },
  });
  try {
    await assert.rejects(
      api('/me/memberships', { timeoutMs: 15 }),
      (error) =>
        error instanceof ApiError && error.code === 'REQUEST_TIMEOUT' && error.status === 0,
    );
    assert.equal(attempts, 1);
    assert.equal(aborted, true);
  } finally {
    names.forEach((name, i) => {
      if (saved[i]) Object.defineProperty(globalThis, name, saved[i]!);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});
