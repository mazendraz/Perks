import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, parse, sep } from 'node:path';
import { z } from 'zod';
import { isIP } from 'node:net';
if (existsSync('.env')) process.loadEnvFile('.env');
const schema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().default(4100),
  PUBLIC_APP_ORIGIN: z.url().default('http://127.0.0.1:5173'),
  DATABASE_URL: z.string().min(1),
  AUTH_DATABASE_URL: z.string().min(1),
  DATABASE_MIGRATOR_URL: z.string().optional(),
  WORKER_DATABASE_URL: z.string().optional(),
  AUTH_PROVIDER: z.enum(['local', 'password']).default('local'),
  AUTH_PEPPER: z.string().min(32),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  MAIL_TRANSPORT: z.enum(['file', 'smtp']).default('file'),
  MAIL_FILE_ROOT: z.string().min(1).default('.local/mail'),
  STORAGE_ROOT: z.string().min(1).default('.local'),
  TRUSTED_PROXIES: z.string().default(''),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.union([z.email(), z.literal('')]).optional(),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_STARTTLS: z.enum(['true', 'false']).default('true'),
  SMTP_CA_FILE: z.string().optional(),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug']).default('info'),
  MONITORING_TOKEN: z.union([z.string().min(32), z.literal('')]).default(''),
  BACKUP_STATUS_ROOT: z.string().default(''),
  APPLE_WALLET_ENABLED: z.enum(['true', 'false']).default('false'),
  APPLE_PASS_TYPE_ID: z
    .string()
    .regex(/^pass\.[A-Za-z0-9.-]+$/)
    .optional(),
  APPLE_TEAM_ID: z
    .string()
    .regex(/^[A-Z0-9]{10}$/)
    .optional(),
  APPLE_PASS_CERT_FILE: z.string().optional(),
  APPLE_PASS_KEY_FILE: z.string().optional(),
  APPLE_PASS_KEY_PASSPHRASE: z.string().optional(),
  APPLE_WWDR_CERT_FILE: z.string().optional(),
  APPLE_APNS_ORIGIN: z.url().default('https://api.push.apple.com'),
  GOOGLE_WALLET_ENABLED: z.enum(['true', 'false']).default('false'),
  GOOGLE_WALLET_ISSUER_ID: z
    .string()
    .regex(/^\d{10,25}$/)
    .optional(),
  GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: z.string().optional(),
});
export type Config = z.infer<typeof schema>;
type DatabaseKeys =
  'DATABASE_URL' | 'AUTH_DATABASE_URL' | 'DATABASE_MIGRATOR_URL' | 'WORKER_DATABASE_URL';
export type ServiceConfig = Omit<Config, DatabaseKeys>;
const workerSchema = schema
  .omit({ DATABASE_URL: true, AUTH_DATABASE_URL: true, DATABASE_MIGRATOR_URL: true })
  .extend({ WORKER_DATABASE_URL: z.string().min(1) });
