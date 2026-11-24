import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticated } from '../auth.js';
import { transaction, type Pools } from '../db.js';
import { requireCondition } from '../errors.js';
import type { Config } from '../config.js';
import { sanitizeLogo } from '../storage/logo.js';
import { createFileStore } from '../storage/file-store.js';
import { tokenHash } from '../crypto.js';
import { platform } from '../policy.js';
import { transferMatchesOrder } from '../../../../packages/domain/src/onboarding-payment.js';
import { merchantOnboardingSetup } from '../../../../packages/contracts/src/merchant-onboarding.js';

const draftInput = z.object({
  revision: z.number().int().positive(),
  name: z.string().trim().max(120),
  setup: merchantOnboardingSetup.optional(),
});

const draftFields = 'id, details, revision, publication, logo_id';

export function merchantOnboardingModule(app: FastifyInstance, pools: Pools, c: Config) {
  const path = '/api/v1/merchant-onboarding/draft';
  const files = createFileStore(c);
  const orderPath = '/api/v1/merchant-onboarding/order';
  const orderFields = 'id, plan_id, amount_minor, currency, duration_days, recipient_account';
  const reviewPath = '/api/v1/platform/onboarding-payments';

  app.get(path + '/:id/logo', async (req, reply) => {
    const actor = authenticated(req);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const logo = await transaction(
      pools.pool,
      async (db) =>
        (
          await db.query(
            'SELECT logo_image FROM merchant_onboarding_drafts WHERE id=$1 AND owner_id=$2',
            [id, actor.id],
          )
        ).rows[0]?.logo_image,
      actor,
    );
    requireCondition(logo, 'NOT_FOUND', 404);
    return reply.type('image/png').header('Cache-Control', 'no-store').send(logo);
  });

  app.post(path + '/:id/logo', { bodyLimit: 2_700_000 }, async (req) => {
    const actor = authenticated(req);
    requireCondition(actor.authMethod !== 'device' && !actor.preview, 'FORBIDDEN', 403);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z
      .object({ image: z.base64().max(2_666_668), revision: z.number().int().positive() })
      .strict()
      .parse(req.body);
    const logo = await sanitizeLogo(body.image);
    return transaction(
      pools.pool,
      async (db) => {
        const saved = (
          await db.query(
            `UPDATE merchant_onboarding_drafts SET logo_id=gen_random_uuid(),logo_image=$1,
         logo_width=$2,logo_height=$3,revision=revision+1,updated_at=now()
         WHERE id=$4 AND owner_id=$5 AND merchant_id IS NULL AND revision=$6
         RETURNING ${draftFields}`,
            [logo.bytes, logo.width, logo.height, id, actor.id, body.revision],
          )
        ).rows[0];
        requireCondition(saved, 'REVISION_CONFLICT', 409);
        return { draft: saved };
      },
      actor,
    );
  });

  app.post(path + '/:id/correction', async (req) => {
    const actor = authenticated(req);
    requireCondition(actor.authMethod !== 'device' && !actor.preview, 'FORBIDDEN', 403);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        const correction = (await db.query('SELECT start_onboarding_correction($1) AS id', [id]))
          .rows[0].id;
        const result = await db.query(
          'SELECT id, amount_minor, recipient_account, submitted_reference, confirmed_at FROM merchant_onboarding_orders WHERE id=$1',
          [correction],
        );
        return { order: result.rows[0] };
      },
      actor,
    );
  });

  app.post(path + '/:id/publish', async (req) => {
    const actor = authenticated(req);
    requireCondition(actor.authMethod !== 'device' && !actor.preview, 'FORBIDDEN', 403);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { revision } = z
      .object({ revision: z.number().int().positive() })
      .strict()
      .parse(req.body);
    return transaction(
      pools.pool,
      async (db) => {
        const result = await db.query('SELECT publish_merchant_onboarding($1,$2) AS publication', [
          id,
          revision,
        ]);
        const publication = result.rows[0].publication;
        const logo = (
          await db.query(
            'SELECT logo_id,logo_image FROM merchant_onboarding_drafts WHERE id=$1 AND owner_id=$2',
            [id, actor.id],
          )
        ).rows[0];
        if (logo?.logo_image) {
          const key = publication.merchantId + '/' + logo.logo_id + '.png';
          await files.put(key, logo.logo_image, { contentType: 'image/png' });
          await db.query('SELECT attach_onboarding_logo($1,$2)', [
            id,
            tokenHash(logo.logo_image.toString('base64')),
          ]);
        }
        return { publication };
      },
      actor,
    );
  });

  app.get(reviewPath, async (req) => {
    const actor = authenticated(req);
    platform(actor);
    return transaction(
      pools.pool,
      async (db) => {
        const result = await db.query(
          `SELECT o.id, o.amount_minor, o.currency, o.recipient_account, o.submitted_reference,
                o.receipt_key, d.details->>'name' AS shop_name
         FROM merchant_onboarding_orders o JOIN merchant_onboarding_drafts d ON d.id=o.draft_id
         WHERE o.receipt_key IS NOT NULL AND o.confirmed_at IS NULL AND o.rejected_at IS NULL
         ORDER BY o.created_at LIMIT 100`,
        );
        return { orders: result.rows };
      },
      actor,
    );
  });

  app.post(reviewPath + '/:id/reject', async (req) => {
    const actor = authenticated(req);
    platform(actor);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { receiptKey, reason } = z
      .object({
        receiptKey: z.uuid(),
        reason: z.string().trim().min(4).max(500),
      })
      .strict()
      .parse(req.body);
    return transaction(
      pools.pool,
      async (db) => {
        const result = await db.query(
          `UPDATE merchant_onboarding_orders
         SET rejected_at=clock_timestamp(), rejected_by=$1, rejection_reason=$2
         WHERE id=$3 AND receipt_key=$4 AND confirmed_at IS NULL AND rejected_at IS NULL
         RETURNING id`,
          [actor.id, reason, id, receiptKey],
        );
        requireCondition(result.rowCount, 'REVISION_CONFLICT', 409);
        return { rejected: true };
      },
      actor,
    );
  });

  app.get(reviewPath + '/:id/receipt', async (req, reply) => {
    const actor = authenticated(req);
    platform(actor);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { version } = z.object({ version: z.uuid() }).parse(req.query);
    const receipt = await transaction(
      pools.pool,
      async (db) =>
        (
          await db.query(
            'SELECT receipt_image FROM merchant_onboarding_orders WHERE id=$1 AND receipt_key=$2',
            [id, version],
          )
        ).rows[0]?.receipt_image,
      actor,
    );
    requireCondition(receipt, 'NOT_FOUND', 404);
    return reply.header('Cache-Control', 'no-store').type('image/png').send(receipt);
  });

  app.post(reviewPath + '/:id/confirm', async (req) => {
    const actor = authenticated(req);
    platform(actor);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z
      .object({
        receiptKey: z.uuid(),
        reference: z.string().trim().min(3).max(120),
        amountMinor: z.number().int().positive(),
        recipientAccountId: z.string().trim().min(1).max(120),
      })
      .strict()
      .parse(req.body);
    return transaction(
      pools.pool,
      async (db) => {
        const order = (
          await db.query(
            `SELECT amount_minor,currency,recipient_account,receipt_key,confirmed_at,confirmed_reference,rejected_at
         FROM merchant_onboarding_orders WHERE id=$1 FOR UPDATE`,
            [id],
          )
        ).rows[0];
        requireCondition(
          order && !order.rejected_at && order.receipt_key === body.receiptKey,
          'REVISION_CONFLICT',
          409,
        );
        requireCondition(
          transferMatchesOrder(
            {
              amountMinor: order.amount_minor,
              currency: order.currency,
              recipientAccountId: order.recipient_account,
            },
            { ...body, currency: 'EGP', direction: 'incoming', status: 'settled' },
          ),
          'ONBOARDING_TRANSFER_MISMATCH',
          422,
        );
        if (order.confirmed_at) {
          requireCondition(order.confirmed_reference === body.reference, 'REVISION_CONFLICT', 409);
          return { confirmed: true };
        }
        await db.query(
          `UPDATE merchant_onboarding_orders SET confirmed_reference=$1, confirmed_by=$2,
         confirmed_at=clock_timestamp() WHERE id=$3`,
          [body.reference, actor.id, id],
        );
        return { confirmed: true };
      },
      actor,
    );
  });

  app.get('/api/v1/merchant-onboarding/plans', async (req) => {
    const actor = authenticated(req);
    requireCondition(actor.authMethod !== 'device', 'FORBIDDEN', 403);
    if (!c.ONBOARDING_INSTAPAY_ADDRESS) return { plans: [] };
    const result = await pools.pool.query(
      'SELECT plan_key, name_ar, name_en, amount_minor FROM merchant_onboarding_monthly_plans()',
    );
    return { plans: result.rows };
  });

  app.get(orderPath, async (req) => {
    const actor = authenticated(req);
    requireCondition(actor.authMethod !== 'device', 'FORBIDDEN', 403);
    return transaction(
      pools.pool,
      async (db) => {
        const result = await db.query(
          `SELECT o.id, o.amount_minor, o.recipient_account, o.submitted_reference, o.confirmed_at,
                  o.rejection_reason
           FROM merchant_onboarding_orders o JOIN merchant_onboarding_drafts d ON d.id=o.draft_id
           WHERE d.owner_id=$1 AND d.merchant_id IS NULL
           ORDER BY o.confirmed_at DESC NULLS LAST, o.created_at DESC LIMIT 1`,
          [actor.id],
        );
        return { order: result.rows[0] ?? null };
      },
      actor,
    );
  });

  app.post(
    orderPath + '/:id/receipt',
    { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } }, bodyLimit: 2_700_000 },
    async (req) => {
      const actor = authenticated(req);
      requireCondition(actor.authMethod !== 'device', 'FORBIDDEN', 403);
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const { reference, image } = z
        .object({
          reference: z.string().trim().min(3).max(120),
          image: z.base64().max(2_666_668),
        })
        .strict()
        .parse(req.body);
      const receipt = await sanitizeLogo(image);
      return transaction(
        pools.pool,
        async (db) => {
          const result = await db.query(
            `UPDATE merchant_onboarding_orders o
             SET submitted_reference=$1,receipt_key=gen_random_uuid(),receipt_image=$2
             FROM merchant_onboarding_drafts d
             WHERE o.id=$3 AND o.draft_id=d.id AND d.owner_id=$4
               AND (d.merchant_id IS NULL OR o.corrects_order_id IS NOT NULL)
               AND o.confirmed_at IS NULL AND o.rejected_at IS NULL
             RETURNING o.id,o.amount_minor,o.recipient_account,o.submitted_reference,o.confirmed_at`,
            [reference, receipt.bytes, id, actor.id],
          );
          requireCondition(result.rows[0], 'NOT_FOUND', 404);
          return { order: result.rows[0] };
        },
        actor,
      );
    },
  );

  app.post(orderPath, async (req) => {
    const actor = authenticated(req);
    requireCondition(actor.authMethod !== 'device', 'FORBIDDEN', 403);
    const recipient = c.ONBOARDING_INSTAPAY_ADDRESS;
    requireCondition(recipient, 'ONBOARDING_PAYMENT_UNAVAILABLE', 503);
    const { planKey } = z
      .object({ planKey: z.string().min(2).max(32) })
      .strict()
      .parse(req.body);
    return transaction(
      pools.pool,
      async (db) => {
        const draft = (
          await db.query(
            'SELECT id FROM merchant_onboarding_drafts WHERE owner_id=$1 AND merchant_id IS NULL FOR UPDATE',
            [actor.id],
          )
        ).rows[0];
        requireCondition(draft, 'NOT_FOUND', 404);
        const previous = (
          await db.query(
            `SELECT ${orderFields}, confirmed_at FROM merchant_onboarding_orders
           WHERE draft_id=$1 AND rejected_at IS NULL ORDER BY confirmed_at DESC NULLS LAST, created_at DESC LIMIT 1`,
            [draft.id],
          )
        ).rows[0];
        // Keep the quoted amount when the owner retries or the catalog price changes.
        const existingPlan =
          previous &&
          (
            await db.query(
              'SELECT plan_id FROM merchant_onboarding_monthly_plans() WHERE plan_key=$1',
              [planKey],
            )
          ).rows[0];
        if (previous && (previous.confirmed_at || previous.plan_id === existingPlan?.plan_id))
          return { order: previous };
        const order = (
          await db.query(
            `INSERT INTO merchant_onboarding_orders
             (draft_id, plan_id, amount_minor, currency, duration_days, recipient_account)
           SELECT $1, plan_id, amount_minor, 'EGP', 30, $2
           FROM merchant_onboarding_monthly_plans() WHERE plan_key=$3
           RETURNING ${orderFields}, confirmed_at`,
            [draft.id, recipient, planKey],
          )
        ).rows[0];
        requireCondition(order, 'NOT_FOUND', 404);
        return { order };
      },
      actor,
    );
  });

  app.get(path, async (req) => {
    const actor = authenticated(req);
    requireCondition(actor.authMethod !== 'device', 'FORBIDDEN', 403);
    return transaction(
      pools.pool,
      async (db) => {
        const result = await db.query(
          `SELECT ${draftFields}, (
             SELECT rejection_reason FROM merchant_onboarding_orders WHERE id=published_order_id
           ) AS rejection_reason
           FROM merchant_onboarding_drafts
           WHERE owner_id=$1 ORDER BY (merchant_id IS NULL) DESC, created_at DESC LIMIT 1`,
          [actor.id],
        );
        return { draft: result.rows[0] ?? null };
      },
      actor,
    );
  });

  app.post(path, async (req) => {
    const actor = authenticated(req);
    requireCondition(actor.authMethod !== 'device', 'FORBIDDEN', 403);
    return transaction(
      pools.pool,
      async (db) => {
        await db.query(
          `INSERT INTO merchant_onboarding_drafts(owner_id) VALUES($1)
         ON CONFLICT (owner_id) WHERE merchant_id IS NULL DO NOTHING`,
          [actor.id],
        );
        const result = await db.query(
          `SELECT ${draftFields} FROM merchant_onboarding_drafts
         WHERE owner_id=$1 AND merchant_id IS NULL`,
          [actor.id],
        );
        return { draft: result.rows[0] ?? null };
      },
      actor,
    );
  });

  app.patch(path, async (req) => {
    const actor = authenticated(req);
    requireCondition(actor.authMethod !== 'device', 'FORBIDDEN', 403);
    const { revision, ...details } = draftInput.parse(req.body);
    return transaction(
      pools.pool,
      async (db) => {
        const result = await db.query(
          `UPDATE merchant_onboarding_drafts
         SET details=details || $1::jsonb,
             revision=revision+1, updated_at=now()
         WHERE owner_id=$2 AND merchant_id IS NULL AND revision=$3
         RETURNING ${draftFields}`,
          [JSON.stringify(details), actor.id, revision],
        );
        requireCondition(result.rows[0], 'REVISION_CONFLICT', 409);
        return { draft: result.rows[0] };
      },
      actor,
    );
  });
}
