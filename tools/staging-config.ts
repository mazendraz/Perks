import { randomBytes } from 'node:crypto';
export function stagingReviewEnvironment() {
  const values: Record<string, string> = {
    APP_ENV: 'staging',
    DOMAIN: 'staging.nuqta.invalid',
    PUBLIC_APP_ORIGIN: 'https://staging.nuqta.invalid',
    SMTP_HOST: 'owner-required.invalid',
    SMTP_PORT: '587',
    SMTP_USER: 'owner-required',
    SMTP_PASS: randomBytes(32).toString('hex'),
    SMTP_FROM: 'synthetic@nuqta.invalid',
    SMTP_SECURE: 'false',
    SMTP_STARTTLS: 'true',
    OWNER_READY: 'false',
  };
  for (const key of [
    'AUTH_PEPPER',
    'MONITORING_TOKEN',
    'NUQTA_POSTGRES_DB_PASSWORD',
    'NUQTA_MIGRATOR_DB_PASSWORD',
    'NUQTA_RUNTIME_DB_PASSWORD',
    'NUQTA_AUTH_DB_PASSWORD',
    'NUQTA_WORKER_DB_PASSWORD',
    'PGBACKREST_REPO1_CIPHER_PASS',
    'RESTIC_PASSWORD',
  ])
    values[key] = randomBytes(32).toString('hex');
  return values;
}
export function stagingEnvironmentText(values: Record<string, string>) {
  return (
    '# REVIEW ONLY: configure owner-approved host/DNS/SMTP before deployment.\n' +
    Object.entries(values)
      .map(([k, v]) => k + '=' + v)
      .join('\n') +
    '\n'
  );
}
