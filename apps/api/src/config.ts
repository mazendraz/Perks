import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve, parse, sep } from 'node:path';
import { z } from 'zod';
import { isIP } from 'node:net';
import { keysMatch } from './webpush.js';
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
  ONBOARDING_INSTAPAY_ADDRESS: z.string().trim().max(120).optional(),
  TRUSTED_PROXIES: z.string().default(''),
  // Live update (SSE) stream caps: whole process, per signed-in user, per client address.
  LIVE_MAX_STREAMS: z.coerce.number().int().min(1).default(200),
  LIVE_MAX_STREAMS_PER_USER: z.coerce.number().int().min(1).default(6),
  LIVE_MAX_STREAMS_PER_IP: z.coerce.number().int().min(1).default(40),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.union([z.email(), z.literal('')]).optional(),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  SMTP_STARTTLS: z.enum(['true', 'false']).default('true'),
  SMTP_CA_FILE: z.string().optional(),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug']).default('info'),
  // Set to "true" only after legal review approved the current legal text (version in
  // packages/domain/src/legal.ts). Until then the legal pages say they are a draft.
  LEGAL_TEXT_APPROVED: z.enum(['true', 'false']).default('false'),
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
  // Wallet pass pushes. APNs refuses priority 10 with the background type, so the two move together
  // (see docs/wallet/APPLE-WALLET.md before changing them).
  APPLE_APNS_PUSH_TYPE: z.enum(['background', 'alert']).default('background'),
  APPLE_APNS_PRIORITY: z.enum(['5', '10']).default('5'),
  GOOGLE_WALLET_ENABLED: z.enum(['true', 'false']).default('false'),
  GOOGLE_WALLET_ISSUER_ID: z
    .string()
    .regex(/^\d{10,25}$/)
    .optional(),
  GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: z.string().optional(),
  WHATSAPP_RECOVERY_ENABLED: z.enum(['true', 'false']).default('false'),
  WHATSAPP_RECOVERY_NUMBER: z.string().default(''),
  WHATSAPP_RECOVERY_NUMBER_ID: z.string().default(''),
  WHATSAPP_RECOVERY_APP_SECRET: z.string().default(''),
  WHATSAPP_RECOVERY_VERIFY_TOKEN: z.string().default(''),
  // Web Push for cashier devices. Off unless both halves of the VAPID pair are set
  // (generate one with `npm run push:keys`). The subject defaults to PUBLIC_APP_ORIGIN.
  WEB_PUSH_VAPID_PUBLIC_KEY: z.string().optional(),
  WEB_PUSH_VAPID_PRIVATE_KEY: z.string().optional(),
  WEB_PUSH_SUBJECT: z.string().optional(),
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
    c.WHATSAPP_RECOVERY_ENABLED === 'true' &&
    (!/^[1-9]\d{7,14}$/.test(c.WHATSAPP_RECOVERY_NUMBER) ||
      !/^\d{5,30}$/.test(c.WHATSAPP_RECOVERY_NUMBER_ID) ||
      c.WHATSAPP_RECOVERY_APP_SECRET.trim().length < 32 ||
      c.WHATSAPP_RECOVERY_VERIFY_TOKEN.trim().length < 32 ||
      new Set([c.AUTH_PEPPER, c.WHATSAPP_RECOVERY_APP_SECRET, c.WHATSAPP_RECOVERY_VERIFY_TOKEN])
        .size !== 3)
  )
    throw new Error(
      'WhatsApp recovery requires the business number, number ID and independent app secret and verify token.',
    );
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
    if ((c.APPLE_APNS_PUSH_TYPE === 'background') !== (c.APPLE_APNS_PRIORITY === '5'))
      throw new Error(
        'APPLE_APNS_PUSH_TYPE=background needs APPLE_APNS_PRIORITY=5; alert needs 10.',
      );
  }
  // Empty values (a blank line in .env) mean "not configured", same as unset.
  const pushPublic = c.WEB_PUSH_VAPID_PUBLIC_KEY?.trim(),
    pushPrivate = c.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  if (!!pushPublic !== !!pushPrivate)
    throw new Error(
      'Web Push requires both WEB_PUSH_VAPID_PUBLIC_KEY and WEB_PUSH_VAPID_PRIVATE_KEY.',
    );
  if (pushPublic && pushPrivate) {
    if (!keysMatch({ publicKey: pushPublic, privateKey: pushPrivate }))
      throw new Error('WEB_PUSH_VAPID_PUBLIC_KEY and WEB_PUSH_VAPID_PRIVATE_KEY are not one pair.');
    const subject = c.WEB_PUSH_SUBJECT || c.PUBLIC_APP_ORIGIN;
    if (!/^(?:https:\/\/|mailto:)\S+$/.test(subject))
      throw new Error(
        'Web Push needs an https URL or mailto: address as WEB_PUSH_SUBJECT (or an https PUBLIC_APP_ORIGIN to default to).',
      );
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
