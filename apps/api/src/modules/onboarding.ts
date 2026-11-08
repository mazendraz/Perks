import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createFileStore, type FileStore } from '../storage/file-store.js';
import { sanitizeLogo } from '../storage/logo.js';
import { z } from 'zod';
import QRCode from 'qrcode';
import { authenticated } from '../auth.js';
import { transaction, type Actor, type DB, type Pools } from '../db.js';
import { platform } from '../policy.js';
import { requireCondition } from '../errors.js';
import { hashPassword } from '../passwords.js';
import { tokenHash } from '../crypto.js';
import type { Config } from '../config.js';

async function editable(db: DB, actor: Actor, id: string, revision?: number) {
  const draft = (
    await db.query(
      "SELECT * FROM provisioning_drafts WHERE id=$1 AND created_by=$2 AND status='draft' FOR UPDATE",
      [id, actor.id],
    )
  ).rows[0];
  requireCondition(draft, 'NOT_FOUND', 404);
  if (revision !== undefined)
    requireCondition(draft.revision === revision, 'REVISION_CONFLICT', 409);
  return draft;
}
export async function publishDraftLogo(
  db: DB,
  actor: Actor,
  draftId: string,
  merchantId: string,
  assetId: string,
  files: FileStore,
) {
  const logo = (
    await db.query(
      'SELECT * FROM provisioning_logos WHERE id=$1 AND draft_id=$2 AND created_by=$3',
      [assetId, draftId, actor.id],
    )
  ).rows[0];
  requireCondition(logo, 'LOGO_NOT_FOUND', 422);
  const bytes = await files.get(draftId + '/' + assetId + '.png');
  requireCondition(tokenHash(bytes.toString('base64')) === logo.sha256, 'UNSAFE_FILE', 422);
  await files.put(merchantId + '/' + assetId + '.png', bytes, { contentType: 'image/png' });
  await db.query(
    "INSERT INTO assets(id,merchant_id,storage_key,mime,bytes,width,height,sha256,created_by) VALUES($1,$2,$3,'image/png',$4,$5,$6,$7,$8)",
    [
      assetId,
      merchantId,
      merchantId + '/' + assetId + '.png',
      logo.bytes,
      logo.width,
      logo.height,
      logo.sha256,
      actor.id,
    ],
  );
  await db.query('UPDATE merchants SET logo_asset_id=$1 WHERE id=$2', [assetId, merchantId]);
}
export function onboardingModule(app: FastifyInstance, pools: Pools, c: Config) {
  const files = createFileStore(c);
  app.get('/api/v1/platform/provisioning-drafts/:id/credentials', async (req) => {
    const actor = authenticated(req);
    platform(actor);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        await editable(db, actor, id);
        return {
          emails: (
            await db.query(
              'SELECT email FROM provisioning_credentials WHERE draft_id=$1 AND created_by=$2',
              [id, actor.id],
            )
          ).rows.map((r) => r.email as string),
        };
      },
      actor,
    );
  });
  app.post(
    '/api/v1/platform/provisioning-drafts/:id/credentials',
    { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } },
    async (req) => {
      const actor = authenticated(req);
      platform(actor);
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const body = z
        .object({
          revision: z.number().int().positive(),
          accounts: z
            .array(
              z
                .object({
                  email: z.email().transform((e) => e.toLowerCase()),
                  password: z.string().min(10).max(128),
                })
                .strict(),
            )
            .min(1)
            .max(40),
        })
        .strict()
        .parse(req.body);
      // Authorize before expensive hashing, and recheck revision after it.
      await transaction(pools.pool, (db) => editable(db, actor, id, body.revision), actor);
      const hashes: { email: string; password: string }[] = [];
      for (const account of body.accounts)
        hashes.push({ ...account, password: await hashPassword(account.password, c.AUTH_PEPPER) });
      return transaction(
        pools.pool,
        async (db) => {
          const draft = await editable(db, actor, id, body.revision);
          for (const a of hashes) {
            requireCondition(
              draft.data.staff?.some(
                (s: { email: string; accessMode?: string }) =>
                  s.email.toLowerCase() === a.email && s.accessMode === 'password',
              ),
              'ACCOUNT_NOT_IN_DRAFT',
              422,
            );
            await db.query(
              'INSERT INTO provisioning_credentials(draft_id,email,password_hash,created_by) VALUES($1,$2,$3,$4) ON CONFLICT(draft_id,email) DO UPDATE SET password_hash=excluded.password_hash,updated_at=now()',
              [id, a.email, a.password, actor.id],
            );
          }
          return { emails: hashes.map((a) => a.email) };
        },
        actor,
      );
    },
  );
  app.post(
    '/api/v1/platform/provisioning-drafts/:id/logo',
    { bodyLimit: 3_000_000 },
    async (req) => {
      const actor = authenticated(req);
      platform(actor);
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const body = z
        .object({ base64: z.string().max(2_800_000) })
        .strict()
        .parse(req.body);
      await transaction(pools.pool, (db) => editable(db, actor, id), actor);
      const sanitized = await sanitizeLogo(body.base64),
        output = sanitized.bytes,
        info = sanitized;
      return transaction(
        pools.pool,
        async (db) => {
          await editable(db, actor, id);
          const assetId = randomUUID();
          await files.put(id + '/' + assetId + '.png', output, { contentType: 'image/png' });
          await db.query(
            'INSERT INTO provisioning_logos(id,draft_id,created_by,bytes,width,height,sha256) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [
              assetId,
              id,
              actor.id,
              output.length,
              info.width,
              info.height,
              tokenHash(output.toString('base64')),
            ],
          );
          return { asset: { id: assetId, width: info.width, height: info.height } };
        },
        actor,
      );
    },
  );
  app.get('/api/v1/platform/provisioning-drafts/:id/logo/:asset', async (req, reply) => {
    const actor = authenticated(req);
    platform(actor);
    const { id, asset } = z.object({ id: z.uuid(), asset: z.uuid() }).parse(req.params);
    await transaction(
      pools.pool,
      async (db) => {
        requireCondition(
          (
            await db.query(
              'SELECT id FROM provisioning_logos WHERE id=$1 AND draft_id=$2 AND created_by=$3',
              [asset, id, actor.id],
            )
          ).rowCount,
          'NOT_FOUND',
          404,
        );
      },
      actor,
    );
    return reply
      .type('image/png')
      .header('X-Content-Type-Options', 'nosniff')
      .send(await files.get(id + '/' + asset + '.png'));
  });
  app.get('/api/v1/platform/provisioning-drafts/:id/qr', async (req, reply) => {
    const actor = authenticated(req);
    platform(actor);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const draft = await transaction(pools.pool, (db) => editable(db, actor, id), actor);
    const slug = z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}$/)
      .parse(draft.data.slug);
    return reply.type('image/png').send(
      await QRCode.toBuffer(c.PUBLIC_APP_ORIGIN + '/join/' + slug, {
        margin: 4,
        width: 512,
        errorCorrectionLevel: 'M',
      }),
    );
  });
}
