import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type pg from 'pg';
import { canonicalJson } from '../apps/api/src/crypto.js';
const payloadSchema = z
  .object({
    version: z.literal(1),
    instanceId: z.uuid(),
    createdAt: z.iso.datetime(),
    records: z
      .array(z.object({ customerId: z.uuid(), deletedAt: z.iso.datetime() }).strict())
      .max(100000),
  })
  .strict();
const envelopeSchema = z
  .object({ payload: payloadSchema, signature: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
type Manifest = z.infer<typeof envelopeSchema>;
function signature(payload: Manifest['payload'], pepper: string) {
  if (pepper.length < 32) throw new Error('Private signing key required.');
  return createHmac('sha256', pepper)
    .update('nuqta-privacy-manifest-v1\n' + canonicalJson(payload))
    .digest('hex');
}
export async function exportPrivacyManifest(db: pg.Client, pepper: string): Promise<Manifest> {
  const instanceId = (await db.query('SELECT id FROM privacy_instance_identity WHERE singleton'))
    .rows[0].id;
  const records = (
    await db.query(
      'SELECT id AS "customerId",privacy_deleted_at AS "deletedAt" FROM users WHERE privacy_deleted_at IS NOT NULL ORDER BY id',
    )
  ).rows.map((r) => ({ customerId: r.customerId, deletedAt: r.deletedAt.toISOString() }));
  const payload = payloadSchema.parse({
    version: 1,
    instanceId,
    createdAt: new Date().toISOString(),
    records,
  });
  return { payload, signature: signature(payload, pepper) };
}
export async function applyPrivacyManifest(
  db: pg.Client,
  input: unknown,
  pepper: string,
  offlineConfirmed: boolean,
) {
  if (!offlineConfirmed)
    throw new Error('Restore must remain offline until privacy reconciliation completes.');
  const envelope = envelopeSchema.parse(input),
    expected = signature(envelope.payload, pepper);
  if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(envelope.signature, 'hex')))
    throw new Error('Privacy manifest signature rejected.');
  if (
    Date.parse(envelope.payload.createdAt) > Date.now() + 300000 ||
    envelope.payload.records.some(
      (r) => Date.parse(r.deletedAt) > Date.parse(envelope.payload.createdAt) + 300000,
    )
  )
    throw new Error('Privacy manifest clock is invalid.');
  let applied = 0,
    alreadyDeleted = 0,
    missing = 0;
  await db.query('BEGIN');
  try {
    const instance = (
      await db.query('SELECT id FROM privacy_instance_identity WHERE singleton FOR SHARE')
    ).rows[0].id;
    if (instance !== envelope.payload.instanceId)
      throw new Error('Privacy manifest belongs to another deployment.');
    // Stable customer order also matches interactive per-customer lock ordering.
    for (const record of [...envelope.payload.records].sort((a, b) =>
      a.customerId.localeCompare(b.customerId),
    )) {
      const result = (
        await db.query('SELECT anonymize_customer_record($1,$2) AS value', [
          record.customerId,
          record.deletedAt,
        ])
      ).rows[0].value;
      if (result.missing) missing++;
      else if (result.alreadyDeleted) alreadyDeleted++;
      else applied++;
    }
    await db.query('COMMIT');
    return { applied, alreadyDeleted, missing };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}
