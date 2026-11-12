import {
  requestDecisionInput,
  stampRequestInput,
} from '../../../../packages/contracts/src/commands.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { authenticated } from '../auth.js';
import { audit, transaction, type Pools, type DB, type Actor } from '../db.js';
import { keyedHash, tokenHash, safeEqual } from '../crypto.js';
import { requireCondition } from '../errors.js';
import { idempotencyKey, operation, expectedRevision } from '../operations.js';
import { merchantGrant } from '../policy.js';
import { award } from './loyalty.js';
import { requireEarning } from '../subscriptions.js';
function code(nonce: string, c: Config) {
  return (parseInt(keyedHash('request:' + nonce, c.AUTH_PEPPER).slice(0, 12), 16) % 1_000_000)
    .toString()
    .padStart(6, '0');
}
async function event(db: DB, actor: Actor, mid: string, id: string, action: string) {
  await db.query(
    'INSERT INTO stamp_request_events(merchant_id,request_id,actor_id,action) VALUES($1,$2,$3,$4)',
    [mid, id, actor.id, action],
  );
}
// One place creates a pending request, whichever entry point asked for it.
export async function createStampRequest(
  pools: Pools,
  c: Config,
  actor: Actor,
  p: z.infer<typeof stampRequestInput>,
  key: string,
) {
  const r = await transaction(
    pools.pool,
    async (db) => {
      const ms = (
        await db.query(
          "SELECT ms.* FROM memberships ms WHERE ms.id=$1 AND ms.user_id=$2 AND ms.status='active' FOR SHARE OF ms",
          [p.membershipId, actor.id],
        )
      ).rows[0];
      requireCondition(ms, 'NOT_FOUND', 404);
      await db.query('SELECT customer_merchant_guard($1)', [ms.merchant_id]);
      if (p.placementCode) {
        const placement = (
          await db.query('SELECT resolve_placement($1) AS value', [p.placementCode])
        ).rows[0]?.value;
        requireCondition(placement && placement.status === 'active', 'PLACEMENT_UNAVAILABLE', 410);
        requireCondition(
          placement.branchId === p.branchId &&
            (
              await db.query('SELECT 1 FROM public_merchant_brands WHERE id=$1 AND slug=$2', [
                ms.merchant_id,
                placement.slug,
              ])
            ).rowCount,
          'REQUEST_CONTEXT_MISMATCH',
          422,
        );
      }
      requireCondition(
        (
          await db.query(
            "SELECT 1 FROM public_merchant_brands m JOIN public_merchant_details(m.slug) d ON true WHERE m.id=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(d->'branches') b WHERE b->>'id'=$2::text)",
            [ms.merchant_id, p.branchId],
          )
        ).rowCount,
        'BRANCH_UNAUTHORIZED',
        403,
      );
      return operation(
        db,
        actor,
        { scope: 'request.create', key, payload: p, merchantId: ms.merchant_id },
        async () => {
          await requireEarning(db, ms.merchant_id);
          await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            'request:' + p.membershipId,
          ]);
          await db.query(
            "UPDATE stamp_requests SET status='expired',decided_at=clock_timestamp() WHERE membership_id=$1 AND status='pending' AND expires_at<=clock_timestamp()",
            [p.membershipId],
          );
          const existing = (
            await db.query(
              "SELECT * FROM stamp_requests WHERE membership_id=$1 AND status='pending'",
              [p.membershipId],
            )
          ).rows[0];
          if (existing) {
            requireCondition(existing.branch_id === p.branchId, 'REQUEST_ALREADY_PENDING', 409);
            return {
              id: existing.id,
              nonce: existing.code_nonce,
              expiresAt: existing.expires_at,
              status: 'pending',
            };
          }
          // A customer who cannot collect now does not queue a request for the cashier.
          const verdict = (
            await db.query('SELECT collection_context($1,$2) AS value', [
              p.membershipId,
              p.branchId,
            ])
          ).rows[0].value.eligibility;
          if (!verdict.eligible) return { ineligible: true };
          await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            'request-day:' + ms.merchant_id + ':' + actor.id,
          ]);
          const policy = (
            await db.query('SELECT customer_request_policy($1) AS value', [p.membershipId])
          ).rows[0].value;
          const count = (
            await db.query(
              'SELECT count(*)::int AS n FROM stamp_requests WHERE merchant_id=$1 AND user_id=$2 AND created_at>=$3 AND created_at<$4',
              [ms.merchant_id, actor.id, policy.dayStart, policy.dayEnd],
            )
          ).rows[0].n;
          if (count >= policy.limit) {
            await audit(db, actor, 'request.daily_limit', ms.merchant_id, p.membershipId, {
              branchId: p.branchId,
              limit: policy.limit,
            });
            return { limited: true };
          }
          const nonce = crypto.randomUUID(),
            match = code(nonce, c),
            r = (
              await db.query(
                'INSERT INTO stamp_requests(merchant_id,membership_id,user_id,branch_id,code_nonce,code_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,expires_at',
                [ms.merchant_id, p.membershipId, actor.id, p.branchId, nonce, tokenHash(match)],
              )
            ).rows[0];
          await event(db, actor, ms.merchant_id, r.id, 'created');
          await audit(db, actor, 'request.create', ms.merchant_id, r.id, {
            branchId: p.branchId,
          });
          return { id: r.id, nonce, expiresAt: r.expires_at, status: 'pending' };
        },
      );
    },
    actor,
  );
  requireCondition(!('limited' in r), 'REQUEST_DAILY_LIMIT', 429);
  requireCondition(!('ineligible' in r), 'COLLECTION_LIMIT', 409);
  return { ...r, nonce: undefined, code: code(r.nonce, c) };
}
export function requestsModule(app: FastifyInstance, pools: Pools, c: Config) {
  app.get('/api/v1/merchants/:m/stamp-request-settings', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner']);
        const row = (
          await db.query(
            'SELECT stamp_request_daily_limit AS "dailyLimit",revision FROM merchants WHERE id=$1',
            [m],
          )
        ).rows[0];
        return row;
      },
      actor,
    );
  });
  app.patch('/api/v1/merchants/:m/stamp-request-settings', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      p = z
        .object({ dailyLimit: z.number().int().min(1).max(100) })
        .strict()
        .parse(req.body),
      revision = expectedRevision(req);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner'], undefined, true);
        const row = (
          await db.query(
            'UPDATE merchants SET stamp_request_daily_limit=$2,revision=revision+1 WHERE id=$1 AND revision=$3 RETURNING stamp_request_daily_limit AS "dailyLimit",revision',
            [m, p.dailyLimit, revision],
          )
        ).rows[0];
        requireCondition(row, 'REVISION_CONFLICT', 409);
        await audit(db, actor, 'request.limit.update', m, m, { dailyLimit: p.dailyLimit });
        return row;
      },
      actor,
    );
  });
  app.post('/api/v1/me/stamp-requests', async (req) =>
    createStampRequest(
      pools,
      c,
      authenticated(req),
      stampRequestInput.parse(req.body),
      idempotencyKey(req),
    ),
  );
  app.get('/api/v1/me/stamp-requests', async (req) => {
    const actor = authenticated(req);
    return transaction(
      pools.pool,
      async (db) => ({
        requests: (
          await db.query(
            "SELECT id,merchant_id,membership_id,branch_id,CASE WHEN status='pending' AND expires_at<=clock_timestamp() THEN 'expired' ELSE status END AS status,expires_at,created_at,result,reason,code_nonce FROM stamp_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
            [actor.id],
          )
        ).rows.map((r) => ({
          ...r,
          code_nonce: undefined,
          code: r.status === 'pending' ? code(r.code_nonce, c) : undefined,
        })),
      }),
      actor,
    );
  });
  app.post('/api/v1/me/stamp-requests/:id/cancel', async (req) => {
    const actor = authenticated(req),
      { id } = z.object({ id: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        const r = (
          await db.query('SELECT * FROM stamp_requests WHERE id=$1 AND user_id=$2 FOR UPDATE', [
            id,
            actor.id,
          ])
        ).rows[0];
        requireCondition(r, 'NOT_FOUND', 404);
        if (['cancelled', 'expired'].includes(r.status)) return { status: r.status };
        requireCondition(
          r.status === 'pending',
          r.status === 'expired' ? 'REQUEST_EXPIRED' : 'REQUEST_ALREADY_DECIDED',
          r.status === 'expired' ? 410 : 409,
        );
        const now = (await db.query('SELECT clock_timestamp() AS at')).rows[0].at;
        const status = r.expires_at <= now ? 'expired' : 'cancelled';
        await db.query(
          'UPDATE stamp_requests SET status=$1,decided_at=clock_timestamp(),decided_by=$2 WHERE id=$3',
          [status, actor.id, id],
        );
        if (status === 'cancelled') await event(db, actor, r.merchant_id, id, status);
        return { status };
      },
      actor,
    );
  });
  app.get('/api/v1/merchants/:m/stamp-requests', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      { branchId } = z.object({ branchId: z.uuid() }).parse(req.query);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, undefined, branchId);
        return {
          requests: (
            await db.query(
              "SELECT r.id,r.membership_id,r.branch_id,r.expires_at,r.created_at,r.failed_matches,r.code_nonce,cp.alias,least(v.max_per_tx,CASE WHEN cs.allow_multiple THEN cs.max_stamps_per_collection ELSE cs.default_stamps END) AS max_per_tx,cs.default_stamps,cs.allow_multiple,v.threshold,a.balance FROM stamp_requests r JOIN stamp_collection_settings cs ON cs.merchant_id=r.merchant_id JOIN memberships ms ON ms.id=r.membership_id JOIN tenant_customer_profiles cp ON cp.id=ms.profile_id JOIN program_versions v ON v.id=ms.program_version_id JOIN loyalty_accounts a ON a.membership_id=ms.id WHERE r.merchant_id=$1 AND r.branch_id=$2 AND r.status='pending' AND r.expires_at>clock_timestamp() AND r.failed_matches<5 ORDER BY r.created_at",
              [m, branchId],
            )
          ).rows.map((row) => ({ ...row, code_nonce: undefined, code: code(row.code_nonce, c) })),
        };
      },
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/stamp-requests/:id/decision', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params),
      p = requestDecisionInput.parse(req.body),
      key = idempotencyKey(req);
    const result = await transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, undefined, undefined, true);
        const r = (
          await db.query('SELECT * FROM stamp_requests WHERE merchant_id=$1 AND id=$2 FOR UPDATE', [
            m,
            id,
          ])
        ).rows[0];
        requireCondition(r, 'NOT_FOUND', 404);
        await merchantGrant(db, actor, m, undefined, r.branch_id, true);
        if (p.approve) {
          requireCondition(
            p.award.membershipId === r.membership_id && p.award.branchId === r.branch_id,
            'REQUEST_CONTEXT_MISMATCH',
            422,
          );
          // A committed replay remains retrievable after expiry; fresh keys cannot reuse the request.
          if (r.status !== 'approved') {
            requireCondition(
              r.status === 'pending',
              r.status === 'expired' ? 'REQUEST_EXPIRED' : 'REQUEST_ALREADY_DECIDED',
              r.status === 'expired' ? 410 : 409,
            );
            requireCondition(
              r.expires_at > (await db.query('SELECT clock_timestamp() AS at')).rows[0].at,
              'REQUEST_EXPIRED',
              410,
            );
            requireCondition(r.failed_matches < 5, 'MATCH_ATTEMPTS_EXHAUSTED', 429);
            if (!safeEqual(tokenHash(p.code), r.code_hash)) {
              await db.query(
                'UPDATE stamp_requests SET failed_matches=failed_matches+1 WHERE id=$1',
                [id],
              );
              await event(db, actor, m, id, 'match_failed');
              return { matchFailed: true };
            }
          }
          return award(db, actor, m, key, p.award, 'request', id);
        }
        return operation(
          db,
          actor,
          { scope: 'request.reject:' + id, key, payload: p, merchantId: m },
          async () => {
            requireCondition(
              r.status === 'pending',
              r.status === 'expired' ? 'REQUEST_EXPIRED' : 'REQUEST_ALREADY_DECIDED',
              r.status === 'expired' ? 410 : 409,
            );
            requireCondition(
              r.expires_at > (await db.query('SELECT clock_timestamp() AS at')).rows[0].at,
              'REQUEST_EXPIRED',
              410,
            );
            await db.query(
              "UPDATE stamp_requests SET status='rejected',reason=$1,decided_by=$2,decided_at=clock_timestamp() WHERE id=$3",
              [p.reason, actor.id, id],
            );
            await event(db, actor, m, id, 'rejected');
            await audit(db, actor, 'request.reject', m, id, { reason: p.reason });
            return { status: 'rejected', id };
          },
        );
      },
      actor,
    );
    requireCondition(!('matchFailed' in result), 'MATCH_CODE_INVALID', 422);
    return result;
  });
}
