import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { Actor, DB } from './db.js';
import { canonicalJson } from './crypto.js';
import { requireCondition } from './errors.js';
export function idempotencyKey(req: FastifyRequest) {
  return z
    .string()
    .min(8)
    .max(120)
    .regex(/^[A-Za-z0-9:_-]+$/)
    .parse(req.headers['idempotency-key']);
}
export function expectedRevision(req: FastifyRequest) {
  return z.coerce.number().int().min(1).parse(req.headers['if-match']);
}
export async function operation<T extends Record<string, unknown>>(
  db: DB,
  actor: Actor,
  p: { scope: string; key: string; payload: unknown; merchantId?: string },
  fn: (id: string) => Promise<T>,
): Promise<T & { operationId: string }> {
  const hash = createHash('sha256').update(canonicalJson(p.payload)).digest('hex');
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    actor.id + ':' + p.scope + ':' + p.key,
  ]);
  const existing = (
    await db.query(
      'SELECT id,request_hash,result FROM operations WHERE actor_id=$1 AND scope=$2 AND idempotency_key=$3',
      [actor.id, p.scope, p.key],
    )
  ).rows[0];
  if (existing) {
    requireCondition(existing.request_hash === hash, 'IDEMPOTENCY_CONFLICT', 409);
    return existing.result as T & { operationId: string };
  }
  const op = (
    await db.query(
      'INSERT INTO operations(actor_id,merchant_id,scope,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [actor.id, p.merchantId || null, p.scope, p.key, hash],
    )
  ).rows[0];
  const data = { ...(await fn(op.id)), operationId: op.id };
  await db.query(
    "UPDATE operations SET status='committed',result=$1,committed_at=clock_timestamp() WHERE id=$2",
    [data, op.id],
  );
  return data;
}
