import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  autoCollectBlockInput,
  autoStampRevokeInput,
  cardResetInput,
} from '../../../../packages/contracts/src/commands.js';
import { authenticated } from '../auth.js';
import { audit, transaction, type Pools } from '../db.js';
import { requireCondition } from '../errors.js';
import { expectedRevision, idempotencyKey, operation } from '../operations.js';
import { emitOutbox } from '../outbox.js';
import { merchantGrant } from '../policy.js';

// Automatic and welcome stamps given at one branch, newest first. Branch scope is enforced twice:
// the caller must hold a grant for the branch, and every row is filtered with branch_access().
// "revocableUntil" is for this caller's role and is null once the stamp can no longer be revoked.
export const AUTO_STAMP_FEED_SQL = `SELECT t.id AS "transactionId",t.public_reference AS reference,t.membership_id AS "membershipId",
 p.alias,t.at,t.quantity,t.source,
 (SELECT sum(b.amount)::int FROM ledger_entries b WHERE b.membership_id=t.membership_id
   AND b.sequence<=(SELECT max(e.sequence) FROM ledger_entries e WHERE e.transaction_id=t.id)) AS "balanceAfter",
 EXISTS(SELECT 1 FROM reward_grants r WHERE r.earned_transaction_id=t.id) AS "rewardEarned",
 EXISTS(SELECT 1 FROM correction_requests c WHERE c.original_transaction_id=t.id AND c.status='applied') AS revoked,
 CASE WHEN EXISTS(SELECT 1 FROM correction_requests c WHERE c.original_transaction_id=t.id AND c.status='applied')
   OR EXISTS(SELECT 1 FROM loyalty_transactions r WHERE r.membership_id=t.membership_id AND r.source='reset' AND r.sequence>t.sequence)
   OR ($4::boolean AND EXISTS(SELECT 1 FROM reward_grants r WHERE r.earned_transaction_id=t.id AND r.status='redeemed'))
   OR t.at+(CASE WHEN $4::boolean THEN s.revoke_window_minutes*interval '1 minute' ELSE interval '7 days' END)<=clock_timestamp()
  THEN NULL ELSE t.at+(CASE WHEN $4::boolean THEN s.revoke_window_minutes*interval '1 minute' ELSE interval '7 days' END) END AS "revocableUntil"
FROM loyalty_transactions t JOIN memberships ms ON ms.id=t.membership_id AND ms.merchant_id=t.merchant_id
 JOIN tenant_customer_profiles p ON p.id=ms.profile_id AND p.merchant_id=ms.merchant_id
 JOIN stamp_collection_settings s ON s.merchant_id=t.merchant_id
WHERE t.merchant_id=$1 AND t.branch_id=$2 AND branch_access($1,t.branch_id)
 AND t.type='award' AND t.source IN ('auto','welcome') AND t.at>=$3
ORDER BY t.sequence DESC LIMIT 100`;

