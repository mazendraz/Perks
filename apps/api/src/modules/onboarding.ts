import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
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
) {
  const logo = (
    await db.query(
      'SELECT * FROM provisioning_logos WHERE id=$1 AND draft_id=$2 AND created_by=$3',
      [assetId, draftId, actor.id],
    )
  ).rows[0];
  requireCondition(logo, 'LOGO_NOT_FOUND', 422);
  const bytes = await readFile(resolve('.local/draft-assets', actor.id, draftId, assetId + '.png'));
  requireCondition(tokenHash(bytes.toString('base64')) === logo.sha256, 'UNSAFE_FILE', 422);
  const dir = resolve('.local/assets', merchantId);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, assetId + '.png'), bytes, { flag: 'wx', mode: 0o600 });
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
      requireCondition(
        ['development', 'test'].includes(c.APP_ENV),
        'OBJECT_STORAGE_NOT_CONFIGURED',
        503,
      );
      const raw = Buffer.from(body.base64, 'base64');
      requireCondition(raw.length <= 2_000_000, 'ASSET_TOO_LARGE', 422);
      let output: Buffer, info: { width: number; height: number };
      try {
        const image = sharp(raw, { limitInputPixels: 16_000_000, failOn: 'warning' });
        requireCondition(
          ['png', 'jpeg', 'webp'].includes((await image.metadata()).format || ''),
          'UNSAFE_FILE',
          422,
        );
        const r = await image
          .rotate()
          .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer({ resolveWithObject: true });
        output = r.data;
        info = r.info;
      } catch {
        requireCondition(false, 'UNSAFE_FILE', 422);
      }
      return transaction(
        pools.pool,
        async (db) => {
          await editable(db, actor, id);
          const assetId = randomUUID(),
            dir = resolve('.local/draft-assets', actor.id, id);
          await mkdir(dir, { recursive: true });
          await writeFile(resolve(dir, assetId + '.png'), output, { flag: 'wx', mode: 0o600 });
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
      .send(await readFile(resolve('.local/draft-assets', actor.id, id, asset + '.png')));
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
    return reply
      .type('image/png')
      .send(
        await QRCode.toBuffer(c.PUBLIC_APP_ORIGIN + '/join/' + slug, {
          margin: 4,
          width: 512,
          errorCorrectionLevel: 'M',
        }),
      );
  });
}
