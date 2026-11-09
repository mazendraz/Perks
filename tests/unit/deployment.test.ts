import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionEnvironment } from '../../tools/env-check.js';
const configuration = () => ({
  APP_ENV: 'production',
  DOMAIN: 'app.nuqta.test',
  PUBLIC_APP_ORIGIN: 'https://app.nuqta.test',
  AUTH_PEPPER: '1'.repeat(64),
  NUQTA_POSTGRES_DB_PASSWORD: '2'.repeat(64),
  NUQTA_MIGRATOR_DB_PASSWORD: '3'.repeat(64),
  NUQTA_RUNTIME_DB_PASSWORD: '4'.repeat(64),
  NUQTA_AUTH_DB_PASSWORD: '5'.repeat(64),
  NUQTA_WORKER_DB_PASSWORD: '6'.repeat(64),
  PGBACKREST_REPO1_CIPHER_PASS: '7'.repeat(64),
  RESTIC_PASSWORD: '8'.repeat(64),
  SMTP_HOST: 'smtp.nuqta.test',
  SMTP_PORT: '587',
  SMTP_USER: 'synthetic-user',
  SMTP_PASS: 'synthetic-only',
  SMTP_FROM: 'fixture@nuqta.test',
});
test('production env preflight validates independent secrets and does not inherit missing SMTP from development', () => {
  const valid = configuration(),
    c = productionEnvironment(valid);
  assert.equal(c.AUTH_PROVIDER, 'password');
  assert.equal(c.COOKIE_SECURE, 'true');
  for (const patch of [
    { NUQTA_WORKER_DB_PASSWORD: valid.NUQTA_RUNTIME_DB_PASSWORD },
    { NUQTA_AUTH_DB_PASSWORD: 'short' },
    { DOMAIN: 'nuqta.invalid', PUBLIC_APP_ORIGIN: 'https://nuqta.invalid' },
    { PUBLIC_APP_ORIGIN: 'http://app.nuqta.test' },
    { SMTP_HOST: '' },
    { SMTP_PASS: '' },
  ])
    assert.throws(() => productionEnvironment({ ...valid, ...patch }));
});
