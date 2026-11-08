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
  AUTH_PROVIDER: z.enum(['local', 'supabase']).default('local'),
  AUTH_PEPPER: z.string().min(32),
  AUTH_ISSUER: z.string().optional(),
  AUTH_AUDIENCE: z.string().default('authenticated'),
  AUTH_JWKS_URL: z.string().optional(),
  AUTH_PUBLIC_URL: z.string().optional(),
  AUTH_PUBLIC_KEY: z.string().optional(),
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
    if (
      new URL(c.DATABASE_URL).username ===
      new URL(c.DATABASE_MIGRATOR_URL || 'postgresql://unused@localhost/unused').username
    )
      throw new Error('Runtime and migration database roles must be separate.');
  }
  if (c.AUTH_PROVIDER === 'local' && !['127.0.0.1', 'localhost', '::1'].includes(c.HOST))
    throw new Error('Local authentication must bind to loopback.');
  if (c.AUTH_PROVIDER === 'supabase' && (!c.AUTH_ISSUER || !c.AUTH_JWKS_URL))
    throw new Error('Supabase issuer and JWKS URL are required.');
  return c;
}
