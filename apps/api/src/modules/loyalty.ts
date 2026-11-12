import { authorizeOperationRead } from '../operation-access.js';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  awardMath,
  businessDate,
  normalizeReceipt,
} from '../../../../packages/domain/src/loyalty.js';
import { authenticated } from '../auth.js';
import { audit, transaction, type Actor, type DB, type Pools } from '../db.js';
import { requireCondition } from '../errors.js';
import { merchantGrant } from '../policy.js';
import { idempotencyKey, operation } from '../operations.js';
import { tokenHash } from '../crypto.js';
import { readPresentationToken } from './enrollment.js';
import { emitOutbox } from '../outbox.js';
import { requireEarning } from '../subscriptions.js';
export { awardInput as awardBody } from '../../../../packages/contracts/src/commands.js';
import {
  awardInput as awardBody,
  type AwardInput,
} from '../../../../packages/contracts/src/commands.js';
export type { AwardInput } from '../../../../packages/contracts/src/commands.js';
export async function award(
  db: DB,
  actor: Actor,
  merchantId: string,
  key: string,
  p: AwardInput,
  source: 'scan' | 'request' = 'scan',
  requestId?: string,
) {
  const staff = await merchantGrant(
    db,
    actor,
    merchantId,
    ['owner', 'manager', 'cashier'],
    p.branchId,
    true,
  );
  requireCondition(p.quantity <= staff.max_qty, 'QTY_OVER_LIMIT', 422);
  const normalized = normalizeReceipt(p.purchaseReference.reference);
  requireCondition(normalized && /^[\p{L}\p{N} /_.:-]+$/u.test(normalized), 'RECEIPT_INVALID', 422);
  const canonical = {
    membershipId: p.membershipId,
    branchId: p.branchId,
    quantity: p.quantity,
    purchaseReference: {
      namespace: 'manual',
      reference: normalized,
      businessDate: p.purchaseReference.businessDate,
    },
    source,
    requestId: requestId || null,
  };
  return operation(
    db,
    actor,
    { scope: 'stamp.award:' + merchantId, key, payload: canonical, merchantId },
    async (operationId) => {
      // Match request-decision lock order before taking the loyalty account lock.
      const matchingRequest =
        source === 'scan'
          ? (
              await db.query(
                "SELECT id,expires_at FROM stamp_requests WHERE merchant_id=$1 AND membership_id=$2 AND branch_id=$3 AND status='pending' AND expires_at>clock_timestamp() FOR UPDATE",
                [merchantId, p.membershipId, p.branchId],
              )
            ).rows[0]
          : undefined;
      const account = (
        await db.query(
          'SELECT a.*,m.program_id,m.status AS membership_status,p.status AS program_status,v.threshold,v.max_per_tx,v.reward_title,v.reward_terms,v.validity_days,v.starts_at,v.ends_at FROM loyalty_accounts a JOIN memberships m ON m.id=a.membership_id AND m.merchant_id=a.merchant_id JOIN programs p ON p.id=m.program_id JOIN program_versions v ON v.id=a.program_version_id WHERE a.membership_id=$1 AND a.merchant_id=$2 FOR UPDATE OF a FOR SHARE OF m,p',
          [p.membershipId, merchantId],
        )
      ).rows[0];
      requireCondition(account, 'NOT_FOUND', 404);
      requireCondition(account.membership_status === 'active', 'MEMBERSHIP_DISABLED', 403);
      requireCondition(account.program_status === 'active', 'PROGRAM_INACTIVE', 409);
      await requireEarning(db, merchantId);
      const clock = (await db.query('SELECT clock_timestamp() AS at')).rows[0].at as Date;
      if (source === 'request') {
        const request = (
          await db.query('SELECT * FROM stamp_requests WHERE merchant_id=$1 AND id=$2 FOR UPDATE', [
            merchantId,
            requestId,
          ])
        ).rows[0];
        requireCondition(
          request && request.membership_id === p.membershipId && request.branch_id === p.branchId,
          'REQUEST_CONTEXT_MISMATCH',
          422,
        );
        requireCondition(request.status === 'pending', 'REQUEST_ALREADY_DECIDED', 409);
        requireCondition(request.expires_at > clock, 'REQUEST_EXPIRED', 410);
      }
      requireCondition(
        account.starts_at <= clock && (!account.ends_at || account.ends_at > clock),
        'PROGRAM_INACTIVE',
        409,
      );
      requireCondition(p.quantity <= account.max_per_tx, 'QTY_OVER_LIMIT', 422);
      // The shop's collection rules bind the cashier too: how many stamps at once, and how often.
      const rules = (
        await db.query(
          'SELECT default_stamps,allow_multiple,max_stamps_per_collection FROM stamp_collection_settings WHERE merchant_id=$1',
          [merchantId],
        )
      ).rows[0];
      requireCondition(
        rules.allow_multiple
          ? p.quantity <= rules.max_stamps_per_collection
          : p.quantity === rules.default_stamps,
        'QTY_OVER_LIMIT',
        422,
      );
      requireCondition(
        (
          await db.query('SELECT collection_eligibility($1,$2) AS value', [
            p.membershipId,
            p.quantity,
          ])
        ).rows[0].value.eligible,
        'COLLECTION_LIMIT',
        409,
      );
      requireCondition(
        (
          await db.query(
            'SELECT 1 FROM program_branches WHERE merchant_id=$1 AND program_version_id=$2 AND branch_id=$3',
            [merchantId, account.program_version_id, p.branchId],
          )
        ).rowCount,
        'PROGRAM_BRANCH_UNAUTHORIZED',
        403,
      );
      {
        const tok = readPresentationToken(p.presentationContext);
        requireCondition(/^[a-f0-9]{64}$/.test(tok), 'TOKEN_INVALID', 422);
        const proof = (
          await db.query(
            'SELECT * FROM presentation_tokens WHERE merchant_id=$1 AND membership_id=$2 AND token_hash=$3 AND expires_at>clock_timestamp()',
            [merchantId, p.membershipId, tokenHash(tok)],
          )
        ).rows[0];
        requireCondition(proof, 'TOKEN_INVALID_OR_EXPIRED', 410);
        requireCondition(
          proof.purpose !== 'cashier_lookup' &&
            (source !== 'request' || proof.purpose === 'cashier_scan'),
          'CUSTOMER_QR_REQUIRED',
          403,
        );
        if (proof.purpose === 'cashier_scan')
          requireCondition(
            proof.created_by === actor.id &&
              proof.session_id === actor.sessionId &&
              proof.branch_id === p.branchId,
            'TOKEN_INVALID',
            403,
          );
        requireCondition(
          (await db.query('SELECT valid_customer_presentation($1) AS valid', [proof.id])).rows[0]
            .valid,
          'TOKEN_INVALID_OR_EXPIRED',
          410,
        );
      }
      const merchant = (await db.query('SELECT timezone FROM merchants WHERE id=$1', [merchantId]))
        .rows[0];
      requireCondition(
        p.purchaseReference.businessDate === businessDate(merchant.timezone, clock),
        'BUSINESS_DATE_MISMATCH',
        422,
      );
      const purchase = (
        await db.query(
          "INSERT INTO purchase_references(merchant_id,branch_id,namespace,business_date,reference,normalized_reference) VALUES($1,$2,'manual',$3,$4,$5) ON CONFLICT(merchant_id,namespace,branch_id,business_date,normalized_reference) DO NOTHING RETURNING id",
          [
            merchantId,
            p.branchId,
            p.purchaseReference.businessDate,
            p.purchaseReference.reference,
            normalized,
          ],
        )
      ).rows[0];
      requireCondition(purchase, 'PURCHASE_ALREADY_USED', 409);
      const txId = randomUUID(),
        reference = 'TX-' + txId.slice(0, 8).toUpperCase() + '-' + txId.slice(9, 13).toUpperCase();
      await db.query(
        "INSERT INTO loyalty_transactions(id,public_reference,merchant_id,membership_id,program_version_id,branch_id,staff_id,operation_id,purchase_id,type,quantity,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'award',$10,$11)",
        [
          txId,
          reference,
          merchantId,
          p.membershipId,
          account.program_version_id,
          p.branchId,
          staff.id,
          operationId,
          purchase.id,
          p.quantity,
          source,
        ],
      );
      await db.query(
        'INSERT INTO purchase_allocations(merchant_id,purchase_id,membership_id,transaction_id) VALUES($1,$2,$3,$4)',
        [merchantId, purchase.id, p.membershipId, txId],
      );
      await db.query(
        "INSERT INTO ledger_entries(merchant_id,membership_id,transaction_id,program_version_id,type,amount) VALUES($1,$2,$3,$4,'earn',$5)",
        [merchantId, p.membershipId, txId, account.program_version_id, p.quantity],
      );
      const calculated = awardMath(account.balance, p.quantity, account.threshold),
        rewards: Record<string, unknown>[] = [];
      const branchIds = (
        await db.query(
          'SELECT branch_id FROM program_branches WHERE merchant_id=$1 AND program_version_id=$2',
          [merchantId, account.program_version_id],
        )
      ).rows.map((x) => x.branch_id as string);
      for (let i = 1; i <= calculated.rewardCount; i++) {
        const r = (
          await db.query(
            "INSERT INTO reward_grants(merchant_id,membership_id,program_version_id,earned_transaction_id,ordinal,threshold,title,terms,branch_ids,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()+$10*interval '1 day') RETURNING id,title,terms,status,earned_at,expires_at",
            [
              merchantId,
              p.membershipId,
              account.program_version_id,
              txId,
              i,
              account.threshold,
              account.reward_title,
              account.reward_terms,
              branchIds,
              account.validity_days,
            ],
          )
        ).rows[0];
        rewards.push(r);
        await db.query(
          "INSERT INTO ledger_entries(merchant_id,membership_id,transaction_id,program_version_id,type,amount,reward_id) VALUES($1,$2,$3,$4,'reward_consumption',$5,$6)",
          [merchantId, p.membershipId, txId, account.program_version_id, -account.threshold, r.id],
        );
        await db.query(
          "INSERT INTO reward_events(merchant_id,reward_id,event_type,actor_id,transaction_id) VALUES($1,$2,'earned',$3,$4)",
          [merchantId, r.id, actor.id, txId],
        );
      }
      const updated = (
        await db.query(
          'UPDATE loyalty_accounts SET balance=$1,revision=revision+1,last_purchase_at=clock_timestamp() WHERE membership_id=$2 RETURNING revision',
          [calculated.balanceAfter, p.membershipId],
        )
      ).rows[0];
      const fulfilledRequestId =
        requestId || (matchingRequest?.expires_at > clock ? matchingRequest.id : undefined);
      if (fulfilledRequestId) {
        await db.query(
          "UPDATE stamp_requests SET status='approved',decided_by=$1,decided_at=clock_timestamp(),transaction_id=$2,result=$3 WHERE id=$4",
          [
            actor.id,
            txId,
            {
              transactionId: txId,
              reference,
              quantity: p.quantity,
              balanceAfter: calculated.balanceAfter,
            },
            fulfilledRequestId,
          ],
        );
        await db.query(
          "INSERT INTO stamp_request_events(merchant_id,request_id,actor_id,action) VALUES($1,$2,$3,'approved')",
          [merchantId, fulfilledRequestId, actor.id],
        );
      }
      await audit(db, actor, 'loyalty.award', merchantId, txId, {
        membershipId: p.membershipId,
        branchId: p.branchId,
        purchaseId: purchase.id,
        quantity: p.quantity,
        source,
        requestId: requestId || null,
      });
      await emitOutbox(db, {
        merchantId,
        eventType: 'loyalty.awarded',
        aggregateId: p.membershipId,
        revision: updated.revision,
        payload: { transactionId: txId, rewardIds: rewards.map((r) => r.id) },
        dedupeKey: 'award:' + txId,
        kind: 'domain_event',
      });
      return {
        transactionId: txId,
        reference,
        purchaseId: purchase.id,
        membershipId: p.membershipId,
        quantity: p.quantity,
        balanceAfter: calculated.balanceAfter,
        accountRevision: updated.revision,
        rewardGrants: rewards,
        committedAt: clock.toISOString(),
        source,
      };
    },
  );
}
export function loyaltyModule(app: FastifyInstance, pools: Pools) {
  app.post('/api/v1/merchants/:m/stamp-awards', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      p = awardBody.parse(req.body),
      key = idempotencyKey(req);
    return transaction(pools.pool, (db) => award(db, actor, m, key, p), actor);
  });
  app.get('/api/v1/operations/by-key', async (req) => {
    const actor = authenticated(req),
      q = z.object({ scope: z.string().max(160), key: z.string().max(120) }).parse(req.query);
    return transaction(
      pools.pool,
      async (db) => {
        const op = (
          await db.query(
            'SELECT * FROM operations WHERE actor_id=$1 AND scope=$2 AND idempotency_key=$3',
            [actor.id, q.scope, q.key],
          )
        ).rows[0];
        if (!op) return { status: 'unknown' };
        await authorizeOperationRead(db, actor, op);
        return { operationId: op.id, status: op.status, result: op.result };
      },
      actor,
    );
  });
  app.get('/api/v1/operations/:id', async (req) => {
    const actor = authenticated(req),
      { id } = z.object({ id: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        const op = (
          await db.query('SELECT * FROM operations WHERE id=$1 AND actor_id=$2', [id, actor.id])
        ).rows[0];
        requireCondition(op, 'NOT_FOUND', 404);
        await authorizeOperationRead(db, actor, op);
        return { operationId: op.id, status: op.status, result: op.result };
      },
      actor,
    );
  });
  app.get('/api/v1/me/memberships/:id/activity', async (req) => {
    const actor = authenticated(req),
      { id } = z.object({ id: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        requireCondition(
          (await db.query('SELECT id FROM memberships WHERE id=$1 AND user_id=$2', [id, actor.id]))
            .rowCount,
          'NOT_FOUND',
          404,
        );
        return {
          activity: (
            await db.query(
              'SELECT id,public_reference,type,quantity,source,at FROM loyalty_transactions WHERE membership_id=$1 ORDER BY at DESC LIMIT 100',
              [id],
            )
          ).rows,
        };
      },
      actor,
    );
  });
  app.get('/api/v1/me/memberships/:id/rewards', async (req) => {
    const actor = authenticated(req),
      { id } = z.object({ id: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        requireCondition(
          (await db.query('SELECT id FROM memberships WHERE id=$1 AND user_id=$2', [id, actor.id]))
            .rowCount,
          'NOT_FOUND',
          404,
        );
        return {
          rewards: (
            await db.query(
              "SELECT id,title,terms,CASE WHEN status='available' AND expires_at<=clock_timestamp() THEN 'expired' ELSE status END AS status,earned_at,expires_at,redeemed_at FROM reward_grants WHERE membership_id=$1 ORDER BY earned_at DESC",
              [id],
            )
          ).rows,
        };
      },
      actor,
    );
  });
  app.get('/api/v1/merchants/:m/transactions', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m);
        return {
          transactions: (
            await db.query(
              'SELECT t.id,t.public_reference,t.type,t.quantity,t.at,t.source,t.branch_id,p.alias,b.name AS branch_name FROM loyalty_transactions t JOIN memberships ms ON ms.id=t.membership_id JOIN tenant_customer_profiles p ON p.id=ms.profile_id JOIN branches b ON b.id=t.branch_id AND b.merchant_id=t.merchant_id WHERE t.merchant_id=$1 AND branch_access(t.merchant_id,t.branch_id) ORDER BY t.at DESC LIMIT 100',
              [m],
            )
          ).rows,
        };
      },
      actor,
    );
  });
}
