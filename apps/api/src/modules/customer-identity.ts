import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import { transaction, customerLifecycleLock, type Pools } from '../db.js';
import { keyedHash } from '../crypto.js';
import { requireCondition } from '../errors.js';
import {
  deviceCsrf,
  prepareDevice,
  issueDeviceSession,
  deviceAgentFamily,
} from '../customer-auth/device-auth.js';
import { customerRegistrationInput } from '../../../../packages/contracts/src/customer-identity.js';
import { legalNotice } from '../../../../packages/domain/src/legal.js';
import { acceptedLegal } from '../legal.js';
import { z } from 'zod';

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
  app.get('/api/v1/public/legal', async (req) => {
    const { lang } = z.object({ lang: z.enum(['ar', 'en']).optional() }).parse(req.query);
    return legalNotice(lang || (req.headers['x-nuqta-language'] === 'en' ? 'en' : 'ar'));
  });
  app.get('/api/v1/customer/bootstrap', async (req, reply) => ({
    csrfToken: prepareDevice(req, reply, c).csrfToken,
  }));
  app.post('/api/v1/customer/register', async (req, reply) => {
    const hash = deviceCsrf(req, c),
      p = customerRegistrationInput.parse(req.body),
      notice = acceptedLegal(p);
    const ipAllowed = await customerLimit(pools, c, 'customer-register-ip:' + req.ip, 5, 3600);
    const placementAllowed = await customerLimit(
      pools,
      c,
      'customer-register-placement:' + (p.placementCode || p.merchantId) + ':' + req.ip,
      5,
      3600,
    );
    requireCondition(ipAllowed && placementAllowed, 'CUSTOMER_REGISTRATION_LIMIT', 429);
    const result = await transaction(pools.authPool, async (db) => {
      const bound = (
        await db.query('SELECT customer_id FROM customer_devices WHERE token_hash=$1', [hash])
      ).rows[0];
      const existing =
        bound?.customer_id || (req.actor?.authMethod !== 'device' ? req.actor?.id : undefined);
      if (existing) await customerLifecycleLock(db, existing);
      const result = (
        await db.query(
          'SELECT register_customer_device($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS value',
          [
            p.displayName,
            p.phone,
            hash,
            deviceAgentFamily(String(req.headers['user-agent'] || '')),
            notice.locale,
            p.merchantId,
            p.programId,
            p.programVersionId,
            p.branchId,
            p.source,
            p.placementCode || null,
            p.acceptedTermsHash,
            notice.acceptance.version,
            notice.acceptance.text,
            req.actor?.authMethod !== 'device' ? req.actor?.id || null : null,
          ],
        )
      ).rows[0].value;
      if (!result.phoneExists)
        await db.query(
          `INSERT INTO customer_privacy_acceptances(customer_id,device_id,version,text_hash,terms_text)
            SELECT customer_id,id,$1,$2,$3 FROM customer_devices WHERE token_hash=$4 AND customer_id=$5
            ON CONFLICT(customer_id,version,text_hash) DO NOTHING`,
          [
            notice.acceptance.version,
            notice.acceptance.hash,
            notice.acceptance.text,
            hash,
            result.userId,
          ],
        );
      return result;
    });
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
