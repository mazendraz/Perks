import { readConfig } from '../apps/api/src/config.js';
import { readFile, stat } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function productionEnvironment(values: NodeJS.ProcessEnv) {
  if (!['production', 'staging'].includes(values.APP_ENV || '')) throw new Error('APP_ENV');
  const domain = values.DOMAIN || '';
  if (
    !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) ||
    !domain.includes('.') ||
    domain.endsWith('.invalid') ||
    values.PUBLIC_APP_ORIGIN !== 'https://' + domain
  )
    throw new Error('DOMAIN/PUBLIC_APP_ORIGIN');
  const names = [
    'AUTH_PEPPER',
    'NUQTA_POSTGRES_DB_PASSWORD',
    'NUQTA_MIGRATOR_DB_PASSWORD',
    'NUQTA_RUNTIME_DB_PASSWORD',
    'NUQTA_AUTH_DB_PASSWORD',
    'NUQTA_WORKER_DB_PASSWORD',
    'PGBACKREST_REPO1_CIPHER_PASS',
    'RESTIC_PASSWORD',
  ];
  const secrets = names.map((name) => values[name]);
  if (
    secrets.some((value) => !value || !/^[a-f0-9]{64}$/.test(value)) ||
    new Set(secrets).size !== secrets.length
  )
    throw new Error('Private generated secrets must be distinct 64-character hex values.');
  return readConfig(
    {},
    {
      ...values,
      AUTH_PROVIDER: 'password',
      COOKIE_SECURE: 'true',
      HOST: '0.0.0.0',
      STORAGE_ROOT: '/var/lib/nuqta/files',
      MAIL_TRANSPORT: 'smtp',
      SMTP_STARTTLS: 'true',
      DATABASE_URL:
        'postgresql://nuqta_runtime:' + values.NUQTA_RUNTIME_DB_PASSWORD + '@postgres:5432/nuqta',
      AUTH_DATABASE_URL:
        'postgresql://nuqta_auth:' + values.NUQTA_AUTH_DB_PASSWORD + '@postgres:5432/nuqta',
      WORKER_DATABASE_URL:
        'postgresql://nuqta_worker:' + values.NUQTA_WORKER_DB_PASSWORD + '@postgres:5432/nuqta',
      DATABASE_MIGRATOR_URL:
        'postgresql://nuqta_migrator:' + values.NUQTA_MIGRATOR_DB_PASSWORD + '@postgres:5432/nuqta',
    },
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let c;
    if (process.argv[2] === '--production') {
      const path = resolve(process.argv[3] || 'deploy/.env.production'),
        info = await stat(path);
      if (process.platform !== 'win32' && info.mode & 0o077)
        throw new Error('Production environment file must be private (0600).');
      c = productionEnvironment(parseEnv(await readFile(path, 'utf8')));
    } else c = readConfig();
    console.log(
      JSON.stringify({
        environment: c.APP_ENV,
        authProvider: c.AUTH_PROVIDER,
        configValid: true,
        secretsPrinted: false,
      }),
    );
  } catch {
    console.error(
      'Configuration invalid. Check required fields, domain/origin, distinct generated secrets, private file permissions and SMTP TLS. No values printed.',
    );
    process.exitCode = 1;
  }
}
