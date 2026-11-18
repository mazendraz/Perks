import type pg from 'pg';
import type { ServiceConfig } from '../../api/src/config.js';
import { stampRequestNotice, type PushLanguage } from '../../api/src/push-notices.js';
import { delivered, gone, sendPush, webPushConfig, type Transport } from '../../api/src/webpush.js';

interface Target {
  sub_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  language: PushLanguage;
  branch_name: string;
}
export interface PushJobOutcome {
  outcome: 'succeeded' | 'failed' | 'blocked';
  error: string | null;
}

// The `cashier_push` job: ring the cashiers and managers of the request's branch.
//
// Targets are read at send time (the request may have been decided or expired, a person signed out,
// lost the branch or been disabled since it was queued), the network calls are made with no
// database transaction open, and each outcome is written back afterwards. Best effort by design:
// a request is never held up by a phone, and a push is never repeated after it was accepted.
export async function runCashierPushJob(
  pool: pg.Pool,
  c: ServiceConfig,
  job: { aggregate_id: string; payload: Record<string, unknown> },
  transport?: Transport,
): Promise<PushJobOutcome> {
  const config = webPushConfig(c);
  if (!config) return { outcome: 'blocked', error: 'PUSH_NOT_CONFIGURED' };
  const branchId = String(job.payload.branchId ?? '');
  const targets = (
    await pool.query<Target>('SELECT * FROM push_targets_for_stamp_request($1)', [job.aggregate_id])
  ).rows;
  if (!targets.length) return { outcome: 'succeeded', error: 'NO_RECIPIENTS' };
  let sent = 0,
    failed = 0;
  // Bounded parallelism: the job lease is 60 seconds and a push service may take 10 to answer.
  for (let i = 0; i < targets.length; i += 25)
    await Promise.all(
      targets.slice(i, i + 25).map(async (target) => {
        const result = await sendPush(
          target,
          { ...stampRequestNotice(target.language, branchId, target.branch_name) },
          config,
          { topic: 'sr' + branchId.replaceAll('-', '').slice(0, 24), transport },
        );
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
