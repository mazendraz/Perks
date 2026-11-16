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

// Staff tools for stamps nobody approved. The rules (window, branch, redeemed rewards, revision)
// live in the database functions; the checks here give the usual 403/404 answers first.
export function cardCorrectionsModule(app: FastifyInstance, pools: Pools) {
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
