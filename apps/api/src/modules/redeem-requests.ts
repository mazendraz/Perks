import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomInt } from 'node:crypto';
import {
  redeemRequestInput,
  redeemDecisionInput,
} from '../../../../packages/contracts/src/commands.js';
import { authenticated } from '../auth.js';
import { audit, transaction, type DB, type Pools } from '../db.js';
import type { Config } from '../config.js';
import { requireCondition } from '../errors.js';
import { merchantGrant } from '../policy.js';
import { idempotencyKey, operation } from '../operations.js';
import { tokenHash } from '../crypto.js';
import { webPushConfig } from '../webpush.js';
import { consumeReward } from './rewards.js';

// Redeem by request. The customer taps Redeem on a reward; the branch's staff are rung with the
// customer's first name, the reward and a 2-digit match number; a cashier confirms (the reward is
// handed over and a new card starts) or rejects (the reward stays). No QR and no scan.
//
// A request is a redemption_challenges row with a match number: 'requested' while open, then
// 'completed', 'rejected', 'cancelled' (by the customer) or 'expired'. One open request per reward
// (a unique index), 10 minutes to decide.
const REQUEST_MINUTES = 10;
const now = async (db: DB) => (await db.query('SELECT clock_timestamp() AS at')).rows[0].at as Date;
// What either side shows for one request. A request past its time reads as expired before anyone
// writes that down.
const requestColumns =
  "ch.id,ch.merchant_id,ch.reward_id,ch.membership_id,ch.branch_id,CASE WHEN ch.status='requested' AND ch.expires_at<=clock_timestamp() THEN 'expired' ELSE ch.status END AS status,ch.match_number,ch.expires_at,ch.created_at,ch.decided_at,g.title,g.terms";

