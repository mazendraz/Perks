import { existsSync } from 'node:fs';
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
  return c;
}
export const passwordEnabled = (c: Config) =>
  c.AUTH_PROVIDER === 'password' ||
  (c.AUTH_PROVIDER === 'local' && ['development', 'test'].includes(c.APP_ENV));
export const deployed = (c: Config) => ['staging', 'production'].includes(c.APP_ENV);
