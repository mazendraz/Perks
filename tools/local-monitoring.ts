import { startKuma, stopKuma } from './kuma-runtime.js';
import { setTimeout as delay } from 'node:timers/promises';
const origin = 'http://127.0.0.1:4301';
const child = await startKuma('.local/monitoring-console', 4301);
let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  if (child.exitCode !== null) break;
  try {
    ready = (await fetch(origin)).ok;
  } catch {
    /* The new SQLite schema may still be migrating. */
  }
  if (ready) break;
  await delay(500);
}
if (!ready) {
  await stopKuma(child);
  throw new Error('Local dashboard did not start; inspect.local/monitoring-console/runtime.log.');
}
console.log('Local operations dashboard: ' + origin + ' (loopback only).');
console.log(
  'Choose the local operator username/password in its setup screen; existing accounts and monitors are retained.',
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void stopKuma(child);
  });
child.once('exit', (code) => {
  process.exitCode = code ?? 0;
});
