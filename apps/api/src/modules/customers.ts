import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Config } from '../config.js';
import { authenticated } from '../auth.js';
import { audit, transaction, type Pools } from '../db.js';
import { merchantGrant } from '../policy.js';
import { idempotencyKey, operation } from '../operations.js';
import { emitOutbox } from '../outbox.js';
import { requireCondition } from '../errors.js';
const filters = z.object({
  branchId: z.uuid().optional(),
  segment: z.enum(['all', 'active', 'inactive', 'never_active']).default('all'),
  query: z.string().trim().max(80).optional(),
});
export function customersModule(app: FastifyInstance, pools: Pools, c: Config) {
  app.get('/api/v1/merchants/:m/customers', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      q = filters
        .extend({
          offset: z.coerce.number().int().min(0).max(100000).default(0),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        })
        .parse(req.query);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner', 'manager']);
        const rows = (
          await db.query('SELECT search_customer_directory($1,$2,$3,$6,$4,$5) AS customer', [
            m,
            q.branchId || null,
            q.segment,
            q.limit + 1,
            q.offset,
            q.query || '',
          ])
        ).rows.map((r) => r.customer);
        return {
          customers: rows.slice(0, q.limit),
          nextOffset: rows.length > q.limit ? q.offset + q.limit : null,
          updatedAt: new Date(),
          definitions: {
            segment:
              'Active: purchase within 30 days; inactive: earlier purchase; never_active: no confirmed purchase. All calculations use the authorized branch scope.',
          },
        };
      },
      actor,
    );
  });
  app.get('/api/v1/merchants/:m/customers/:id', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params),
      q = z.object({ branchId: z.uuid().optional() }).parse(req.query);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner', 'manager']);
        const customer = (
          await db.query("SELECT customer_directory($1,$2,'all',$3,1,0) AS customer", [
            m,
            q.branchId || null,
            id,
          ])
        ).rows[0]?.customer;
        requireCondition(customer, 'NOT_FOUND', 404);
        return {
          customer,
          memberships: (
            await db.query(
              'SELECT ms.id,p.name,v.threshold,a.balance,a.revision,ms.status FROM memberships ms JOIN programs p ON p.id=ms.program_id JOIN program_versions v ON v.id=ms.program_version_id JOIN loyalty_accounts a ON a.membership_id=ms.id WHERE ms.profile_id=$1 AND ms.merchant_id=$2 AND (($3::uuid IS NULL AND owner_full_customer_scope($2)) OR (branch_access($2,ms.origin_branch_id) AND ($3::uuid IS NULL OR ms.origin_branch_id=$3)) OR EXISTS(SELECT 1 FROM loyalty_transactions t WHERE t.membership_id=ms.id AND branch_access($2,t.branch_id) AND ($3::uuid IS NULL OR t.branch_id=$3)))',
              [id, m, q.branchId || null],
            )
          ).rows,
          activity: (
            await db.query(
              'SELECT t.public_reference,t.type,t.quantity,t.at,t.branch_id FROM loyalty_transactions t JOIN memberships ms ON ms.id=t.membership_id WHERE ms.profile_id=$1 AND branch_access(t.merchant_id,t.branch_id) AND ($2::uuid IS NULL OR t.branch_id=$2) ORDER BY t.at DESC LIMIT 100',
              [id, q.branchId || null],
            )
          ).rows,
        };
      },
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/customer-exports', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      p = filters.strict().parse(req.body),
      key = idempotencyKey(req);
    requireCondition(
      ['development', 'test'].includes(c.APP_ENV),
      'OBJECT_STORAGE_NOT_CONFIGURED',
      503,
    );
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner'], p.branchId);
        return operation(
          db,
          actor,
          { scope: 'customer.export:' + m, key, payload: p, merchantId: m },
          async () => {
            const ex = (
              await db.query(
                'INSERT INTO customer_exports(merchant_id,requested_by,branch_id,segment,search_query,scope_fingerprint) VALUES($1,$2,$3,$4,$5,customer_scope_fingerprint($1,$3)) RETURNING id,status,expires_at',
                [m, actor.id, p.branchId || null, p.segment, p.query || ''],
              )
            ).rows[0];
            await emitOutbox(db, {
              merchantId: m,
              eventType: 'customer.export.requested',
              aggregateId: ex.id,
              payload: { exportId: ex.id },
              dedupeKey: 'export:' + ex.id,
              kind: 'customer_export',
            });
            await audit(db, actor, 'customer.export.request', m, ex.id, {
              segment: p.segment,
              branchId: p.branchId || null,
            });
            return { export: ex };
          },
        );
      },
      actor,
    );
  });
  app.get('/api/v1/merchants/:m/customer-exports', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner']);
        return {
          exports: (
            await db.query(
              "SELECT id,CASE WHEN status='ready' AND scope_fingerprint IS DISTINCT FROM customer_scope_fingerprint(merchant_id,branch_id) THEN 'scope_changed' ELSE status END AS status,row_count,error_code,created_at,expires_at,segment,branch_id FROM customer_exports WHERE merchant_id=$1 AND requested_by=$2 ORDER BY created_at DESC LIMIT 30",
              [m, actor.id],
            )
          ).rows,
        };
      },
      actor,
    );
  });
  app.get('/api/v1/merchants/:m/customer-exports/:id/download', async (req, reply) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params);
    const ex = await transaction(
      pools.pool,
      async (db) => {
        const ex = (
          await db.query(
            "SELECT * FROM customer_exports WHERE merchant_id=$1 AND id=$2 AND requested_by=$3 AND status='ready' AND expires_at>clock_timestamp()",
            [m, id, actor.id],
          )
        ).rows[0];
        requireCondition(ex, 'NOT_FOUND', 404);
        await merchantGrant(db, actor, m, ['owner'], ex.branch_id || undefined);
        requireCondition(
          ex.scope_fingerprint &&
            (await db.query('SELECT customer_scope_fingerprint($1,$2) AS value', [m, ex.branch_id]))
              .rows[0].value === ex.scope_fingerprint,
          'EXPORT_SCOPE_CHANGED',
          403,
        );
        await audit(db, actor, 'customer.export.download', m, id);
        return ex;
      },
      actor,
    );
    requireCondition(
      typeof ex.storage_key === 'string' &&
        ex.storage_key.startsWith(m + '/' + id + '-') &&
        ex.storage_key.endsWith('.csv') &&
        z.uuid().safeParse(ex.storage_key.slice(m.length + id.length + 2, -4)).success,
      'NOT_FOUND',
      404,
    );
    return reply
      .header('Content-Disposition', 'attachment; filename="nuqta-customers.csv"')
      .type('text/csv; charset=utf-8')
      .header('X-Content-Type-Options', 'nosniff')
      .send(await readFile(resolve('.local/exports', ex.storage_key)));
  });
  app.get('/api/v1/merchants/:m/segments', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner', 'manager']);
        return {
          segments: (
            await db.query(
              'SELECT id,name,branch_id,segment,search_query AS query FROM saved_segments WHERE merchant_id=$1 AND created_by=$2 ORDER BY created_at DESC',
              [m, actor.id],
            )
          ).rows,
        };
      },
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/segments', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      p = filters
        .extend({ name: z.string().trim().min(2).max(80) })
        .strict()
        .parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner', 'manager'], p.branchId);
        return operation(
          db,
          actor,
          { scope: 'segment.save:' + m, key, payload: p, merchantId: m },
          async () => ({
            segment: (
              await db.query(
                'INSERT INTO saved_segments(merchant_id,created_by,name,branch_id,segment,search_query) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,branch_id,segment',
                [m, actor.id, p.name, p.branchId || null, p.segment, p.query || ''],
              )
            ).rows[0],
          }),
        );
      },
      actor,
    );
  });
}
