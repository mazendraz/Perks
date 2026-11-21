import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  customerPhone,
  whatsappProofInput,
} from '../../../../packages/contracts/src/customer-identity.js';
import type { Config } from '../config.js';
import { keyedHash, opaqueToken, safeEqual, tokenHash } from '../crypto.js';
import {
  deviceAgentFamily,
  deviceCookie,
  deviceCsrf,
  issueDeviceSession,
} from '../customer-auth/device-auth.js';
import { transaction, type Pools } from '../db.js';
import { requireCondition } from '../errors.js';
import { customerLimit } from './customer-identity.js';

export const WHATSAPP_RECOVERY_WEBHOOK = '/api/v1/webhooks/whatsapp-recovery';
const base = '/api/v1/customer/whatsapp';
const proofToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const finishInput = z.object({ phone: customerPhone, code: proofToken }).strict();
const webhookPayload = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.object({
            metadata: z.object({ phone_number_id: z.string() }).optional(),
            messages: z.array(z.unknown()).optional(),
          }),
        }),
      ),
    }),
  ),
});
const textMessage = z.object({
  type: z.literal('text'),
  from: z.string().regex(/^[1-9]\d{7,14}$/),
  text: z.object({ body: z.string() }),
});

export function customerWhatsAppModule(app: FastifyInstance, pools: Pools, c: Config) {
  const enabled = c.WHATSAPP_RECOVERY_ENABLED === 'true';
  const phoneHash = (phone: string) => keyedHash('whatsapp-phone:' + phone, c.AUTH_PEPPER);
  const account = async (req: FastifyRequest) => {
    const raw = proofToken.safeParse(req.cookies[deviceCookie(c)]);
    const actor = req.actor;
    if (actor?.authMethod !== 'device' || !raw.success) return null;
    return transaction(pools.authPool, async (db) => {
      await db.query("SELECT set_config('app.user_id',$1,true)", [actor.id]);
      return (
        await db.query('SELECT customer_whatsapp_account($1,$2) AS value', [
          tokenHash(raw.data),
          actor.sessionId,
        ])
      ).rows[0].value as { id: string; phone: string | null; verified: boolean } | null;
    });
  };

  app.get(base, async (req) => {
    const current = enabled ? await account(req) : null;
    return { enabled, account: current && { phone: current.phone, verified: current.verified } };
  });
  if (!enabled) return;

  app.post(
    base + '/start',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const device = deviceCsrf(req, c),
        p = whatsappProofInput.parse(req.body);
      const current = p.purpose === 'update' ? await account(req) : null;
      requireCondition(p.purpose === 'restore' || current, 'DEVICE_SCOPE_RECOVERY_REQUIRED', 409);
      requireCondition(
        await customerLimit(pools, c, 'whatsapp-start:' + req.ip, 20, 3600),
        'CUSTOMER_RECOVERY_LIMIT',
        429,
      );
      const code = opaqueToken();
      const { expires_at: expiresAt } = (
        await transaction(pools.authPool, async (db) => {
          await db.query(`DELETE FROM customer_whatsapp_proofs WHERE device_hash IN (
        SELECT device_hash FROM customer_whatsapp_proofs WHERE expires_at<=clock_timestamp()
        LIMIT 100 FOR UPDATE SKIP LOCKED
      )`);
          return db.query(
            `INSERT INTO customer_whatsapp_proofs(device_hash,code_hash,phone_hash,account_id)
        VALUES($1,$2,$3,$4) ON CONFLICT(device_hash) DO UPDATE SET code_hash=excluded.code_hash,
        phone_hash=excluded.phone_hash,account_id=excluded.account_id,expires_at=excluded.expires_at,
        confirmed_at=NULL,completed_at=NULL RETURNING expires_at`,
            [device, tokenHash(code), phoneHash(p.phone), current?.id ?? null],
          );
        })
      ).rows[0];
      const lang = req.headers['x-nuqta-language'] === 'en' ? 'en' : 'ar';
      const heading = p.purpose === 'restore' ? 'PERKS RESTORE' : 'PERKS PHONE';
      const instruction =
        lang === 'ar'
          ? 'ابعت الرسالة دي بس لو إنت طلبت الكود من متصفح على جهازك.'
          : 'Only send this if you requested the code in a browser on your own device.';
      const url = `https://wa.me/${c.WHATSAPP_RECOVERY_NUMBER}?text=${encodeURIComponent(`${heading} ${code}\n${instruction}`)}`;
      return { code, expiresAt, url };
    },
  );

  app.post(
    base + '/finish',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const device = deviceCsrf(req, c),
        p = finishInput.parse(req.body);
      const actor = req.actor?.authMethod === 'device' ? req.actor : null;
      const status = (
        await transaction(pools.authPool, async (db) => {
          if (actor) await db.query("SELECT set_config('app.user_id',$1,true)", [actor.id]);
          return db.query('SELECT finish_customer_whatsapp_proof($1,$2,$3,$4,$5,$6) AS status', [
            device,
            tokenHash(p.code),
            phoneHash(p.phone),
            p.phone,
            actor?.sessionId ?? null,
            deviceAgentFamily(String(req.headers['user-agent'] || '')),
          ]);
        })
      ).rows[0].status;
      requireCondition(status !== 'expired', 'WHATSAPP_PROOF_EXPIRED', 410);
      requireCondition(status !== 'unavailable', 'WHATSAPP_RECOVERY_UNAVAILABLE', 409);
      requireCondition(status !== 'in_use', 'WHATSAPP_PHONE_IN_USE', 409);
      requireCondition(status !== 'scope', 'DEVICE_SCOPE_RECOVERY_REQUIRED', 409);
      requireCondition(status !== 'conflict', 'DEVICE_ALREADY_BOUND', 409);
      if (status !== 'restored') return { status };
      const session = await issueDeviceSession(pools, c, req, reply);
      requireCondition(session, 'CUSTOMER_DEVICE_REVOKED', 401);
      return { status, csrfToken: session.csrfToken };
    },
  );

  // Meta signs the original bytes. Keep the raw JSON parser scoped to this webhook.
  void app.register(async (webhook) => {
    webhook.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) =>
      done(null, body),
    );
    webhook.get(WHATSAPP_RECOVERY_WEBHOOK, async (req, reply) => {
      const query = z
        .object({
          'hub.mode': z.literal('subscribe'),
          'hub.verify_token': z.string(),
          'hub.challenge': z.string().min(1).max(256),
        })
        .safeParse(req.query);
      requireCondition(
        query.success &&
          safeEqual(query.data['hub.verify_token'], c.WHATSAPP_RECOVERY_VERIFY_TOKEN),
        'NOT_FOUND',
        404,
      );
      return reply.type('text/plain').send(query.data['hub.challenge']);
    });
    webhook.post(WHATSAPP_RECOVERY_WEBHOOK, async (req) => {
      requireCondition(Buffer.isBuffer(req.body), 'INVALID_REQUEST', 400);
      const expected = 'sha256=' + keyedHash(req.body, c.WHATSAPP_RECOVERY_APP_SECRET);
      requireCondition(
        safeEqual(String(req.headers['x-hub-signature-256'] || ''), expected),
        'FORBIDDEN',
        403,
      );
      let body: unknown;
      try {
        body = JSON.parse(req.body.toString('utf8'));
      } catch {
        requireCondition(false, 'INVALID_REQUEST', 400);
      }
      const payload = webhookPayload.safeParse(body);
      if (!payload.success) return { received: true };
      for (const entry of payload.data.entry) {
        for (const { field, value } of entry.changes) {
          if (
            field !== 'messages' ||
            value.metadata?.phone_number_id !== c.WHATSAPP_RECOVERY_NUMBER_ID
          )
            continue;
          for (const candidate of value.messages ?? []) {
            const message = textMessage.safeParse(candidate);
            if (!message.success) continue;
            const code = /^PERKS (RESTORE|PHONE) ([A-Za-z0-9_-]{43})\s*$/.exec(
              message.data.text.body.split('\n', 1)[0]!,
            );
            const phone = customerPhone.safeParse('+' + message.data.from);
            if (!code || !phone.success) continue;
            await pools.authPool.query(
              `UPDATE customer_whatsapp_proofs SET confirmed_at=clock_timestamp()
              WHERE code_hash=$1 AND phone_hash=$2 AND (account_id IS NOT NULL)=$3
              AND confirmed_at IS NULL AND expires_at>clock_timestamp()`,
              [tokenHash(code[2]!), phoneHash(phone.data), code[1] === 'PHONE'],
            );
          }
        }
      }
      return { received: true };
    });
  });
}