// Staff tools for stamps nobody approved. The rules (window, branch, redeemed rewards, revision)
// live in the database functions; the checks here give the usual 403/404 answers first.
export function cardCorrectionsModule(app: FastifyInstance, pools: Pools) {
  app.get('/api/v1/merchants/:m/auto-stamps', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      q = z
        .object({
          branchId: z.uuid(),
          since: z.iso.datetime({ offset: true }).optional(),
        })
        .parse(req.query);
    return transaction(
      pools.pool,
      async (db) => {
        const staff = await merchantGrant(
          db,
          actor,
          m,
          ['owner', 'manager', 'cashier'],
          q.branchId,
        );
        // At most the last 7 days (the longest anyone can revoke); 12 hours when not asked.
        const now = (await db.query('SELECT clock_timestamp() AS at')).rows[0].at as Date,
          floor = now.getTime() - 7 * 86_400_000,
          since = new Date(
            Math.max(floor, q.since ? Date.parse(q.since) : now.getTime() - 12 * 3_600_000),
          );
        return {
          serverTime: now,
          stamps: (
            await db.query(AUTO_STAMP_FEED_SQL, [m, q.branchId, since, staff.role === 'cashier'])
          ).rows,
        };
      },
      actor,
    );
  });

  app.post('/api/v1/merchants/:m/auto-stamps/:txId/revoke', async (req) => {
    const actor = authenticated(req),
      { m, txId } = z.object({ m: z.uuid(), txId: z.uuid() }).parse(req.params),
      body = autoStampRevokeInput.parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        const original = (
          await db.query(
            'SELECT id,branch_id,membership_id FROM loyalty_transactions WHERE merchant_id=$1 AND id=$2',
            [m, txId],
          )
        ).rows[0];
        requireCondition(original, 'NOT_FOUND', 404);
        await merchantGrant(
          db,
          actor,
          m,
          ['owner', 'manager', 'cashier'],
          original.branch_id,
          true,
        );
        return operation(
          db,
          actor,
          { scope: 'auto-stamp.revoke:' + txId, key, payload: body, merchantId: m },
          async (operationId) => {
            const result = (
              await db.query('SELECT revoke_auto_stamp($1,$2,$3) AS value', [
                txId,
                operationId,
                body.reason,
              ])
            ).rows[0].value as Record<string, unknown> & {
              correctionId: string;
              transactionId: string;
              accountRevision: number;
              voidedRewards: string[];
            };
            await audit(db, actor, 'auto-stamp.revoke', m, txId, {
              membershipId: original.membership_id,
              branchId: original.branch_id,
              correctionId: result.correctionId,
              compensatingTransactionId: result.transactionId,
              voidedRewards: result.voidedRewards,
              reason: body.reason,
            });
            await emitOutbox(db, {
              merchantId: m,
              eventType: 'loyalty.corrected',
              aggregateId: original.membership_id,
              revision: result.accountRevision,
              payload: { transactionId: result.transactionId },
              dedupeKey: 'correction:' + result.correctionId,
              kind: 'domain_event',
            });
            return result;
          },
        );
      },
      actor,
    );
  });

  app.post('/api/v1/merchants/:m/memberships/:id/reset', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params),
      body = cardResetInput.parse(req.body),
      revision = expectedRevision(req),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        requireCondition(
          (await db.query('SELECT 1 FROM memberships WHERE merchant_id=$1 AND id=$2', [m, id]))
            .rowCount,
          'NOT_FOUND',
          404,
        );
        await merchantGrant(db, actor, m, ['owner', 'manager'], undefined, true);
        return operation(
          db,
          actor,
          {
            scope: 'card.reset:' + id,
            key,
            payload: { ...body, revision },
            merchantId: m,
          },
          async (operationId) => {
            const result = (
              await db.query('SELECT reset_card($1,$2,$3,$4,$5) AS value', [
                id,
                operationId,
                body.reason,
                revision,
                body.blockAutoCollect,
              ])
            ).rows[0].value as Record<string, unknown> & {
              correctionId: string;
              transactionId: string;
              accountRevision: number;
              previousBalance: number;
              voidedRewards: string[];
              autoCollectBlocked: boolean;
            };
            await audit(db, actor, 'card.reset', m, id, {
              correctionId: result.correctionId,
              transactionId: result.transactionId,
              previousBalance: result.previousBalance,
              voidedRewards: result.voidedRewards,
              autoCollectBlocked: result.autoCollectBlocked,
              reason: body.reason,
            });
            await emitOutbox(db, {
              merchantId: m,
              eventType: 'loyalty.corrected',
              aggregateId: id,
              revision: result.accountRevision,
              payload: { transactionId: result.transactionId },
              dedupeKey: 'correction:' + result.correctionId,
              kind: 'domain_event',
            });
            return result;
          },
        );
      },
      actor,
    );
  });

  app.post('/api/v1/merchants/:m/memberships/:id/auto-block', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params),
      body = autoCollectBlockInput.parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        requireCondition(
          (await db.query('SELECT 1 FROM memberships WHERE merchant_id=$1 AND id=$2', [m, id]))
            .rowCount,
          'NOT_FOUND',
          404,
        );
        await merchantGrant(db, actor, m, ['owner', 'manager'], undefined, true);
        return operation(
          db,
          actor,
          { scope: 'card.auto-block:' + id, key, payload: body, merchantId: m },
          async () => {
            const result = (
              await db.query('SELECT set_auto_collect_block($1,$2) AS value', [id, body.blocked])
            ).rows[0].value as Record<string, unknown> & { changed: boolean };
            if (result.changed)
              await audit(
                db,
                actor,
                body.blocked ? 'card.auto-block' : 'card.auto-unblock',
                m,
                id,
                {
                  ...(body.reason ? { reason: body.reason } : {}),
                },
              );
            return result;
          },
        );
      },
      actor,
    );
  });
}
