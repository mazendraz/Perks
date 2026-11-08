import type { Actor, DB } from './db.js';
import { AppError, requireCondition } from './errors.js';
export function platform(actor: Actor, mfa = true) {
  requireCondition(actor.role === 'platform_admin', 'FORBIDDEN', 403);
  if (mfa && (actor.mfaRequired || actor.authMethod !== 'password'))
    requireCondition(
      actor.mfaAt && Date.now() - actor.mfaAt.getTime() < 15 * 60_000,
      'MFA_REQUIRED',
      403,
    );
}
export interface StaffGrant {
  id: string;
  role: 'owner' | 'manager' | 'cashier';
  max_qty: number;
  status: string;
}
export async function merchantGrant(
  db: DB,
  actor: Actor,
  merchantId: string,
  roles: StaffGrant['role'][] = ['owner', 'manager', 'cashier'],
  branchId?: string,
  write = false,
): Promise<StaffGrant> {
  const r = await db.query<StaffGrant>(
    'SELECT id,role,max_qty,status FROM staff_memberships WHERE merchant_id=$1 AND user_id=$2' +
      (actor.preview ? '' : ' FOR SHARE'),
    [merchantId, actor.id],
  );
  const s = r.rows[0];
  requireCondition(s, 'NOT_FOUND', 404);
  requireCondition(s.status === 'active', 'STAFF_DISABLED', 403);
  requireCondition(roles.includes(s.role), 'FORBIDDEN', 403);
  if (branchId) {
    const b = await db.query(
      'SELECT b.id FROM branches b JOIN staff_branch_grants g ON g.branch_id=b.id AND g.merchant_id=b.merchant_id WHERE b.merchant_id=$1 AND b.id=$2 AND g.staff_id=$3 AND b.status=$4',
      [merchantId, branchId, s.id, 'active'],
    );
    requireCondition(b.rowCount, 'BRANCH_UNAUTHORIZED', 403);
  }
  if (write) {
    const m = await db.query('SELECT status FROM merchants WHERE id=$1 FOR SHARE', [merchantId]);
    requireCondition(m.rows[0] && m.rows[0].status !== 'suspended', 'MERCHANT_PAUSED', 409);
  }
  return s;
}
export async function visibleMerchant(db: DB, actor: Actor, merchantId: string) {
  if (actor.role === 'platform_admin') return;
  const r = await db.query(
    'SELECT 1 FROM staff_memberships WHERE merchant_id=$1 AND user_id=$2 AND status=$3',
    [merchantId, actor.id, 'active'],
  );
  if (!r.rowCount) throw new AppError('NOT_FOUND', 404);
}
