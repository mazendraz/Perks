import type pg from 'pg';
import type { ServiceConfig } from '../../api/src/config.js';
import {
  autoStampNotice,
  rewardEarnedNotice,
  rewardRedeemedNotice,
  stampRequestNotice,
  type PushLanguage,
} from '../../api/src/push-notices.js';
import { delivered, gone, sendPush, webPushConfig, type Transport } from '../../api/src/webpush.js';

interface Target {
  sub_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  language: PushLanguage;
  branch_name: string;
  alias: string | null;
  quantity?: number | null;
  title?: string | null;
  cycle_number?: number | null;
}
export interface PushJobOutcome {
  outcome: 'succeeded' | 'failed' | 'blocked';
  error: string | null;
}

// The `cashier_push` job: ring the staff of the branch where a customer just scanned or a card moved
// on. Kinds: a request waiting for approval (payload without `kind`, as queued since phase 1), an
// automatic stamp already given (`kind: 'auto_stamp'`), a card that just filled
// (`kind: 'reward_earned'`) and a reward handed over (`kind: 'reward_redeemed'`).
//
// Targets are read at send time (the request may have been decided or expired, the customer blocked,
// a person signed out, lost the branch or been disabled since it was queued), the network calls are
// made with no database transaction open, and each outcome is written back afterwards. Best effort by
// design: a stamp is never held up by a phone, and a push is never repeated after it was accepted.
export async function runCashierPushJob(
  pool: pg.Pool,
  c: ServiceConfig,
  job: { aggregate_id: string; payload: Record<string, unknown> },
  transport?: Transport,
): Promise<PushJobOutcome> {
  const config = webPushConfig(c);
  if (!config) return { outcome: 'blocked', error: 'PUSH_NOT_CONFIGURED' };
  const kind =
    job.payload.kind === 'auto_stamp' ||
    job.payload.kind === 'reward_earned' ||
    job.payload.kind === 'reward_redeemed'
      ? job.payload.kind
      : 'request';
  const reward = kind === 'reward_earned' || kind === 'reward_redeemed';
  const targets = (
    await pool.query<Target>(
      reward
        ? 'SELECT * FROM push_targets_for_reward($1,$2)'
        : 'SELECT * FROM push_targets_for_scan($1,$2)',
      [kind, job.aggregate_id],
    )
  ).rows;
  if (!targets.length) return { outcome: 'succeeded', error: 'NO_RECIPIENTS' };
  let sent = 0,
    failed = 0;
  // Bounded parallelism: the job lease is 60 seconds and a push service may take 10 to answer.
  for (let i = 0; i < targets.length; i += 25)
    await Promise.all(
      targets.slice(i, i + 25).map(async (target) => {
        const notice =
          kind === 'reward_earned'
            ? rewardEarnedNotice(
                target.language,
                job.aggregate_id,
                target.branch_name,
                target.alias,
                target.title,
              )
            : kind === 'reward_redeemed'
              ? rewardRedeemedNotice(
                  target.language,
                  job.aggregate_id,
                  target.branch_name,
                  target.alias,
                  target.title,
                  target.cycle_number,
                )
              : kind === 'auto_stamp'
                ? autoStampNotice(
                    target.language,
                    job.aggregate_id,
                    target.branch_name,
                    target.alias,
                    target.quantity,
                  )
                : stampRequestNotice(
                    target.language,
                    job.aggregate_id,
                    target.branch_name,
                    target.alias,
                  );
        const result = await sendPush(target, { ...notice }, config, {
          // A request's notice is worth holding for an offline phone only while it can be approved.
          ttl: kind === 'request' ? 600 : 1800,
          topic:
            ({ request: 'r', auto_stamp: 'a', reward_earned: 'e', reward_redeemed: 'd' } as const)[
              kind
            ] + job.aggregate_id.replaceAll('-', '').slice(0, 30),
          transport,
        });
        await pool.query('SELECT push_record_result($1,$2,$3)', [
          target.sub_id,
          delivered(result),
          gone(result),
        ]);
        if (delivered(result)) sent++;
        else if (!gone(result)) failed++;
      }),
    );
  if (sent === 0 && failed > 0) return { outcome: 'failed', error: 'PUSH_DELIVERY_FAILED' };
  return { outcome: 'succeeded', error: null };
}