export type WorkerConfig = z.infer<typeof workerSchema>;
export function trustedProxies(value: string): string[] {
  if (!value.trim()) return [];
  return value.split(',').map((entry) => {
    const cidr = entry.trim(),
      parts = cidr.split('/'),
      version = isIP(parts[0] || '');
    if (
      !version ||
      parts.length !== 2 ||
      !/^\d+$/.test(parts[1]!) ||
      Number(parts[1]) < 1 ||
      Number(parts[1]) > (version === 4 ? 32 : 128)
    )
      throw new Error('TRUSTED_PROXIES requires explicit IP CIDRs; global trust is forbidden.');
    return cidr;
  });
}
export function readConfig(
  overrides: Partial<Config> = {},
  environment: NodeJS.ProcessEnv = process.env,
): Config {
  const c = schema.parse({ ...environment, ...overrides });
  validateConfig(c);
  return c;
}
export function readWorkerConfig(
  overrides: Partial<WorkerConfig> = {},
  environment: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  const c = workerSchema.parse({ ...environment, ...overrides });
  validateConfig(c);
  return c;
}
export function readMigrationConfig() {
  return schema
    .pick({ APP_ENV: true })
    .extend({ DATABASE_MIGRATOR_URL: z.url() })
    .parse(process.env);
}
function validateConfig(c: ServiceConfig & Partial<Pick<Config, DatabaseKeys>>) {
  trustedProxies(c.TRUSTED_PROXIES);
  if (
    c.GOOGLE_WALLET_ENABLED === 'true' &&
    (!c.GOOGLE_WALLET_ISSUER_ID || !c.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE)
  )
    throw new Error(
      'Google Wallet requires GOOGLE_WALLET_ISSUER_ID and GOOGLE_WALLET_SERVICE_ACCOUNT_FILE.',
    );
  if (c.APPLE_WALLET_ENABLED === 'true') {
    if (
      !c.APPLE_PASS_TYPE_ID ||
      !c.APPLE_TEAM_ID ||
      !c.APPLE_PASS_CERT_FILE ||
      !c.APPLE_PASS_KEY_FILE ||
      !c.APPLE_WWDR_CERT_FILE
    )
      throw new Error(
        'Apple Wallet requires APPLE_PASS_TYPE_ID, APPLE_TEAM_ID and the pass certificate, key and WWDR files.',
      );
    if (deployed(c) && !c.PUBLIC_APP_ORIGIN.startsWith('https://'))
      throw new Error('Apple Wallet updates require an HTTPS PUBLIC_APP_ORIGIN.');
  }
  if (c.MONITORING_TOKEN && c.MONITORING_TOKEN === c.AUTH_PEPPER)
    throw new Error('Monitoring token must be independent of authentication secrets.');
  if (deployed(c) && c.BACKUP_STATUS_ROOT && !isAbsolute(c.BACKUP_STATUS_ROOT))
    throw new Error('BACKUP_STATUS_ROOT must be absolute when deployed.');
  if (c.APP_ENV === 'production' || c.APP_ENV === 'staging') {
    if (c.AUTH_PROVIDER === 'local')
      throw new Error('Local authentication is forbidden outside development/test.');
    if (c.COOKIE_SECURE !== 'true' || !c.PUBLIC_APP_ORIGIN.startsWith('https://'))
      throw new Error('Deployed environments require HTTPS and secure cookies.');
    const roles = [
      c.DATABASE_URL,
      c.AUTH_DATABASE_URL,
      c.WORKER_DATABASE_URL,
      c.DATABASE_MIGRATOR_URL,
    ]
      .filter((url): url is string => !!url)
      .map((url) => new URL(url).username);
    if (roles.some((role) => !role) || new Set(roles).size !== roles.length)
      throw new Error('Runtime, auth, worker and migration database roles must be separate.');
  }
  if (c.AUTH_PROVIDER === 'local' && !['127.0.0.1', 'localhost', '::1'].includes(c.HOST))
    throw new Error('Local authentication must bind to loopback.');
  if (deployed(c) && c.MAIL_TRANSPORT !== 'smtp')
    throw new Error('Deployed environments require SMTP; the file mail sink is local only.');
  if (c.MAIL_TRANSPORT === 'smtp') {
    if (!c.SMTP_HOST || !c.SMTP_PORT || !c.SMTP_USER || !c.SMTP_PASS || !c.SMTP_FROM)
      throw new Error('SMTP_HOST, PORT, USER, PASS and FROM are required for SMTP.');
    if (
      c.SMTP_SECURE !== 'true' &&
      c.SMTP_PORT !== 465 &&
      c.SMTP_STARTTLS !== 'true' &&
      (deployed(c) || !['localhost', '127.0.0.1', '::1'].includes(c.SMTP_HOST))
    )
      throw new Error('SMTP requires TLS except for a loopback development/test server.');
  }
  if (deployed(c)) {
    const root = resolve(c.STORAGE_ROOT),
      pathFromCode = relative(process.cwd(), root);
    if (
      !isAbsolute(c.STORAGE_ROOT) ||
      root === parse(root).root ||
      !(pathFromCode === '..' || pathFromCode.startsWith('..' + sep) || isAbsolute(pathFromCode))
    )
      throw new Error(
        'STORAGE_ROOT must be a dedicated absolute directory outside the application code.',
      );
  }
}
export const passwordEnabled = (c: Config) =>
  c.AUTH_PROVIDER === 'password' ||
  (c.AUTH_PROVIDER === 'local' && ['development', 'test'].includes(c.APP_ENV));
export const deployed = (c: Pick<Config, 'APP_ENV'>) =>
  ['staging', 'production'].includes(c.APP_ENV);
