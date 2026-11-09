import { outreachModule } from './modules/outreach.js';
import { ownerPreviewModule } from './modules/owner-preview.js';
import { platformTeamModule } from './modules/platform-team.js';
import { accountManagementModule } from './modules/account-management.js';
import { contractDocumentation, activationDataSchema } from './openapi.js';
import { scriptSources } from '../../../packages/domain/src/browser-policy.js';
import { liveEventsModule } from './live-events.js';
import { experienceModule } from './modules/experience.js';
import { customerIdentityModule } from './modules/customer-identity.js';
import { customerRecoveryModule } from './modules/customer-recovery.js';
import Fastify, { LogController, type FastifyBaseLogger } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import { ZodError } from 'zod';
import { readConfig, trustedProxies, type Config } from './config.js';
import { createPools } from './db.js';
import { authModule } from './auth.js';
import { AppError } from './errors.js';
import { onboardingModule } from './modules/onboarding.js';
import { provisioningModule } from './modules/provisioning.js';
import { enrollmentModule } from './modules/enrollment.js';
import { loyaltyModule } from './modules/loyalty.js';
import { rewardsModule } from './modules/rewards.js';
import { reportingModule } from './modules/reporting.js';
import { requestsModule } from './modules/requests.js';
import { customersModule } from './modules/customers.js';
import { materialsModule } from './modules/materials.js';
import { platformModule } from './modules/platform.js';
import { administrationModule } from './modules/administration.js';
import { randomUUID } from 'node:crypto';
import { apiLogger, httpLog, failureLog } from './logging.js';
import { HttpMetrics } from '../../../packages/domain/src/monitoring.js';
import { monitoringModule, type MonitoringProbes } from './modules/monitoring.js';
export async function buildApp(
  overrides: Partial<Config> = {},
  options: {
    logStream?: { write: (line: string) => void };
    monitoringProbes?: MonitoringProbes;
  } = {},
) {
  const c = readConfig(overrides),
    pools = createPools(c);
  const httpMetrics = new HttpMetrics();
  const logRoot: { logger?: FastifyBaseLogger } = {};
  const app = Fastify({
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    bodyLimit: 1_048_576,
    trustProxy: trustedProxies(c.TRUSTED_PROXIES),
    logger: c.LOG_LEVEL === 'silent' ? false : apiLogger(c.LOG_LEVEL, options.logStream, logRoot),
  });
  logRoot.logger = app.log;
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url || '';
    if (req.url.startsWith('/api/'))
      httpMetrics.observe(reply.statusCode, route.endsWith('/events') ? null : reply.elapsedTime);
    req.log.info(httpLog(req, reply));
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: scriptSources,
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        // Safari upgrades loopback HTTP too; local QA uses HTTP, production requires HTTPS.
        upgradeInsecureRequests: ['development', 'test'].includes(c.APP_ENV) ? null : [],
      },
    },
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) =>
      req.actor ? 'user:' + (req.actor.preview?.adminId || req.actor.id) : 'ip:' + req.ip,
    skipOnError: false,
  });
  app.addHook('onSend', async (req, reply, payload) => {
    if (
      (req.url.startsWith('/api/') &&
        req.routeOptions.url !== '/api/v1/public/merchants/:m/logos/:id') ||
      req.url.startsWith('/health/')
    )
      reply.header('Cache-Control', 'no-store');
    return payload;
  });
  await app.register(swagger, {
    transform: contractDocumentation,
    openapi: {
      info: { title: 'Nuqta API', version: '0.1.0' },
      components: {
        schemas: { ProvisioningActivationData: activationDataSchema },
        securitySchemes: {
          session: {
            type: 'apiKey',
            in: 'cookie',
            name: c.COOKIE_SECURE === 'true' ? '__Host-nq_session' : 'nq_session',
          },
        },
      },
    },
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError) {
      reply.code(422).send({
        error: {
          code: 'VALIDATION_FAILED',
          requestId: req.id,
          retryable: false,
          fields: error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
        },
      });
      return;
    }
    if (error instanceof AppError) {
      reply
        .code(error.status)
        .send({ error: { code: error.code, requestId: req.id, retryable: error.retryable } });
      return;
    }
    const status =
      typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
    if (status >= 500) req.log.error(failureLog(req.id));
    reply.code(status >= 400 && status < 500 ? status : 500).send({
      error: {
        code:
          status === 429 ? 'RATE_LIMITED' : status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
        requestId: req.id,
        retryable: status >= 500,
      },
    });
  });
  authModule(app, pools, c);
  ownerPreviewModule(app, pools);
  platformTeamModule(app, pools, c);
  provisioningModule(app, pools, c);
  accountManagementModule(app, pools, c);
  outreachModule(app, pools);
  onboardingModule(app, pools, c);
  enrollmentModule(app, pools, c);
  loyaltyModule(app, pools);
  rewardsModule(app, pools, c);
  reportingModule(app, pools);
  requestsModule(app, pools, c);
  liveEventsModule(app, pools, c);
  experienceModule(app, pools);
  customerIdentityModule(app, pools, c);
  customerRecoveryModule(app, pools, c);
  customersModule(app, pools, c);
  materialsModule(app, pools, c);
  platformModule(app, pools, c);
  administrationModule(app, pools);
  monitoringModule(app, pools, c, httpMetrics, options.monitoringProbes);
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_req, reply) => {
    try {
      for (const [pool, expectedRole] of [
        [pools.pool, 'nuqta_runtime'],
        [pools.authPool, 'nuqta_auth'],
      ] as const) {
        const r = (
          await pool.query(
            "SELECT current_user AS role,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid) AS has_memberships,EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relowner=pg_roles.oid) AS owns_tables,current_setting('row_security') AS row_security FROM pg_roles WHERE rolname=current_user",
          )
        ).rows[0];
        if (
          !r ||
          r.role !== expectedRole ||
          r.rolsuper ||
          r.rolbypassrls ||
          r.rolcreatedb ||
          r.rolcreaterole ||
          r.rolreplication ||
          r.has_memberships ||
          r.owns_tables ||
          r.row_security !== 'on'
        )
          throw new Error('Runtime role/schema is not ready');
      }
      if (
        (
          await pools.pool.query(
            "SELECT count(*)::int AS count FROM schema_migrations WHERE name='011a_monitoring_queue_intents.sql'",
          )
        ).rows[0].count !== 1
      )
        throw new Error('Schema is not ready');
      return { status: 'ready' };
    } catch {
      reply.code(503);
      return { status: 'not_ready' };
    }
  });
  app.get('/api/v1/openapi.json', async () => app.swagger());
  app.addHook('onClose', async () => {
    await Promise.all([pools.pool.end(), pools.authPool.end()]);
  });
  return { app, pools, config: c };
}
