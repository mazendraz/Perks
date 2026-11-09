import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import { transaction, type Pools } from '../db.js';
import { keyedHash } from '../crypto.js';
import { requireCondition } from '../errors.js';
import {
  deviceCsrf,
  prepareDevice,
  issueDeviceSession,
  deviceAgentFamily,
} from '../customer-auth/device-auth.js';
import {
  customerRegistrationInput,
  customerPrivacyText,
  customerPrivacyVersion,
} from '../../../../packages/contracts/src/customer-identity.js';

export async function customerLimit(
  pools: Pools,
  c: Config,
  identity: string,
  max: number,
  seconds: number,
) {
  const count = (
    await pools.authPool.query(
      `INSERT INTO customer_auth_limits(key_hash) VALUES($1)
     ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN customer_auth_limits.window_started_at<=clock_timestamp()-$2*interval '1 second' THEN 1 ELSE customer_auth_limits.attempts+1 END,
     window_started_at=CASE WHEN customer_auth_limits.window_started_at<=clock_timestamp()-$2*interval '1 second' THEN clock_timestamp() ELSE customer_auth_limits.window_started_at END RETURNING attempts`,
      [keyedHash(identity, c.AUTH_PEPPER), seconds],
    )
  ).rows[0].attempts;
  return count <= max;
}
export function customerIdentityModule(app: FastifyInstance, pools: Pools, c: Config) {
  app.get('/api/v1/customer/bootstrap', async (req, reply) => ({
    csrfToken: prepareDevice(req, reply, c).csrfToken,
  }));
  app.post('/api/v1/customer/register', async (req, reply) => {
    const hash = deviceCsrf(req, c),
      p = customerRegistrationInput.parse(req.body);
    const ipAllowed = await customerLimit(pools, c, 'customer-register-ip:' + req.ip, 5, 3600);
    const placementAllowed = await customerLimit(
      pools,
      c,
      'customer-register-placement:' + (p.placementCode || p.merchantId) + ':' + req.ip,
      5,
      3600,
    );
    requireCondition(ipAllowed && placementAllowed, 'CUSTOMER_REGISTRATION_LIMIT', 429);
    const result = await transaction(
      pools.authPool,
      async (db) =>
        (
          await db.query(
            'SELECT register_customer_device($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS value',
            [
              p.displayName,
              p.phone,
              hash,
              deviceAgentFamily(String(req.headers['user-agent'] || '')),
              req.headers['x-nuqta-language'] === 'en' ? 'en' : 'ar',
              p.merchantId,
              p.programId,
              p.programVersionId,
              p.branchId,
              p.source,
              p.placementCode || null,
              p.acceptedTermsHash,
              customerPrivacyVersion,
              customerPrivacyText,
              req.actor?.authMethod !== 'device' ? req.actor?.id || null : null,
            ],
          )
        ).rows[0].value,
    );
    requireCondition(!result.phoneExists, 'CUSTOMER_PHONE_EXISTS', 409);
    const session = await issueDeviceSession(pools, c, req, reply);
    requireCondition(session, 'CUSTOMER_DEVICE_REVOKED', 401);
    return {
      membershipId: result.membershipId,
      alreadyMember: result.alreadyMember,
      csrfToken: session.csrfToken,
    };
  });
}
