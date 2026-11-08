import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import QRCode from 'qrcode';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Config } from '../config.js';
import { authenticated } from '../auth.js';
import { audit, transaction, type Pools, type DB, type Actor } from '../db.js';
import { merchantGrant, platform } from '../policy.js';
import { idempotencyKey, operation, expectedRevision } from '../operations.js';
import { requireCondition } from '../errors.js';
async function access(db: DB, actor: Actor, m: string, b: string, owner = false) {
  if (actor.role === 'platform_admin') platform(actor);
  else await merchantGrant(db, actor, m, owner ? ['owner'] : ['owner', 'manager', 'cashier'], b);
}
export function materialsModule(app: FastifyInstance, pools: Pools, c: Config) {
  app.get('/api/v1/public/placements/:code', async (req) => {
    const { code } = z.object({ code: z.string().min(20).max(80) }).parse(req.params),
      r = (await pools.pool.query('SELECT resolve_placement($1) AS value', [code])).rows[0]?.value;
    requireCondition(r, 'NOT_FOUND', 404);
    requireCondition(r.status !== 'revoked', 'PLACEMENT_REVOKED', 410);
    requireCondition(r.status === 'active', 'PLACEMENT_UNAVAILABLE', 410);
    return r;
  });
  app.get('/api/v1/public/merchants/:m/logos/:id', async (req, reply) => {
    const { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params);
    const key = (await pools.pool.query('SELECT published_logo($1,$2) AS key', [m, id])).rows[0]
      ?.key;
    requireCondition(key === m + '/' + id + '.png', 'NOT_FOUND', 404);
    return reply
      .type('image/png')
      .header('X-Content-Type-Options', 'nosniff')
      .send(await readFile(resolve('.local/assets', m, id + '.png')));
  });
  app.get('/api/v1/merchants/:m/placements', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        if (actor.role === 'platform_admin') platform(actor, false);
        else await merchantGrant(db, actor, m, ['owner', 'manager']);
        return {
          placements: (
            await db.query(
              'SELECT p.*,b.name AS branch_name FROM placements p JOIN branches b ON b.id=p.branch_id WHERE p.merchant_id=$1 ORDER BY p.created_at DESC',
              [m],
            )
          ).rows.map((p) => ({
            ...p,
            url: c.PUBLIC_APP_ORIGIN + '/p/' + p.public_code,
            qrUrl: c.PUBLIC_APP_ORIGIN + '/p/' + p.public_code + '?src=qr',
            nfcUrl: c.PUBLIC_APP_ORIGIN + '/p/' + p.public_code + '?src=nfc',
          })),
        };
      },
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/placements', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      p = z
        .object({
          branchId: z.uuid(),
          label: z.string().trim().min(2).max(100),
          kind: z.enum(['stand', 'sticker', 'nfc']),
        })
        .strict()
        .parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        await access(db, actor, m, p.branchId, true);
        return operation(
          db,
          actor,
          { scope: 'placement.create:' + m, key, payload: p, merchantId: m },
          async () => {
            requireCondition(
              (
                await db.query(
                  "SELECT b.id FROM branches b JOIN merchants m ON m.id=b.merchant_id WHERE b.id=$1 AND b.merchant_id=$2 AND b.status='active' AND m.status IN ('active','trial')",
                  [p.branchId, m],
                )
              ).rowCount,
              'BRANCH_UNAUTHORIZED',
              403,
            );
            const row = (
              await db.query(
                'INSERT INTO placements(merchant_id,branch_id,label,kind,public_code,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
                [m, p.branchId, p.label, p.kind, randomBytes(24).toString('base64url'), actor.id],
              )
            ).rows[0];
            await db.query(
              "INSERT INTO placement_events(merchant_id,placement_id,actor_id,action,reason) VALUES($1,$2,$3,'requested','Requested from the application')",
              [m, row.id, actor.id],
            );
            await audit(db, actor, 'placement.create', m, row.id, {
              branchId: p.branchId,
              kind: p.kind,
            });
            return { placement: row };
          },
        );
      },
      actor,
    );
  });
  app.get('/api/v1/merchants/:m/placements/:id/qr', async (req, reply) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params);
    const p = await transaction(
      pools.pool,
      async (db) => {
        const p = (
          await db.query('SELECT * FROM placements WHERE merchant_id=$1 AND id=$2', [m, id])
        ).rows[0];
        requireCondition(p, 'NOT_FOUND', 404);
        await access(db, actor, m, p.branch_id);
        requireCondition(p.status !== 'revoked', 'PLACEMENT_REVOKED', 410);
        return p;
      },
      actor,
    );
    const q = z
      .object({ format: z.enum(['png', 'svg']).default('png'), preview: z.literal('1').optional() })
      .parse(req.query);
    const url = c.PUBLIC_APP_ORIGIN + '/p/' + p.public_code + '?src=qr',
      options = { errorCorrectionLevel: 'M' as const, margin: 4, width: 1024 };
    return reply
      .type(q.format === 'svg' ? 'image/svg+xml' : 'image/png')
      .header(
        'Content-Disposition',
        (q.preview ? 'inline' : 'attachment') + '; filename="nuqta-' + id + '.' + q.format + '"',
      )
      .header('X-Content-Type-Options', 'nosniff')
      .send(
        q.format === 'svg'
          ? await QRCode.toString(url, { ...options, type: 'svg' })
          : await QRCode.toBuffer(url, options),
      );
  });
  app.post('/api/v1/merchants/:m/placements/:id/transition', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params),
      p = z
        .object({
          status: z.enum(['ready', 'shipped', 'installed', 'verified', 'revoked']),
          reason: z.string().trim().min(4).max(500),
          deviceDescription: z.string().trim().min(5).max(200).optional(),
        })
        .strict()
        .parse(req.body),
      revision = expectedRevision(req),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        const placement = (
          await db.query('SELECT * FROM placements WHERE merchant_id=$1 AND id=$2 FOR UPDATE', [
            m,
            id,
          ])
        ).rows[0];
        requireCondition(placement, 'NOT_FOUND', 404);
        await access(db, actor, m, placement.branch_id, p.status === 'revoked');
        if (['ready', 'shipped'].includes(p.status)) platform(actor);
        return operation(
          db,
          actor,
          { scope: 'placement.transition:' + id, key, payload: { ...p, revision }, merchantId: m },
          async () => {
            requireCondition(placement.revision === revision, 'REVISION_CONFLICT', 409);
            const previous: Record<string, string> = {
              ready: 'requested',
              shipped: 'ready',
              installed: 'shipped',
              verified: 'installed',
            };
            requireCondition(
              placement.status !== 'revoked' &&
                (p.status === 'revoked' || placement.status === previous[p.status]),
              'PLACEMENT_TRANSITION_INVALID',
              409,
            );
            if (p.status === 'verified')
              requireCondition(p.deviceDescription, 'DEVICE_EVIDENCE_REQUIRED', 422);
            const row = (
              await db.query(
                'UPDATE placements SET status=$1,revision=revision+1 WHERE id=$2 RETURNING *',
                [p.status, id],
              )
            ).rows[0];
            await db.query(
              'INSERT INTO placement_events(merchant_id,placement_id,actor_id,action,reason,device_description,verification_method) VALUES($1,$2,$3,$4,$5,$6,$7)',
              [
                m,
                id,
                actor.id,
                p.status,
                p.reason,
                p.deviceDescription || null,
                p.status === 'verified' ? 'operator_attestation' : null,
              ],
            );
            await audit(db, actor, 'placement.' + p.status, m, id, {
              reason: p.reason,
              verificationMethod: p.status === 'verified' ? 'operator_attestation' : null,
            });
            return { placement: row };
          },
        );
      },
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/placements/:id/replace', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params),
      p = z
        .object({ reason: z.string().trim().min(4).max(500) })
        .strict()
        .parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        const old = (
          await db.query('SELECT * FROM placements WHERE merchant_id=$1 AND id=$2 FOR UPDATE', [
            m,
            id,
          ])
        ).rows[0];
        requireCondition(old, 'NOT_FOUND', 404);
        await access(db, actor, m, old.branch_id, true);
        return operation(
          db,
          actor,
          { scope: 'placement.replace:' + id, key, payload: p, merchantId: m },
          async () => {
            if (old.replaced_by) return { replacementId: old.replaced_by };
            const row = (
              await db.query(
                'INSERT INTO placements(merchant_id,branch_id,label,kind,public_code,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
                [
                  m,
                  old.branch_id,
                  old.label,
                  old.kind,
                  randomBytes(24).toString('base64url'),
                  actor.id,
                ],
              )
            ).rows[0];
            await db.query(
              "UPDATE placements SET status='revoked',replaced_by=$1,revision=revision+1 WHERE id=$2",
              [row.id, id],
            );
            await db.query(
              "INSERT INTO placement_events(merchant_id,placement_id,actor_id,action,reason) VALUES($1,$2,$3,'replaced',$4),($1,$5,$3,'requested',$4)",
              [m, id, actor.id, p.reason, row.id],
            );
            await audit(db, actor, 'placement.replace', m, id, {
              replacementId: row.id,
              reason: p.reason,
            });
            return { replacementId: row.id };
          },
        );
      },
      actor,
    );
  });
}
