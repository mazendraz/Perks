import { z } from 'zod';
import type { Actor, DB } from './db.js';
import { merchantGrant, platform, type StaffGrant } from './policy.js';
import { requireCondition } from './errors.js';
interface SavedOperation {
  scope: string;
  merchant_id: string | null;
  result: Record<string, unknown> | null;
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function uuid(value: unknown) {
  const result = z.uuid().safeParse(value);
  requireCondition(result.success, 'NOT_FOUND', 404);
  return result.data;
}
// A saved receipt is still protected by the authority of the original command.
// Actor ownership alone does not retain a revoked role or branch grant.
export async function authorizeOperationRead(db: DB, actor: Actor, op: SavedOperation) {
  const body = op.result || {},
    scope = op.scope,
    mid = op.merchant_id;
  const owned = async (sql: string, id: unknown) => {
    requireCondition(mid, 'NOT_FOUND', 404);
    requireCondition((await db.query(sql, [uuid(id), actor.id, mid])).rowCount, 'NOT_FOUND', 404);
  };
  const branch = async (
    table: 'loyalty_transactions' | 'stamp_requests' | 'redemption_challenges' | 'placements',
    id: unknown,
    roles: StaffGrant['role'][] = ['owner', 'manager', 'cashier'],
    session = false,
  ) => {
    requireCondition(mid, 'NOT_FOUND', 404);
    await merchantGrant(db, actor, mid, roles);
    const row = (
      await db.query(
        `SELECT branch_id${session ? ',cashier_user_id,cashier_session_id' : ''} FROM ${table} WHERE id=$1 AND merchant_id=$2 AND branch_access(merchant_id,branch_id)`,
        [uuid(id), mid],
      )
    ).rows[0];
    requireCondition(row, 'NOT_FOUND', 404);
    if (session)
      requireCondition(
        row.cashier_user_id === actor.id && row.cashier_session_id === actor.sessionId,
        'NOT_FOUND',
        404,
      );
  };
  if (
    scope.startsWith('draft.') ||
    scope.startsWith('platform.account:') ||
    scope.startsWith('platform.admin.') ||
    scope.startsWith('job.retry:') ||
    scope.startsWith('entitlements.update:')
  ) {
    platform(actor);
    return;
  }
  if (scope.startsWith('staff.security:')) {
    requireCondition(mid, 'NOT_FOUND', 404);
    if (actor.role === 'platform_admin') platform(actor);
    else await merchantGrant(db, actor, mid, ['owner']);
    requireCondition(
      (
        await db.query('SELECT can_manage_staff_credentials($1,$2) AS allowed', [
          mid,
          uuid(scope.slice('staff.security:'.length)),
        ])
      ).rows[0].allowed,
      'NOT_FOUND',
      404,
    );
    return;
  }
  if (scope === 'membership.enroll') {
    await owned(
      'SELECT 1 FROM memberships WHERE id=$1 AND user_id=$2 AND merchant_id=$3',
      body.membershipId,
    );
    return;
  }
  if (scope === 'presentation.issue') {
    await owned(
      'SELECT 1 FROM presentation_tokens t JOIN memberships m ON m.id=t.membership_id WHERE t.id=$1 AND t.created_by=$2 AND m.user_id=$2 AND t.merchant_id=$3',
      body.presentationId,
    );
    return;
  }
  if (scope === 'request.create') {
    await owned(
      'SELECT 1 FROM stamp_requests WHERE id=$1 AND user_id=$2 AND merchant_id=$3',
      body.id,
    );
    return;
  }
  if (scope.startsWith('holder.decision:')) {
    await owned(
      'SELECT 1 FROM redemption_challenges WHERE id=$1 AND holder_user_id=$2 AND merchant_id=$3',
      scope.slice('holder.decision:'.length),
    );
    return;
  }
  if (scope.startsWith('stamp.award:') || scope.startsWith('redemption.complete:')) {
    await branch('loyalty_transactions', body.transactionId);
    return;
  }
  if (scope.startsWith('redemption.start:')) {
    await branch('redemption_challenges', body.challengeId, undefined, true);
    return;
  }
  if (scope.startsWith('request.reject:')) {
    await branch('stamp_requests', scope.slice('request.reject:'.length));
    return;
  }
  if (scope === 'correction.request' || scope.startsWith('correction.decide:')) {
    const id =
      scope === 'correction.request'
        ? object(body.correction).id
        : scope.slice('correction.decide:'.length);
    const correction = (
      await db.query(
        'SELECT original_transaction_id FROM correction_requests WHERE id=$1 AND merchant_id=$2',
        [uuid(id), mid],
      )
    ).rows[0];
    requireCondition(correction, 'NOT_FOUND', 404);
    await branch(
      'loyalty_transactions',
      correction.original_transaction_id,
      scope === 'correction.request' ? undefined : ['owner', 'manager'],
    );
    return;
  }
  if (scope.startsWith('placement.')) {
    if (actor.role === 'platform_admin') {
      platform(actor);
      return;
    }
    const id = scope.startsWith('placement.replace:')
      ? body.replacementId
      : object(body.placement).id;
    await branch(
      'placements',
      id,
      scope.startsWith('placement.transition:') ? undefined : ['owner'],
    );
    return;
  }
  if (scope.startsWith('support.')) {
    const id =
      scope === 'support.create' ? object(body.ticket).id : scope.slice('support.message:'.length);
    requireCondition(
      (await db.query('SELECT ticket_access($1) AS allowed', [uuid(id)])).rows[0].allowed,
      'NOT_FOUND',
      404,
    );
    return;
  }
  requireCondition(mid, 'NOT_FOUND', 404);
  if (scope.startsWith('branding.logo:')) {
    if (actor.role === 'platform_admin') platform(actor);
    else await merchantGrant(db, actor, mid, ['owner']);
    return;
  }
  if (scope.startsWith('customer.export:')) {
    await merchantGrant(db, actor, mid, ['owner']);
    const ex = (
      await db.query(
        'SELECT branch_id,scope_fingerprint,customer_scope_fingerprint(merchant_id,branch_id) AS current_scope FROM customer_exports WHERE id=$1 AND merchant_id=$2 AND requested_by=$3',
        [uuid(object(body.export).id), mid, actor.id],
      )
    ).rows[0];
    requireCondition(ex && ex.scope_fingerprint === ex.current_scope, 'NOT_FOUND', 404);
    if (ex.branch_id) await merchantGrant(db, actor, mid, ['owner'], ex.branch_id);
    return;
  }
  if (scope.startsWith('segment.save:')) {
    await merchantGrant(
      db,
      actor,
      mid,
      ['owner', 'manager'],
      object(body.segment).branch_id as string | undefined,
    );
    return;
  }
  if (
    [
      'program.create:',
      'program.publish:',
      'program.earning:',
      'branch.create:',
      'invitation.create:',
      'invite.resend:',
    ].some((prefix) => scope.startsWith(prefix))
  ) {
    await merchantGrant(db, actor, mid, ['owner']);
    return;
  }
  requireCondition(false, 'NOT_FOUND', 404);
}
