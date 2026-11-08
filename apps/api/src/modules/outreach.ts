import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { contactPhone } from '../../../../packages/contracts/src/account-management.js';
import { authenticated } from '../auth.js';
import { transaction, audit, type Pools, type Actor, type DB } from '../db.js';
import { merchantGrant, platform } from '../policy.js';
import { requireCondition } from '../errors.js';
async function access(db: DB, actor: Actor, m: string, id?: string) {
  if (actor.role === 'platform_admin') {
    platform(actor);
    return;
  }
  await merchantGrant(db, actor, m, ['owner', 'manager']);
  if (id)
    requireCondition(
      (await db.query("SELECT customer_directory($1,NULL,'all',$2,1,0) AS customer", [m, id]))
        .rowCount,
      'NOT_FOUND',
      404,
    );
}
const whatsapp = (phone: string, message: string) =>
  'https://wa.me/' + phone.slice(1) + '?text=' + encodeURIComponent(message);
export function outreachModule(app: FastifyInstance, pools: Pools) {
  app.get('/api/v1/merchants/:m/customer-outreach', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      q = z
        .object({
          offset: z.coerce.number().int().min(0).default(0),
          query: z.string().max(80).default(''),
        })
        .parse(req.query);
    return transaction(
      pools.pool,
      async (db) => {
        await access(db, actor, m);
        let scope: string[] | null = null;
        if (actor.role !== 'platform_admin')
          scope = (
            await db.query("SELECT search_customer_directory($1,NULL,'all',$2,51,$3) AS customer", [
              m,
              q.query,
              q.offset,
            ])
          ).rows.map((r) => r.customer.id);
        const rows = (
          await db.query(
            `SELECT cp.id,cp.alias,cp.created_at,(contact.value->>'phonePresent')::boolean AS "phonePresent",(contact.value->>'whatsappConsent')::boolean AS "whatsappConsent",contact.value->>'contactPhone' AS "contactPhone",
    (SELECT max(t.at) FROM loyalty_transactions t JOIN memberships ms ON ms.id=t.membership_id WHERE ms.profile_id=cp.id AND t.type='award' AND ($5::boolean OR branch_access(t.merchant_id,t.branch_id))) AS "lastPurchase",
    (SELECT count(*)::int FROM reward_grants r JOIN memberships ms ON ms.id=r.membership_id WHERE ms.profile_id=cp.id AND r.status='available' AND r.expires_at>now() AND ($5::boolean OR EXISTS(SELECT 1 FROM unnest(r.branch_ids) b WHERE branch_access(r.merchant_id,b)))) AS "availableRewards"
    FROM tenant_customer_profiles cp JOIN LATERAL(SELECT customer_contact_state(cp.merchant_id,cp.id) AS value) contact ON true
    WHERE cp.merchant_id=$1 AND ($2::uuid[] IS NULL OR cp.id=ANY($2)) AND ($3='' OR cp.alias ILIKE '%'||$3||'%') ORDER BY cp.created_at DESC,cp.id LIMIT 51 OFFSET $4`,
            [m, scope, q.query, scope ? 0 : q.offset, actor.role === 'platform_admin'],
          )
        ).rows;
        return {
          customers: rows.slice(0, 50),
          nextOffset: rows.length > 50 ? q.offset + 50 : null,
        };
      },
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/customer-outreach/:id/whatsapp', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params),
      { message } = z
        .object({ message: z.string().trim().min(1).max(2000) })
        .strict()
        .parse(req.body);
    return transaction(
      pools.pool,
      async (db) => {
        await access(db, actor, m, id);
        const row = (await db.query('SELECT whatsapp_customer_recipient($1,$2) AS value', [m, id]))
          .rows[0].value;
        await audit(db, actor, 'customer.whatsapp.draft', m, id, {
          mode: 'manual_draft',
          consentRevision: row.revision,
        });
        return { url: whatsapp(row.contact_phone, message), draftOnly: true };
      },
      actor,
    );
  });
  app.post('/api/v1/platform/merchants/:m/whatsapp', async (req) => {
    const actor = authenticated(req);
    platform(actor);
    const { m } = z.object({ m: z.uuid() }).parse(req.params),
      { message } = z
        .object({ message: z.string().trim().min(1).max(2000) })
        .strict()
        .parse(req.body);
    return transaction(
      pools.pool,
      async (db) => {
        const merchant = (await db.query('SELECT contact_phone FROM merchants WHERE id=$1', [m]))
          .rows[0];
        requireCondition(merchant, 'NOT_FOUND', 404);
        requireCondition(merchant.contact_phone, 'WHATSAPP_PHONE_REQUIRED', 409);
        await audit(db, actor, 'merchant.whatsapp.draft', m, m, { mode: 'manual_draft' });
        return { url: whatsapp(merchant.contact_phone, message), draftOnly: true };
      },
      actor,
    );
  });
  app.get('/api/v1/me/merchants/:m/contact', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        const row = (
          await db.query(
            'SELECT customer_contact_state($1,id) AS value FROM tenant_customer_profiles WHERE merchant_id=$1 AND user_id=$2',
            [m, actor.id],
          )
        ).rows[0];
        requireCondition(row, 'NOT_FOUND', 404);
        return { contactPhone: row.value.contactPhone };
      },
      actor,
    );
  });
  app.patch('/api/v1/me/merchants/:m/contact', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      body = z.object({ contactPhone }).strict().parse(req.body);
    return transaction(
      pools.pool,
      async (db) => {
        return (
          await db.query('SELECT set_customer_contact_phone($1,$2,false) AS value', [
            m,
            body.contactPhone,
          ])
        ).rows[0].value;
      },
      actor,
    );
  });
}
