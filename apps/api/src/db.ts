import pg from 'pg';
import type { Config } from './config.js';
import { AppError } from './errors.js';
export type DB = pg.PoolClient;
export interface Actor {
  id: string;
  email: string;
  role: 'platform_admin' | 'platform_support' | 'customer';
  sessionId: string;
  mfaAt: Date | null;
  mfaRequired?: boolean;
  locale?: 'ar' | 'en';
  authMethod?: 'otp' | 'password' | 'managed';
  csrfHash: string;
  preview?: { adminId: string; merchantId: string; staffId: string };
}
export function createPools(c: Config) {
  const pool = new pg.Pool({
    connectionString: c.DATABASE_URL,
    max: 12,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 20000,
  });
  const authPool = new pg.Pool({
    connectionString: c.AUTH_DATABASE_URL || c.DATABASE_URL,
    max: 6,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  });
  pool.on('error', () => {});
  authPool.on('error', () => {});
  return { pool, authPool };
}
export type Pools = ReturnType<typeof createPools>;
export async function transaction<T>(
  pool: pg.Pool,
  fn: (db: DB) => Promise<T>,
  actor?: Actor,
  attempt = 0,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    if (actor?.preview) await db.query('SET TRANSACTION READ ONLY');
    if (actor) await db.query("SELECT set_config('app.user_id',$1,true)", [actor.id]);
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    const code = (error as { code?: string }).code;
    if (actor?.preview && code === '25006') throw new AppError('OWNER_PREVIEW_READ_ONLY', 403);
    if (['40001', '40P01'].includes(code || '') && attempt < 2)
      return transaction(pool, fn, actor, attempt + 1);
    if (code === '23514') throw new AppError('VALIDATION_FAILED', 422);
    if (code === '23505') throw new AppError('CONFLICT', 409);
    if (code === '23503' || code === '42501') throw new AppError('NOT_FOUND', 404);
    const message = error instanceof Error ? error.message : '';
    if (code === 'P0001' && /^NQ:[A-Z_]+$/.test(message)) {
      const name = message.slice(3);
      throw new AppError(name, name === 'NOT_FOUND' ? 404 : name === 'UNAUTHENTICATED' ? 401 : 409);
    }
    throw error;
  } finally {
    db.release();
  }
}
export async function audit(
  db: DB,
  actor: Actor,
  action: string,
  merchantId: string | null,
  targetId: string | null,
  detail: Record<string, unknown> = {},
) {
  await db.query(
    'INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail) VALUES($1,$2,$3,$4,$5)',
    [actor.id, merchantId, action, targetId, detail],
  );
}
