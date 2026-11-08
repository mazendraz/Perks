import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticated } from '../auth.js';
import { audit, transaction, type Pools } from '../db.js';
import { merchantGrant, platform } from '../policy.js';
import { requireCondition } from '../errors.js';
import { operation, idempotencyKey, expectedRevision } from '../operations.js';
import { planLimits } from '../../../../packages/contracts/src/provisioning.js';
export function administrationModule(app: FastifyInstance, pools: Pools) {
  app.get('/api/v1/merchants/:m/branches', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner', 'manager']);
        return {
          branches: (
            await db.query('SELECT * FROM branches WHERE merchant_id=$1 ORDER BY name', [m])
          ).rows,
        };
      },
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/branches', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      p = z
        .object({
          name: z.string().trim().min(2).max(100),
          address: z.string().trim().max(500).default(''),
        })
        .strict()
        .parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner'], undefined, true);
        return operation(
          db,
          actor,
          { scope: 'branch.create:' + m, key, payload: p, merchantId: m },
          async () => {
            const b = (
              await db.query('SELECT create_merchant_branch($1,$2,$3) AS branch', [
                m,
                p.name,
                p.address,
              ])
            ).rows[0].branch;
            await audit(db, actor, 'branch.create', m, b.id);
            return { branch: b };
          },
        );
      },
      actor,
    );
  });
  app.patch('/api/v1/merchants/:m/branches/:id', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params),
      p = z
        .object({
          name: z.string().trim().min(2).max(100),
          address: z.string().trim().max(500),
          status: z.enum(['active', 'disabled']),
          reason: z.string().trim().min(4).max(500),
        })
        .strict()
        .parse(req.body),
      revision = expectedRevision(req);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner']);
        await db.query('SELECT id FROM merchants WHERE id=$1 FOR UPDATE', [m]);
        if (p.status === 'disabled')
          requireCondition(
            Number(
              (
                await db.query(
                  "SELECT count(*) AS n FROM branches WHERE merchant_id=$1 AND status='active' AND id<>$2",
                  [m, id],
                )
              ).rows[0].n,
            ) > 0,
            'LAST_ACTIVE_BRANCH',
            409,
          );
        const b = (
          await db.query(
            'UPDATE branches SET name=$1,address=$2,status=$3,revision=revision+1 WHERE merchant_id=$4 AND id=$5 AND revision=$6 RETURNING *',
            [p.name, p.address, p.status, m, id, revision],
          )
        ).rows[0];
        requireCondition(b, 'REVISION_CONFLICT', 409);
        await audit(db, actor, 'branch.update', m, id, { reason: p.reason, status: p.status });
        return { branch: b };
      },
      actor,
    );
  });
  app.patch('/api/v1/platform/merchants/:m/entitlements', async (req) => {
    const actor = authenticated(req);
    platform(actor);
    const { m } = z.object({ m: z.uuid() }).parse(req.params),
      p = z
        .object({
          plan: z.enum(['starter', 'growth', 'pro']),
          reason: z.string().trim().min(4).max(500),
        })
        .strict()
        .parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) =>
        operation(
          db,
          actor,
          { scope: 'entitlements.update:' + m, key, payload: p, merchantId: m },
          async () => {
            const limits = planLimits[p.plan];
            await db.query('SELECT * FROM feature_entitlements WHERE merchant_id=$1 FOR UPDATE', [
              m,
            ]);
            const used = (
              await db.query(
                "SELECT (SELECT count(*) FROM branches WHERE merchant_id=$1) AS branches,(SELECT count(*) FROM staff_memberships WHERE merchant_id=$1)+(SELECT count(*) FROM invitations WHERE merchant_id=$1 AND status='pending' AND expires_at>now()) AS staff,(SELECT count(*) FROM programs WHERE merchant_id=$1 AND status='active') AS programs,(SELECT count(*) FROM tenant_customer_profiles WHERE merchant_id=$1) AS customers",
                [m],
              )
            ).rows[0];
            requireCondition(
              Number(used.branches) <= limits.branches &&
                Number(used.staff) <= limits.staff &&
                Number(used.programs) <= limits.programs &&
                Number(used.customers) <= limits.customers,
              'DOWNGRADE_OVER_USAGE',
              409,
            );
            const row = (
              await db.query(
                'UPDATE feature_entitlements SET plan=$1,max_branches=$2,max_staff=$3,max_programs=$4,max_customers=$5,reason=$6,revision=revision+1 WHERE merchant_id=$7 RETURNING *',
                [
                  p.plan,
                  limits.branches,
                  limits.staff,
                  limits.programs,
                  limits.customers,
                  p.reason,
                  m,
                ],
              )
            ).rows[0];
            requireCondition(row, 'NOT_FOUND', 404);
            await audit(db, actor, 'entitlements.update', m, m, { plan: p.plan, reason: p.reason });
            return { entitlements: row };
          },
        ),
      actor,
    );
  });
}
