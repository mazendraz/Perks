import {
  redemptionStartInput,
  redemptionDecisionInput,
} from '../../../../packages/contracts/src/commands.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { authenticated } from '../auth.js';
import { audit, transaction, type Pools } from '../db.js';
import type { Config } from '../config.js';
import { requireCondition } from '../errors.js';
import { merchantGrant } from '../policy.js';
import { idempotencyKey, operation } from '../operations.js';
import { keyedHash, safeEqual, tokenHash } from '../crypto.js';
import { readPresentationToken } from './enrollment.js';
import { emitOutbox } from '../outbox.js';
const matchCode = (id: string, pepper: string) =>
  String(parseInt(keyedHash('holder:' + id, pepper).slice(0, 8), 16) % 1_000_000).padStart(6, '0');
export function rewardsModule(app: FastifyInstance, pools: Pools, c: Config) {
  app.get('/api/v1/me/redemption-challenges', async (req) => {
    const actor = authenticated(req);
    return transaction(
      pools.pool,
      async (db) => ({
        challenges: (
          await db.query(
            "SELECT ch.id,ch.merchant_id,ch.reward_id,ch.membership_id,ch.status,ch.expires_at,r.title,r.terms FROM redemption_challenges ch JOIN reward_grants r ON r.id=ch.reward_id WHERE ch.holder_user_id=$1 AND ch.expires_at>clock_timestamp() AND ch.status IN ('awaiting_holder','confirmed') ORDER BY ch.created_at DESC",
            [actor.id],
          )
        ).rows.map((row) => ({ ...row, code: matchCode(row.id, c.AUTH_PEPPER) })),
      }),
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/rewards/:r/redemption-challenges', async (req) => {
    const actor = authenticated(req),
      { m, r } = z.object({ m: z.uuid(), r: z.uuid() }).parse(req.params),
      body = redemptionStartInput.parse(req.body),
      key = idempotencyKey(req);
    const result = await transaction(
      pools.pool,
      async (db) => {
        const staff = await merchantGrant(
          db,
          actor,
          m,
          ['owner', 'manager', 'cashier'],
          body.branchId,
          true,
        );
        return operation(
          db,
          actor,
          {
            scope: 'redemption.start:' + r,
            key,
            payload: { r, branchId: body.branchId },
            merchantId: m,
          },
          async () => {
            const initial = (
              await db.query(
                'SELECT membership_id FROM reward_grants WHERE id=$1 AND merchant_id=$2',
                [r, m],
              )
            ).rows[0];
            requireCondition(initial, 'NOT_FOUND', 404);
            await db.query(
              'SELECT membership_id FROM loyalty_accounts WHERE membership_id=$1 FOR UPDATE',
              [initial.membership_id],
            );
            const reward = (
              await db.query(
                'SELECT r.*,ms.user_id FROM reward_grants r JOIN memberships ms ON ms.id=r.membership_id WHERE r.id=$1 AND r.merchant_id=$2 FOR UPDATE OF r',
                [r, m],
              )
            ).rows[0];
            requireCondition(reward.status === 'available', 'REWARD_UNAVAILABLE', 409);
            requireCondition(
              reward.expires_at > (await db.query('SELECT clock_timestamp() AS at')).rows[0].at,
              'REWARD_EXPIRED',
              410,
            );
            requireCondition(
              reward.branch_ids.includes(body.branchId),
              'REWARD_BRANCH_UNAUTHORIZED',
              403,
            );
            const proof = (
              await db.query(
                'SELECT * FROM presentation_tokens WHERE merchant_id=$1 AND membership_id=$2 AND token_hash=$3 AND expires_at>clock_timestamp()',
                [
                  m,
                  reward.membership_id,
                  tokenHash(readPresentationToken(body.presentationContext)),
                ],
              )
            ).rows[0];
            requireCondition(proof, 'TOKEN_INVALID_OR_EXPIRED', 410);
            requireCondition(proof.purpose !== 'cashier_lookup', 'CUSTOMER_QR_REQUIRED', 403);
            if (proof.purpose === 'cashier_scan')
              requireCondition(
                proof.created_by === actor.id &&
                  proof.session_id === actor.sessionId &&
                  proof.branch_id === body.branchId,
                'TOKEN_INVALID',
                403,
              );
            requireCondition(
              (await db.query('SELECT valid_customer_presentation($1) AS valid', [proof.id]))
                .rows[0].valid,
              'TOKEN_INVALID_OR_EXPIRED',
              410,
            );
            await db.query(
              "UPDATE redemption_challenges SET status='expired' WHERE reward_id=$1 AND status IN ('awaiting_holder','confirmed') AND expires_at<=clock_timestamp()",
              [r],
            );
            const active = (
              await db.query(
                "SELECT id,expires_at,branch_id,cashier_user_id,cashier_session_id FROM redemption_challenges WHERE reward_id=$1 AND status IN ('awaiting_holder','confirmed')",
                [r],
              )
            ).rows[0];
            if (active) {
              // The same cashier session may resume its own open challenge after a reload or a
              // lost reply. The fresh customer QR proof above was still required; any other
              // cashier, session or branch keeps the conflict.
              requireCondition(
                active.cashier_user_id === actor.id &&
                  active.cashier_session_id === actor.sessionId &&
                  active.branch_id === body.branchId,
                'CHALLENGE_ACTIVE',
                409,
              );
              await audit(db, actor, 'redemption.resume', m, r, {
                challengeId: active.id,
                branchId: body.branchId,
              });
              return { challengeId: active.id as string, expiresAt: active.expires_at };
            }
            const id = randomUUID(),
              code = matchCode(id, c.AUTH_PEPPER);
            const ch = (
              await db.query(
                "INSERT INTO redemption_challenges(id,merchant_id,reward_id,membership_id,branch_id,staff_id,cashier_user_id,cashier_session_id,holder_user_id,code_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp()+interval '3 minutes') RETURNING id,expires_at",
                [
                  id,
                  m,
                  r,
                  reward.membership_id,
                  body.branchId,
                  staff.id,
                  actor.id,
                  actor.sessionId,
                  reward.user_id,
                  tokenHash(code),
                ],
              )
            ).rows[0];
            await audit(db, actor, 'redemption.start', m, r, {
              challengeId: id,
              branchId: body.branchId,
            });
            return { challengeId: id, expiresAt: ch.expires_at };
          },
        );
      },
      actor,
    );
    return { ...result, code: matchCode(result.challengeId, c.AUTH_PEPPER) };
  });
  app.post('/api/v1/me/redemption-challenges/:id/decision', async (req) => {
    const actor = authenticated(req),
      { id } = z.object({ id: z.uuid() }).parse(req.params),
      body = redemptionDecisionInput.parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        const owned = (
          await db.query('SELECT * FROM redemption_challenges WHERE id=$1 AND holder_user_id=$2', [
            id,
            actor.id,
          ])
        ).rows[0];
        requireCondition(owned, 'NOT_FOUND', 404);
        return operation(
          db,
          actor,
          { scope: 'holder.decision:' + id, key, payload: body, merchantId: owned.merchant_id },
          async () => {
            const ch = (
              await db.query('SELECT * FROM redemption_challenges WHERE id=$1 FOR UPDATE', [id])
            ).rows[0];
            requireCondition(ch.status === 'awaiting_holder', 'CHALLENGE_FINAL', 409);
            requireCondition(
              ch.expires_at > (await db.query('SELECT clock_timestamp() AS at')).rows[0].at,
              'CHALLENGE_EXPIRED',
              410,
            );
            requireCondition(
              safeEqual(ch.code_hash, tokenHash(body.code)),
              'MATCH_CODE_INVALID',
              422,
            );
            await db.query(
              'UPDATE redemption_challenges SET status=$1,confirmed_at=CASE WHEN $2 THEN clock_timestamp() ELSE NULL END WHERE id=$3',
              [body.approve ? 'confirmed' : 'declined', body.approve, id],
            );
            await audit(
              db,
              actor,
              body.approve ? 'holder.confirm' : 'holder.decline',
              ch.merchant_id,
              id,
            );
            return { challengeId: id, status: body.approve ? 'confirmed' : 'declined' };
          },
        );
      },
      actor,
    );
  });
  app.get('/api/v1/merchants/:m/redemption-challenges/:id', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        const ch = (
          await db.query(
            'SELECT id,branch_id,status,expires_at,cashier_user_id,cashier_session_id FROM redemption_challenges WHERE merchant_id=$1 AND id=$2',
            [m, id],
          )
        ).rows[0];
        requireCondition(ch, 'NOT_FOUND', 404);
        await merchantGrant(db, actor, m, ['owner', 'manager', 'cashier'], ch.branch_id);
        requireCondition(
          ch.cashier_user_id === actor.id && ch.cashier_session_id === actor.sessionId,
          'FORBIDDEN',
          403,
        );
        return { challenge: { ...ch, code: matchCode(id, c.AUTH_PEPPER) } };
      },
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/redemption-challenges/:id/complete', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        const initial = (
          await db.query('SELECT * FROM redemption_challenges WHERE merchant_id=$1 AND id=$2', [
            m,
            id,
          ])
        ).rows[0];
        requireCondition(initial, 'NOT_FOUND', 404);
        const staff = await merchantGrant(
          db,
          actor,
          m,
          ['owner', 'manager', 'cashier'],
          initial.branch_id,
          true,
        );
        requireCondition(
          initial.cashier_user_id === actor.id && initial.cashier_session_id === actor.sessionId,
          'FORBIDDEN',
          403,
        );
        return operation(
          db,
          actor,
          { scope: 'redemption.complete:' + id, key, payload: { id }, merchantId: m },
          async (operationId) => {
            await db.query(
              'SELECT membership_id FROM loyalty_accounts WHERE membership_id=$1 FOR UPDATE',
              [initial.membership_id],
            );
            const r = (
              await db.query(
                'SELECT * FROM reward_grants WHERE merchant_id=$1 AND id=$2 FOR UPDATE',
                [m, initial.reward_id],
              )
            ).rows[0];
            const ch = (
              await db.query('SELECT * FROM redemption_challenges WHERE id=$1 FOR UPDATE', [id])
            ).rows[0];
            const clock = (await db.query('SELECT clock_timestamp() AS at')).rows[0].at;
            requireCondition(r.status === 'available', 'REWARD_ALREADY_USED', 409);
            requireCondition(r.expires_at > clock, 'REWARD_EXPIRED', 410);
            requireCondition(ch.expires_at > clock, 'CHALLENGE_EXPIRED', 410);
            requireCondition(ch.status === 'confirmed', 'HOLDER_NOT_CONFIRMED', 409);
            requireCondition(
              r.branch_ids.includes(ch.branch_id),
              'REWARD_BRANCH_UNAUTHORIZED',
              403,
            );
            const txId = randomUUID(),
              reference =
                'TX-' + txId.slice(0, 8).toUpperCase() + '-' + txId.slice(9, 13).toUpperCase();
            await db.query(
              "INSERT INTO loyalty_transactions(id,public_reference,merchant_id,membership_id,program_version_id,branch_id,staff_id,operation_id,type,quantity,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'redeem',0,'redemption')",
              [
                txId,
                reference,
                m,
                r.membership_id,
                r.program_version_id,
                ch.branch_id,
                staff.id,
                operationId,
              ],
            );
            await db.query(
              'INSERT INTO reward_redemptions(reward_id,merchant_id,challenge_id,transaction_id,holder_user_id) VALUES($1,$2,$3,$4,$5)',
              [r.id, m, id, txId, ch.holder_user_id],
            );
            await db.query(
              "UPDATE reward_grants SET status='redeemed',redeemed_at=clock_timestamp() WHERE id=$1",
              [r.id],
            );
            await db.query(
              "UPDATE redemption_challenges SET status='completed',completed_transaction_id=$1 WHERE id=$2",
              [txId, id],
            );
            await db.query(
              "INSERT INTO reward_events(merchant_id,reward_id,event_type,actor_id,transaction_id) VALUES($1,$2,'redeemed',$3,$4)",
              [m, r.id, actor.id, txId],
            );
            const account = (
              await db.query(
                'UPDATE loyalty_accounts SET revision=revision+1,cycle_number=cycle_number+1,cycle_renewed_at=clock_timestamp() WHERE membership_id=$1 RETURNING revision,cycle_number,balance',
                [r.membership_id],
              )
            ).rows[0];
            await audit(db, actor, 'reward.redeem', m, r.id, {
              transactionId: txId,
              challengeId: id,
              branchId: ch.branch_id,
            });
            await emitOutbox(db, {
              merchantId: m,
              eventType: 'reward.redeemed',
              aggregateId: r.membership_id,
              revision: account.revision,
              payload: { rewardId: r.id, transactionId: txId },
              dedupeKey: 'redeem:' + r.id,
              kind: 'domain_event',
            });
            return {
              transactionId: txId,
              reference,
              rewardId: r.id,
              title: r.title,
              status: 'redeemed',
              cycleNumber: account.cycle_number,
              balanceAfter: account.balance,
              accountRevision: account.revision,
              committedAt: clock,
            };
          },
        );
      },
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/redemption-challenges/:id/cancel', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        const ch = (
          await db.query(
            'SELECT * FROM redemption_challenges WHERE merchant_id=$1 AND id=$2 FOR UPDATE',
            [m, id],
          )
        ).rows[0];
        requireCondition(ch, 'NOT_FOUND', 404);
        await merchantGrant(db, actor, m, ['owner', 'manager', 'cashier'], ch.branch_id);
        requireCondition(
          ch.cashier_user_id === actor.id && ch.cashier_session_id === actor.sessionId,
          'FORBIDDEN',
          403,
        );
        requireCondition(
          ['awaiting_holder', 'confirmed', 'cancelled'].includes(ch.status),
          'CHALLENGE_FINAL',
          409,
        );
        await db.query("UPDATE redemption_challenges SET status='cancelled' WHERE id=$1", [id]);
        await audit(db, actor, 'redemption.cancel', m, id);
        return { cancelled: true };
      },
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/corrections', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      body = z
        .object({
          transactionId: z.uuid(),
          delta: z
            .number()
            .int()
            .min(-100)
            .max(100)
            .refine((v) => v !== 0),
          reason: z.string().trim().min(4).max(1000),
        })
        .strict()
        .parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        const original = (
          await db.query(
            "SELECT * FROM loyalty_transactions WHERE merchant_id=$1 AND id=$2 AND type='award'",
            [m, body.transactionId],
          )
        ).rows[0];
        requireCondition(original, 'NOT_FOUND', 404);
        await merchantGrant(db, actor, m, ['owner', 'manager', 'cashier'], original.branch_id);
        return operation(
          db,
          actor,
          { scope: 'correction.request', key, payload: body, merchantId: m },
          async () => {
            const r = (
              await db.query(
                'INSERT INTO correction_requests(merchant_id,membership_id,original_transaction_id,requested_by,requested_delta,reason) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
                [m, original.membership_id, original.id, actor.id, body.delta, body.reason],
              )
            ).rows[0];
            await db.query(
              "INSERT INTO correction_events(merchant_id,correction_id,actor_id,action,reason) VALUES($1,$2,$3,'request',$4)",
              [m, r.id, actor.id, body.reason],
            );
            await audit(db, actor, 'correction.request', m, r.id, {
              originalTransactionId: original.id,
              delta: body.delta,
              reason: body.reason,
            });
            return { correction: r };
          },
        );
      },
      actor,
    );
  });
  app.get('/api/v1/merchants/:m/corrections', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        const staff = await merchantGrant(db, actor, m);
        return {
          corrections: (
            await db.query(
              'SELECT c.*,t.public_reference,t.branch_id,p.alias FROM correction_requests c JOIN loyalty_transactions t ON t.id=c.original_transaction_id JOIN memberships ms ON ms.id=c.membership_id JOIN tenant_customer_profiles p ON p.id=ms.profile_id WHERE c.merchant_id=$1 AND branch_access(c.merchant_id,t.branch_id) AND ($2::boolean OR c.requested_by=$3) ORDER BY c.created_at DESC LIMIT 100',
              [m, staff.role !== 'cashier', actor.id],
            )
          ).rows,
        };
      },
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/corrections/:id/decision', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params),
      body = z
        .object({ approve: z.boolean(), reason: z.string().trim().min(4).max(1000) })
        .strict()
        .parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        const originalCorrection = (
          await db.query(
            'SELECT c.*,t.branch_id FROM correction_requests c JOIN loyalty_transactions t ON t.id=c.original_transaction_id WHERE c.merchant_id=$1 AND c.id=$2',
            [m, id],
          )
        ).rows[0];
        requireCondition(originalCorrection, 'NOT_FOUND', 404);
        const staff = await merchantGrant(
          db,
          actor,
          m,
          ['owner', 'manager'],
          originalCorrection.branch_id,
          true,
        );
        requireCondition(
          originalCorrection.requested_by !== actor.id,
          'SELF_APPROVAL_FORBIDDEN',
          403,
        );
        return operation(
          db,
          actor,
          { scope: 'correction.decide:' + id, key, payload: body, merchantId: m },
          async (operationId) => {
            const correction = (
              await db.query('SELECT * FROM correction_requests WHERE id=$1 FOR UPDATE', [id])
            ).rows[0];
            if (correction.status === 'applied')
              return correction.result as Record<string, unknown>;
            requireCondition(
              ['pending', 'needs_review'].includes(correction.status),
              'CORRECTION_FINAL',
              409,
            );
            const original = (
              await db.query('SELECT * FROM loyalty_transactions WHERE id=$1', [
                correction.original_transaction_id,
              ])
            ).rows[0];
            if (!body.approve) {
              await db.query(
                "UPDATE correction_requests SET status='rejected',decided_by=$1,decision_reason=$2,decided_at=clock_timestamp() WHERE id=$3",
                [actor.id, body.reason, id],
              );
              await db.query(
                "INSERT INTO correction_events(merchant_id,correction_id,actor_id,action,reason) VALUES($1,$2,$3,'reject',$4)",
                [m, id, actor.id, body.reason],
              );
              await audit(db, actor, 'correction.reject', m, id, { reason: body.reason });
              return { status: 'rejected', correctionId: id };
            }
            const account = (
              await db.query('SELECT * FROM loyalty_accounts WHERE membership_id=$1 FOR UPDATE', [
                correction.membership_id,
              ])
            ).rows[0];
            const latest = (
              await db.query(
                'SELECT id FROM loyalty_transactions WHERE membership_id=$1 ORDER BY sequence DESC LIMIT 1',
                [correction.membership_id],
              )
            ).rows[0];
            const rewards = (
              await db.query(
                'SELECT * FROM reward_grants WHERE earned_transaction_id=$1 FOR UPDATE',
                [original.id],
              )
            ).rows;
            let review: string | null = null;
            if (correction.requested_delta !== -original.quantity)
              review = 'PARTIAL_OR_POSITIVE_ADJUSTMENT';
            else if (latest.id !== original.id) review = 'SUBSEQUENT_ACTIVITY';
            else if (rewards.some((r) => r.status !== 'available')) review = 'REWARD_ALREADY_USED';
            if (review) {
              await db.query(
                "UPDATE correction_requests SET status='needs_review',decided_by=$1,decision_reason=$2,decided_at=clock_timestamp() WHERE id=$3",
                [actor.id, review, id],
              );
              await db.query(
                "INSERT INTO correction_events(merchant_id,correction_id,actor_id,action,reason) VALUES($1,$2,$3,'needs_review',$4)",
                [m, id, actor.id, review],
              );
              await audit(db, actor, 'correction.review', m, id, { review, reason: body.reason });
              return { status: 'needs_review', reason: review, correctionId: id };
            }
            const entries = (
              await db.query(
                'SELECT * FROM ledger_entries WHERE transaction_id=$1 ORDER BY sequence',
                [original.id],
              )
            ).rows;
            const balance = account.balance - entries.reduce((sum, e) => sum + e.amount, 0);
            requireCondition(balance >= 0, 'CORRECTION_REQUIRES_REVIEW', 409);
            const txId = randomUUID(),
              reference =
                'TX-' + txId.slice(0, 8).toUpperCase() + '-' + txId.slice(9, 13).toUpperCase();
            await db.query(
              "INSERT INTO loyalty_transactions(id,public_reference,merchant_id,membership_id,program_version_id,branch_id,staff_id,operation_id,type,quantity,source,original_transaction_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'correction',$9,'correction',$10)",
              [
                txId,
                reference,
                m,
                original.membership_id,
                original.program_version_id,
                original.branch_id,
                staff.id,
                operationId,
                correction.requested_delta,
                original.id,
              ],
            );
            for (const e of entries)
              await db.query(
                "INSERT INTO ledger_entries(merchant_id,membership_id,transaction_id,program_version_id,type,amount,reward_id,compensates_entry_id) VALUES($1,$2,$3,$4,'compensation',$5,$6,$7)",
                [
                  m,
                  original.membership_id,
                  txId,
                  original.program_version_id,
                  -e.amount,
                  e.reward_id,
                  e.id,
                ],
              );
            for (const r of rewards) {
              await db.query("UPDATE reward_grants SET status='voided' WHERE id=$1", [r.id]);
              await db.query(
                "INSERT INTO reward_events(merchant_id,reward_id,event_type,actor_id,transaction_id) VALUES($1,$2,'voided',$3,$4)",
                [m, r.id, actor.id, txId],
              );
            }
            const revision = (
              await db.query(
                'UPDATE loyalty_accounts SET balance=$1,revision=revision+1 WHERE membership_id=$2 RETURNING revision',
                [balance, original.membership_id],
              )
            ).rows[0].revision;
            const result = {
              status: 'applied',
              correctionId: id,
              transactionId: txId,
              reference,
              balanceAfter: balance,
              accountRevision: revision,
            };
            await db.query(
              "UPDATE correction_requests SET status='applied',decided_by=$1,decision_reason=$2,compensating_transaction_id=$3,result=$4,decided_at=clock_timestamp() WHERE id=$5",
              [actor.id, body.reason, txId, result, id],
            );
            await db.query(
              "INSERT INTO correction_events(merchant_id,correction_id,actor_id,action,reason) VALUES($1,$2,$3,'apply',$4)",
              [m, id, actor.id, body.reason],
            );
            await audit(db, actor, 'correction.apply', m, id, {
              originalTransactionId: original.id,
              compensatingTransactionId: txId,
              reason: body.reason,
            });
            await emitOutbox(db, {
              merchantId: m,
              eventType: 'loyalty.corrected',
              aggregateId: original.membership_id,
              revision,
              payload: { transactionId: txId },
              dedupeKey: 'correction:' + id,
              kind: 'domain_event',
            });
            return result;
          },
        );
      },
      actor,
    );
  });
}
