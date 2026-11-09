import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticated } from '../auth.js';
import { transaction, type Pools } from '../db.js';
import { merchantGrant } from '../policy.js';
import { operation, idempotencyKey } from '../operations.js';
import { requireCondition } from '../errors.js';
export const experienceInput = z
  .object({
    membershipId: z.uuid(),
    branchId: z.uuid(),
    placementCode: z.string().min(20).max(80),
    elapsedMs: z.number().int().min(0).max(600000),
  })
  .strict();
export function experienceModule(app: FastifyInstance, pools: Pools) {
  app.post('/api/v1/me/experience', async (req) => {
    const actor = authenticated(req),
      p = experienceInput.parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        const member = (
          await db.query('SELECT merchant_id FROM memberships WHERE id=$1 AND user_id=$2', [
            p.membershipId,
            actor.id,
          ])
        ).rows[0];
        requireCondition(member, 'NOT_FOUND', 404);
        const placement = (
          await db.query('SELECT resolve_placement($1) AS value', [p.placementCode])
        ).rows[0]?.value;
        requireCondition(
          placement?.status === 'active' &&
            placement.branchId === p.branchId &&
            (
              await db.query('SELECT 1 FROM public_merchant_brands WHERE id=$1 AND slug=$2', [
                member.merchant_id,
                placement.slug,
              ])
            ).rowCount,
          'PLACEMENT_UNAVAILABLE',
          410,
        );
        // First observed duration wins; a retried timing sample must not rewrite it.
        const { elapsedMs, ...identity } = p;
        return operation(
          db,
          actor,
          { scope: 'experience.card_open', key, payload: identity, merchantId: member.merchant_id },
          async (operationId) => {
            await db.query(
              'INSERT INTO customer_experience_events(merchant_id,membership_id,branch_id,operation_id,elapsed_ms) VALUES($1,$2,$3,$4,$5)',
              [member.merchant_id, p.membershipId, p.branchId, operationId, elapsedMs],
            );
            return { recorded: true };
          },
        );
      },
      actor,
    );
  });
  app.get('/api/v1/merchants/:m/experience', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      q = z
        .object({
          days: z.coerce.number().int().min(1).max(90).default(30),
          branchId: z.uuid().optional(),
        })
        .strict()
        .parse(req.query);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner', 'manager'], q.branchId);
        const card = (
          await db.query(
            "SELECT count(*)::int AS samples,round((percentile_cont(.95) WITHIN GROUP(ORDER BY elapsed_ms))::numeric)::int AS p95_ms FROM customer_experience_events WHERE merchant_id=$1 AND branch_access(merchant_id,branch_id) AND ($2::uuid IS NULL OR branch_id=$2) AND at>=clock_timestamp()-$3*interval '1 day'",
            [m, q.branchId ?? null, q.days],
          )
        ).rows[0];
        const requests = (
          await db.query(
            "SELECT count(*)::int AS total,count(*) FILTER(WHERE status='approved')::int AS approved,count(*) FILTER(WHERE status IN ('rejected','cancelled','expired') OR (status='pending' AND expires_at<=clock_timestamp()))::int AS closed_without_approval,round((percentile_cont(.95) WITHIN GROUP(ORDER BY extract(epoch FROM decided_at-created_at)*1000) FILTER(WHERE status='approved'))::numeric)::int AS approval_p95_ms FROM stamp_requests WHERE merchant_id=$1 AND branch_access(merchant_id,branch_id) AND ($2::uuid IS NULL OR branch_id=$2) AND created_at>=clock_timestamp()-$3*interval '1 day'",
            [m, q.branchId ?? null, q.days],
          )
        ).rows[0];
        const anomalies = (
          await db.query(
            "SELECT count(*)::int AS n FROM audit_events WHERE merchant_id=$1 AND action='request.daily_limit' AND branch_access(merchant_id,(detail->>'branchId')::uuid) AND ($2::uuid IS NULL OR detail->>'branchId'=$2::text) AND at>=clock_timestamp()-$3*interval '1 day'",
            [m, q.branchId ?? null, q.days],
          )
        ).rows[0].n;
        return {
          cardOpen: { samples: card.samples, p95Ms: card.p95_ms },
          requests: {
            ...requests,
            closedWithoutApprovalRate:
              requests.approved + requests.closed_without_approval
                ? Math.round(
                    (1000 * requests.closed_without_approval) /
                      (requests.approved + requests.closed_without_approval),
                  ) / 10
                : null,
          },
          dailyLimitAttempts: anomalies,
          definitions: {
            cardOpen:
              'Client-reported scan-to-card duration; not a purchase or a verified performance SLO.',
            approval: 'Server time from request creation to committed cashier approval.',
            closedWithoutApproval:
              'Rejected, cancelled or expired requests, divided by all decided or expired requests. Pending requests are excluded.',
          },
        };
      },
      actor,
    );
  });
}