export function redeemRequestsModule(app: FastifyInstance, pools: Pools, c: Config) {
  // The customer asks to redeem one of their rewards.
  app.post('/api/v1/me/rewards/:r/redeem-requests', async (req) => {
    const actor = authenticated(req),
      { r } = z.object({ r: z.uuid() }).parse(req.params),
      p = redeemRequestInput.parse(req.body ?? {}),
      key = idempotencyKey(req);
    const result = await transaction(
      pools.pool,
      async (db) => {
        const owned = (
          await db.query(
            "SELECT g.merchant_id,g.membership_id FROM reward_grants g JOIN memberships ms ON ms.id=g.membership_id AND ms.merchant_id=g.merchant_id WHERE g.id=$1 AND ms.user_id=$2 AND ms.status='active'",
            [r, actor.id],
          )
        ).rows[0];
        requireCondition(owned, 'NOT_FOUND', 404);
        await db.query('SELECT customer_merchant_guard($1)', [owned.merchant_id]);
        return operation(
          db,
          actor,
          { scope: 'redeem.request:' + r, key, payload: { r, ...p }, merchantId: owned.merchant_id },
          async () => {
            // Blocked at this shop: no request and no push. The try is counted on the Spam list and
            // the answer stays neutral, as for a blocked scan.
            if (
              (await db.query('SELECT note_blocked_attempt($1) AS hit', [owned.merchant_id])).rows[0]
                .hit
            )
              return { refused: 'blocked' as const };
            // Two taps on one reward queue here; the unique open-request index backs this up.
            await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
              'redeem-request:' + r,
            ]);
            const reward = (await db.query('SELECT * FROM reward_grants WHERE id=$1', [r])).rows[0];
            const at = await now(db);
            if (reward.status !== 'available') return { refused: 'unavailable' as const };
            if (reward.expires_at <= at) return { refused: 'expired' as const };
            await db.query(
              "UPDATE redemption_challenges SET status='expired' WHERE reward_id=$1 AND status IN ('requested','awaiting_holder','confirmed') AND expires_at<=clock_timestamp()",
              [r],
            );
            const open = (
              await db.query(
                "SELECT id,status,match_number,expires_at FROM redemption_challenges WHERE reward_id=$1 AND status IN ('requested','awaiting_holder','confirmed')",
                [r],
              )
            ).rows[0];
            // Tapping Redeem again while waiting shows the same request and rings nobody twice.
            if (open?.status === 'requested')
              return {
                id: open.id as string,
                matchNumber: open.match_number as number,
                expiresAt: open.expires_at as Date,
                status: 'requested',
              };
            // A cashier is redeeming it at the till right now (the older scan flow).
            if (open) return { refused: 'active' as const };
            // The same limit as a scan at this shop: 6 in 10 minutes, 30 a day.
            if (
              !(await db.query('SELECT scan_attempt_allowed($1) AS ok', [owned.merchant_id])).rows[0]
                .ok
            )
              return { refused: 'rate_limited' as const };
            // The branch the customer came through, when it can hand this reward over; otherwise
            // every branch that can is rung.
            const branchId =
              p.branchId &&
              (
                await db.query(
                  "SELECT reward_redeemable_at(g,$2) AS ok FROM reward_grants g WHERE g.id=$1 AND EXISTS(SELECT 1 FROM branches WHERE id=$2 AND merchant_id=g.merchant_id AND status='active')",
                  [r, p.branchId],
                )
              ).rows[0]?.ok
                ? p.branchId
                : null;
            const match = randomInt(10, 100),
              row = (
                await db.query(
                  `INSERT INTO redemption_challenges(merchant_id,reward_id,membership_id,branch_id,holder_user_id,code_hash,match_number,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,'requested',clock_timestamp()+interval '${REQUEST_MINUTES} minutes') RETURNING id,expires_at`,
                  [
                    owned.merchant_id,
                    r,
                    owned.membership_id,
                    branchId,
                    actor.id,
                    tokenHash(String(match)),
                    match,
                  ],
                )
              ).rows[0];
            await audit(db, actor, 'redeem_request.create', owned.merchant_id, r, {
              requestId: row.id,
              branchId,
            });
            // Same transaction as the request: a request that rolls back rings no phone.
            if (webPushConfig(c))
              await db.query('SELECT enqueue_redeem_request_push($1)', [row.id]);
            return {
              id: row.id as string,
              matchNumber: match,
              expiresAt: row.expires_at as Date,
              status: 'requested',
            };
          },
        );
      },
      actor,
    );
    if ('refused' in result) {
      requireCondition(result.refused !== 'rate_limited', 'RATE_LIMITED', 429);
      requireCondition(result.refused !== 'expired', 'REWARD_EXPIRED', 410);
      requireCondition(result.refused !== 'active', 'CHALLENGE_ACTIVE', 409);
      requireCondition(false, 'REWARD_UNAVAILABLE', 409);
    }
    return result;
  });
  // The customer's recent requests (open, and decided in the last hour so the screen can say how
  // it went).
  app.get('/api/v1/me/redeem-requests', async (req) => {
    const actor = authenticated(req);
    return transaction(
      pools.pool,
      async (db) => ({
        requests: (
          await db.query(
            `SELECT ${requestColumns} FROM redemption_challenges ch JOIN reward_grants g ON g.id=ch.reward_id AND g.merchant_id=ch.merchant_id WHERE ch.holder_user_id=$1 AND ch.match_number IS NOT NULL AND ch.created_at>clock_timestamp()-interval '1 hour' ORDER BY ch.created_at DESC LIMIT 20`,
            [actor.id],
          )
        ).rows,
      }),
      actor,
    );
  });
  // The customer changed their mind while waiting.
  app.post('/api/v1/me/redeem-requests/:id/cancel', async (req) => {
    const actor = authenticated(req),
      { id } = z.object({ id: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        const ch = (
          await db.query(
            'SELECT * FROM redemption_challenges WHERE id=$1 AND holder_user_id=$2 AND match_number IS NOT NULL FOR UPDATE',
            [id, actor.id],
          )
        ).rows[0];
        requireCondition(ch, 'NOT_FOUND', 404);
        if (ch.status !== 'requested') return { status: ch.status as string };
        const status = ch.expires_at <= (await now(db)) ? 'expired' : 'cancelled';
        await db.query('UPDATE redemption_challenges SET status=$1 WHERE id=$2', [status, id]);
        if (status === 'cancelled')
          await audit(db, actor, 'redeem_request.cancel', ch.merchant_id, ch.reward_id, {
            requestId: id,
          });
        return { status };
      },
      actor,
    );
  });
  // Open requests a cashier at this branch can decide.
  app.get('/api/v1/merchants/:m/redeem-requests', async (req) => {
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
              `SELECT ${requestColumns},cp.alias FROM redemption_challenges ch JOIN reward_grants g ON g.id=ch.reward_id AND g.merchant_id=ch.merchant_id AND g.status='available' JOIN memberships ms ON ms.id=ch.membership_id AND ms.merchant_id=ch.merchant_id JOIN tenant_customer_profiles cp ON cp.id=ms.profile_id AND cp.merchant_id=ms.merchant_id WHERE ch.merchant_id=$1 AND ch.status='requested' AND ch.expires_at>clock_timestamp() AND (ch.branch_id IS NULL OR ch.branch_id=$2) AND reward_redeemable_at(g,$2) AND NOT customer_blocked(ch.merchant_id,ch.holder_user_id) ORDER BY ch.created_at`,
              [m, branchId],
            )
          ).rows,
        };
      },
      actor,
    );
  });
  // One request, for the screen its notification opens.
  app.get('/api/v1/merchants/:m/redeem-requests/:id', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m);
        const row = (
          await db.query(
            `SELECT ${requestColumns},cp.alias,g.status AS reward_status,a.cycle_number,customer_blocked(ch.merchant_id,ch.holder_user_id) AS blocked FROM redemption_challenges ch JOIN reward_grants g ON g.id=ch.reward_id AND g.merchant_id=ch.merchant_id JOIN memberships ms ON ms.id=ch.membership_id AND ms.merchant_id=ch.merchant_id JOIN tenant_customer_profiles cp ON cp.id=ms.profile_id AND cp.merchant_id=ms.merchant_id JOIN loyalty_accounts a ON a.membership_id=ms.id WHERE ch.merchant_id=$1 AND ch.id=$2 AND ch.match_number IS NOT NULL`,
            [m, id],
          )
        ).rows[0];
        requireCondition(row, 'NOT_FOUND', 404);
        return { request: row };
      },
      actor,
    );
  });
  // Confirm (the reward is handed over, once) or reject (the reward stays).
  app.post('/api/v1/merchants/:m/redeem-requests/:id/decision', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params),
      p = redeemDecisionInput.parse(req.body),
      key = idempotencyKey(req);
    const result = await transaction(
      pools.pool,
      async (db) => {
        const initial = (
          await db.query(
            'SELECT * FROM redemption_challenges WHERE merchant_id=$1 AND id=$2 AND match_number IS NOT NULL',
            [m, id],
          )
        ).rows[0];
        requireCondition(initial, 'NOT_FOUND', 404);
        const staff = await merchantGrant(
          db,
          actor,
          m,
          ['owner', 'manager', 'cashier'],
          p.branchId,
          true,
        );
        return operation(
          db,
          actor,
          {
            scope: 'redeem.decision:' + id,
            key,
            payload: { id, approve: p.approve, branchId: p.branchId },
            merchantId: m,
          },
          async (operationId) => {
            // Card, reward, request: the same lock order as every other redemption, so two cashiers
            // tapping Confirm at once queue here and the second finds the reward already used.
            await db.query(
              'SELECT membership_id FROM loyalty_accounts WHERE membership_id=$1 FOR UPDATE',
              [initial.membership_id],
            );
            const reward = (
              await db.query(
                'SELECT * FROM reward_grants WHERE merchant_id=$1 AND id=$2 FOR UPDATE',
                [m, initial.reward_id],
              )
            ).rows[0];
            const ch = (
              await db.query('SELECT * FROM redemption_challenges WHERE id=$1 FOR UPDATE', [id])
            ).rows[0];
            const at = await now(db);
            if (ch.status === 'completed' || reward.status === 'redeemed')
              return { refused: 'used' as const };
            if (ch.status !== 'requested') return { refused: 'closed' as const };
            if (ch.expires_at <= at) {
              await db.query("UPDATE redemption_challenges SET status='expired' WHERE id=$1", [id]);
              return { refused: 'expired' as const };
            }
            const decided = [p.branchId, staff.id, actor.id, actor.sessionId, id];
            if (!p.approve) {
              await db.query(
                "UPDATE redemption_challenges SET status='rejected',branch_id=$1,staff_id=$2,cashier_user_id=$3,cashier_session_id=$4,decided_at=clock_timestamp() WHERE id=$5",
                decided,
              );
              await audit(db, actor, 'redeem_request.reject', m, reward.id, {
                requestId: id,
                branchId: p.branchId,
              });
              return { status: 'rejected', requestId: id, rewardId: reward.id as string };
            }
            if (reward.status !== 'available') return { refused: 'unavailable' as const };
            if (reward.expires_at <= at) return { refused: 'reward_expired' as const };
            if (
              (
                await db.query('SELECT customer_blocked($1,$2) AS blocked', [
                  m,
                  ch.holder_user_id,
                ])
              ).rows[0].blocked
            )
              return { refused: 'unavailable' as const };
            if (
              !(
                await db.query(
                  'SELECT reward_redeemable_at(r,$2) AS ok FROM reward_grants r WHERE r.id=$1',
                  [reward.id, p.branchId],
                )
              ).rows[0].ok
            )
              return { refused: 'branch' as const };
            await db.query(
              'UPDATE redemption_challenges SET branch_id=$1,staff_id=$2,cashier_user_id=$3,cashier_session_id=$4,decided_at=clock_timestamp(),confirmed_at=clock_timestamp() WHERE id=$5',
              decided,
            );
            return {
              ...(await consumeReward(db, actor, {
                merchantId: m,
                reward,
                challengeId: id,
                holderUserId: ch.holder_user_id,
                branchId: p.branchId,
                staffId: staff.id,
                operationId,
                committedAt: at,
                auditDetail: { requestId: id },
              })),
              requestId: id,
            };
          },
        );
      },
      actor,
    );
    if ('refused' in result) {
      requireCondition(result.refused !== 'used', 'REWARD_ALREADY_USED', 409);
      requireCondition(result.refused !== 'expired', 'CHALLENGE_EXPIRED', 410);
      requireCondition(result.refused !== 'reward_expired', 'REWARD_EXPIRED', 410);
      requireCondition(result.refused !== 'branch', 'REWARD_BRANCH_UNAUTHORIZED', 403);
      requireCondition(result.refused !== 'closed', 'CHALLENGE_FINAL', 409);
      requireCondition(false, 'REWARD_UNAVAILABLE', 409);
    }
    return result;
  });
}
