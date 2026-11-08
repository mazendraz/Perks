import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { DB } from './db.js';
const key = (pepper: string) =>
  createHash('sha256')
    .update('nuqta-outbox:' + pepper)
    .digest();
export function seal(value: string, pepper: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(pepper), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}
export function unseal(value: string, pepper: string) {
  const raw = Buffer.from(value, 'base64url'),
    decipher = createDecipheriv('aes-256-gcm', key(pepper), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
export async function emitOutbox(
  db: Pick<DB, 'query'>,
  p: {
    merchantId: string;
    eventType: string;
    aggregateId: string;
    revision?: number;
    payload?: Record<string, unknown>;
    dedupeKey: string;
    kind: string;
  },
) {
  const r = await db.query(
    'INSERT INTO outbox_events(merchant_id,event_type,aggregate_id,aggregate_revision,payload,dedupe_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id',
    [p.merchantId, p.eventType, p.aggregateId, p.revision || 1, p.payload || {}, p.dedupeKey],
  );
  const id =
    r.rows[0]?.id ||
    (await db.query('SELECT id FROM outbox_events WHERE dedupe_key=$1', [p.dedupeKey])).rows[0]?.id;
  await db.query(
    'INSERT INTO background_jobs(merchant_id,outbox_id,kind) VALUES($1,$2,$3) ON CONFLICT(outbox_id,kind) DO NOTHING',
    [p.merchantId, id, p.kind],
  );
}
