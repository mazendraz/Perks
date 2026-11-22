// Synthetic loyalty history for analytics tests, written straight into the database with the
// migrator connection so a test can place visits at any moment in the past.
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { ids } from '../db/seed.js';

export const programA = '40000000-0000-4000-8000-000000000001';
export const versionA = '50000000-0000-4000-8000-000000000001';
const DAY = 864e5;
export const daysAgo = (n: number, from = Date.now()) => new Date(from - n * DAY);

export interface FixtureCustomer {
  userId: string;
  profileId: string;
  membershipId: string;
}

export async function makeCustomer(
  db: pg.Client,
  opts: {
    merchantId?: string;
    programId?: string;
    versionId?: string;
    joinedAt?: Date;
    branchId?: string;
    balance?: number;
    name?: string;
  } = {},
): Promise<FixtureCustomer> {
  const merchantId = opts.merchantId ?? ids.merchantA,
    userId = randomUUID(),
    profileId = randomUUID(),
    membershipId = randomUUID(),
    email = 'fx-' + userId.slice(0, 8) + '@example.test',
    joinedAt = opts.joinedAt ?? new Date();
  await db.query(
    "INSERT INTO users(id,email,display_name,global_role) VALUES($1,$2,$3,'customer')",
    [userId, email, opts.name ?? 'عميل ' + userId.slice(0, 4)],
  );
  await db.query(
    'INSERT INTO tenant_customer_profiles(id,merchant_id,user_id,alias,contact_email,created_at) VALUES($1,$2,$3,$4,$5,$6)',
    [profileId, merchantId, userId, opts.name ?? 'عميل ' + userId.slice(0, 4), email, joinedAt],
  );
  await db.query(
    "INSERT INTO memberships(id,merchant_id,profile_id,user_id,program_id,program_version_id,source,origin_branch_id,joined_at) VALUES($1,$2,$3,$4,$5,$6,'qr',$7,$8)",
    [
      membershipId,
      merchantId,
      profileId,
      userId,
      opts.programId ?? programA,
      opts.versionId ?? versionA,
      opts.branchId ?? ids.branchA,
      joinedAt,
    ],
  );
  await db.query(
    'INSERT INTO loyalty_accounts(membership_id,merchant_id,program_version_id,balance) VALUES($1,$2,$3,$4) ON CONFLICT (membership_id) DO UPDATE SET balance=EXCLUDED.balance',
    [membershipId, merchantId, opts.versionId ?? versionA, opts.balance ?? 0],
  );
  // A starting balance comes from a welcome stamp (never a visit) with its ledger row, so the
  // shop's balances still add up for the platform health check.
  if (opts.balance) {
    const tx = randomUUID();
    await db.query(
      "INSERT INTO loyalty_transactions(id,public_reference,merchant_id,membership_id,program_version_id,branch_id,operation_id,type,quantity,source,at) VALUES($1,$2,$3,$4,$5,$6,$7,'award',$8,'welcome',$9)",
      [
        tx,
        'FX-' + tx.slice(0, 12),
        merchantId,
        membershipId,
        opts.versionId ?? versionA,
        opts.branchId ?? ids.branchA,
        await operation(db, merchantId),
        opts.balance,
        joinedAt,
      ],
    );
    await db.query(
      "INSERT INTO ledger_entries(merchant_id,membership_id,transaction_id,program_version_id,type,amount) VALUES($1,$2,$3,$4,'earn',$5)",
      [merchantId, membershipId, tx, opts.versionId ?? versionA, opts.balance],
    );
  }
  return { userId, profileId, membershipId };
}

async function operation(db: pg.Client, merchantId: string) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO operations(id,actor_id,merchant_id,scope,idempotency_key,request_hash,status,committed_at) VALUES($1,$2,$3,'fixture',$4,'fixture','committed',now())",
    [id, ids.ownerA, merchantId, randomUUID()],
  );
  return id;
}

/** One award transaction at `at`. Automatic stamps need no staff and no receipt. */
export async function stamp(
  db: pg.Client,
  c: FixtureCustomer,
  at: Date,
  opts: {
    merchantId?: string;
    versionId?: string;
    branchId?: string;
    quantity?: number;
    source?: 'auto' | 'request' | 'welcome';
    staffId?: string | null;
    receipt?: string | null;
  } = {},
) {
  const merchantId = opts.merchantId ?? ids.merchantA,
    id = randomUUID(),
    source = opts.source ?? 'auto';
  await db.query(
    "INSERT INTO loyalty_transactions(id,public_reference,merchant_id,membership_id,program_version_id,branch_id,staff_id,operation_id,type,quantity,source,receipt_note,at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'award',$9,$10,$11,$12)",
    [
      id,
      'FX-' + id.slice(0, 12),
      merchantId,
      c.membershipId,
      opts.versionId ?? versionA,
      opts.branchId ?? ids.branchA,
      source === 'request' ? (opts.staffId ?? ids.staffCashier) : (opts.staffId ?? null),
      await operation(db, merchantId),
      opts.quantity ?? 1,
      source,
      source === 'request' ? (opts.receipt ?? 'R-' + id.slice(0, 6)) : null,
      at,
    ],
  );
  return id;
}

/** Takes back `quantity` stamps of an earlier award. */
export async function revoke(
  db: pg.Client,
  c: FixtureCustomer,
  awardId: string,
  quantity: number,
  at: Date,
) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO loyalty_transactions(id,public_reference,merchant_id,membership_id,program_version_id,branch_id,staff_id,operation_id,type,quantity,source,original_transaction_id,at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'correction',$9,'revoke',$10,$11)",
    [
      id,
      'FX-' + id.slice(0, 12),
      ids.merchantA,
      c.membershipId,
      versionA,
      ids.branchA,
      ids.staffA,
      await operation(db, ids.merchantA),
      -quantity,
      awardId,
      at,
    ],
  );
}

/** A moment at `hh:mm` local Cairo time `n` days ago. */
export function cairo(n: number, hh: number, mm = 0) {
  const d = new Date(Date.now() - n * DAY);
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  // Cairo offset for that day: compare a UTC wall clock with its Cairo rendering.
  const probe = new Date(local + 'T12:00:00Z');
  const cairoHour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      hour12: false,
    }).format(probe),
  );
  const offset = cairoHour - 12;
  return new Date(
    Date.parse(
      local + 'T' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':00Z',
    ) -
      offset * 3600e3,
  );
}
