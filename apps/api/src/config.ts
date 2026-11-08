import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, parse, sep } from 'node:path';
import { z } from 'zod';
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
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.union([z.email(), z.literal('')]).optional(),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_STARTTLS: z.enum(['true', 'false']).default('true'),
  SMTP_CA_FILE: z.string().optional(),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug']).default('info'),
});
export type Config = z.infer<typeof schema>;
export function readConfig(overrides: Partial<Config> = {}): Config {
  const c = schema.parse({ ...process.env, ...overrides });
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
  return c;
}
export const passwordEnabled = (c: Config) =>
  c.AUTH_PROVIDER === 'password' ||
  (c.AUTH_PROVIDER === 'local' && ['development', 'test'].includes(c.APP_ENV));
export const deployed = (c: Config) => ['staging', 'production'].includes(c.APP_ENV);
