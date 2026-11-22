import { withOpenUrl } from '../wallet/restore.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config.js';
import { authenticated } from '../auth.js';
import { transaction, type DB, type Pools } from '../db.js';
import { requireCondition } from '../errors.js';
import { safeEqual, tokenHash } from '../crypto.js';
import { createFileStore } from '../storage/file-store.js';
import {
  logoAssets,
  buildPkpass,
  loadAppleSigner,
  passAuthToken,
  type AppleWalletSigner,
  type WalletCard,
} from '../wallet/apple-pass.js';
import { APPLE_PASS_MIME, APPLE_SERVICE_PREFIX } from '../wallet/constants.js';
import sharp from 'sharp';
import { googleHeroSvg } from '../wallet/pass-artwork.js';
import { walletTheme } from '../../../../packages/domain/src/wallet-theme.js';
import {
  GOOGLE_LOGO_PREFIX,
  GOOGLE_STRIP_PREFIX,
  googleLogoTile,
  loadGoogleWallet,
  refreshSavedGoogleCard,
  saveUrl,
  stripVersion,
} from '../wallet/google-wallet.js';

const device = z.string().regex(/^[A-Za-z0-9._-]{1,128}$/);
/** An Apple Wallet device log line without anything that identifies a card, person or device. */
export const scrubWalletLog = (line: string) =>
  line
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/[^\s@]+@[^\s@]+/g, '<email>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/[A-Za-z0-9_-]{24,}/g, '<token>')
    .replace(/\d{6,}/g, '<n>')
    .slice(0, 300);
const serial = z.uuid();
const fullWalletAccess = async (db: DB) =>
  (await db.query('SELECT customer_scope_unrestricted() AS allowed')).rows[0].allowed as boolean;

export function walletModule(app: FastifyInstance, pools: Pools, c: Config) {
  const signer: AppleWalletSigner | null = loadAppleSigner(c);
  const files = createFileStore(c);
  async function logo(card: WalletCard & { logo_asset_id?: string | null }) {
    if (!card.logo_asset_id) return null;
    const key = (
      await pools.pool.query('SELECT published_logo($1,$2) AS key', [
        card.merchant_id,
        card.logo_asset_id,
      ])
    ).rows[0]?.key;
    if (key !== card.merchant_id + '/' + card.logo_asset_id + '.png') return null;
    try {
      return await files.get(key);
    } catch {
      return null;
    }
  }
  function build(card: WalletCard, id: string) {
    return logo(card).then((image) =>
      buildPkpass(card, {
        serial: id,
        authToken: passAuthToken(id, c.AUTH_PEPPER),
        origin: c.PUBLIC_APP_ORIGIN,
        signer: signer!,
        logo: image,
      }),
    );
  }
  function deliver(reply: FastifyReply, body: Buffer) {
    return reply
      .type(APPLE_PASS_MIME)
      .header('Content-Disposition', 'attachment; filename="perks-card.pkpass"')
      .header('X-Content-Type-Options', 'nosniff')
      .send(body);
  }
  async function send(reply: FastifyReply, card: WalletCard, id: string) {
    return deliver(reply, await build(card, id));
  }
  const google = loadGoogleWallet(c);
  app.get('/api/v1/wallet/availability', async (req) => {
    const availability = { apple: !!signer, google: !!google };
    if ((signer || google) && req.actor?.authMethod === 'device') {
      const allowed = await transaction(pools.pool, fullWalletAccess, req.actor);
      if (!allowed) return { ...availability, recoveryRequired: true };
    }
    return availability;
  });
  app.get('/api/v1/me/memberships/:id/wallet/google', async (req, reply) => {
    const actor = authenticated(req),
      { id } = z.object({ id: z.uuid() }).parse(req.params);
    const issued = await transaction(
      pools.pool,
      async (db) => {
        // A newly issued pass can unlock the entire account. A shop-scoped session cannot mint it.
        requireCondition(await fullWalletAccess(db), 'DEVICE_SCOPE_RECOVERY_REQUIRED', 409);
        requireCondition(google, 'WALLET_UNAVAILABLE', 404);
        return (await db.query('SELECT google_wallet_issue($1,$2) AS value', [id, randomUUID()]))
          .rows[0].value as {
          object_key: string;
          card: WalletCard & { logo_asset_id?: string };
        } | null;
      },
      actor,
    );
    requireCondition(issued, 'NOT_FOUND', 404);
    issued.card = withOpenUrl(issued.card, c.PUBLIC_APP_ORIGIN, c.AUTH_PEPPER);
    // Tests never call Google; everywhere else the stored card is refreshed first.
    if (c.APP_ENV !== 'test')
      await refreshSavedGoogleCard(
        google!,
        issued.card,
        issued.object_key,
        c.PUBLIC_APP_ORIGIN,
        stripVersion(issued.card),
      );
    return reply.redirect(
      saveUrl(
        google!,
        issued.card,
        issued.object_key,
        c.PUBLIC_APP_ORIGIN,
        stripVersion(issued.card),
      ),
      303,
    );
  });
  // Google fetches the stamp strip by URL; the random key is the only handle and it shows no name.
  app.get(GOOGLE_STRIP_PREFIX + '/:key/:version', async (req, reply) => {
    const p = z
      .object({ key: z.uuid(), version: z.string().regex(/^[0-9a-f]{12}\.png$/) })
      .safeParse(req.params);
    if (!p.success || !google) return reply.code(404).send();
    const card = (await pools.pool.query('SELECT google_wallet_strip($1) AS card', [p.data.key]))
      .rows[0].card as (WalletCard & { logo_asset_id?: string | null }) | null;
    if (!card) return reply.code(404).send();
    // The "Your logo" edition draws the shop logo behind the stamps.
    const source = walletTheme(card).art.kind === 'logo' ? await logo(card) : null;
    const watermark = source ? (await logoAssets(source)).artwork : null;
    // The whole card face, in the large image size of Google's current pass design.
    const image = await sharp(Buffer.from(googleHeroSvg(card, 2, true, watermark)))
      .resize(1032, 812)
      .png()
      .toBuffer();
    return reply
      .type('image/png')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'public, max-age=300')
      .send(image);
  });
  // The shop logo for Google's round logo slot. Same publishing rule as the public logo route.
  // The shop logo for Google's round logo slot, on the card colour. Same publishing rule as
  // the public logo route.
  app.get(GOOGLE_LOGO_PREFIX + '/:m/:asset/:bg', async (req, reply) => {
    const p = z
      .object({ m: z.uuid(), asset: z.uuid(), bg: z.string().regex(/^[0-9a-f]{6}\.png$/) })
      .safeParse(req.params);
    if (!p.success || !google) return reply.code(404).send();
    const key = (
      await pools.pool.query('SELECT published_logo($1,$2) AS key', [p.data.m, p.data.asset])
    ).rows[0]?.key;
    if (key !== p.data.m + '/' + p.data.asset + '.png') return reply.code(404).send();
    let source: Buffer;
    try {
      source = await files.get(key);
    } catch {
      return reply.code(404).send();
    }
    return reply
      .type('image/png')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'public, max-age=3600')
      .send(await googleLogoTile(source, '#' + p.data.bg.slice(0, 6)));
  });
  app.get('/api/v1/me/memberships/:id/wallet/apple', async (req, reply) => {
    const actor = authenticated(req),
      { id } = z.object({ id: z.uuid() }).parse(req.params);
    const candidate = randomUUID();
    const issued = await transaction(
      pools.pool,
      async (db) => {
        requireCondition(await fullWalletAccess(db), 'DEVICE_SCOPE_RECOVERY_REQUIRED', 409);
        requireCondition(signer, 'WALLET_UNAVAILABLE', 404);
        const s = (
          await db.query('SELECT wallet_issue_pass($1,$2,$3) AS serial', [
            id,
            candidate,
            tokenHash(passAuthToken(candidate, c.AUTH_PEPPER)),
          ])
        ).rows[0].serial as string | null;
        requireCondition(s, 'NOT_FOUND', 404);
        const card = (
          await db.query('SELECT wallet_pass_card($1,$2) AS card', [
            s,
            tokenHash(passAuthToken(s, c.AUTH_PEPPER)),
          ])
        ).rows[0].card as WalletCard | null;
        requireCondition(card, 'NOT_FOUND', 404);
        return { serial: s, card: withOpenUrl(card, c.PUBLIC_APP_ORIGIN, c.AUTH_PEPPER) };
      },
      actor,
    );
    return send(reply, issued.card, issued.serial);
  });

  // Apple PassKit web service (developer.apple.com/documentation/walletpasses).
  const passToken = (req: FastifyRequest) => {
    const header = String(req.headers.authorization || '');
    return header.startsWith('ApplePass ') ? header.slice('ApplePass '.length).trim() : '';
  };
  const typeMatches = (value: string) => !!signer && value === signer.passTypeIdentifier;
  const authorizedHash = (req: FastifyRequest, id: string) => {
    const token = passToken(req);
    return token && safeEqual(token, passAuthToken(id, c.AUTH_PEPPER)) ? tokenHash(token) : null;
  };
  const wallet = APPLE_SERVICE_PREFIX + '/v1';
  app.post(
    wallet + '/devices/:device/registrations/:type/:serial',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const p = z.object({ device, type: z.string(), serial }).safeParse(req.params);
      const push = z
        .object({ pushToken: z.string().regex(/^[0-9A-Fa-f]{16,200}$/) })
        .safeParse(req.body);
      if (!p.success || !typeMatches(p.data.type)) return reply.code(404).send();
      const hash = authorizedHash(req, p.data.serial);
      if (!hash) return reply.code(401).send();
      if (!push.success) return reply.code(400).send();
      const result = (
        await pools.pool.query('SELECT wallet_register($1,$2,$3,$4) AS result', [
          p.data.device,
          push.data.pushToken,
          p.data.serial,
          hash,
        ])
      ).rows[0].result;
      if (result === 'unauthorized') return reply.code(401).send();
      if (result === 'limited') return reply.code(429).send();
      return reply.code(result === 'created' ? 201 : 200).send();
    },
  );
  app.delete(wallet + '/devices/:device/registrations/:type/:serial', async (req, reply) => {
    const p = z.object({ device, type: z.string(), serial }).safeParse(req.params);
    if (!p.success || !typeMatches(p.data.type)) return reply.code(404).send();
    const hash = authorizedHash(req, p.data.serial);
    if (!hash) return reply.code(401).send();
    const ok = (
      await pools.pool.query('SELECT wallet_unregister($1,$2,$3) AS ok', [
        p.data.device,
        p.data.serial,
        hash,
      ])
    ).rows[0].ok;
    return reply.code(ok ? 200 : 401).send();
  });
  app.get(wallet + '/devices/:device/registrations/:type', async (req, reply) => {
    const p = z.object({ device, type: z.string() }).safeParse(req.params);
    if (!p.success || !typeMatches(p.data.type)) return reply.code(404).send();
    const since = z
      .object({
        passesUpdatedSince: z
          .string()
          .regex(/^\d{1,18}$/)
          .optional(),
      })
      .safeParse(req.query);
    const sinceTag =
      since.success && since.data.passesUpdatedSince ? since.data.passesUpdatedSince : null;
    const rows = (
      await pools.pool.query('SELECT serial,tag::text AS tag FROM wallet_updated_serials($1,$2)', [
        p.data.device,
        sinceTag,
      ])
    ).rows as { serial: string; tag: string }[];
    if (!rows.length) return reply.code(204).send();
    const last = rows.map((r) => BigInt(r.tag)).reduce((a, b) => (b > a ? b : a));
    return { serialNumbers: rows.map((r) => r.serial), lastUpdated: String(last) };
  });
  app.get(wallet + '/passes/:type/:serial', async (req, reply) => {
    const p = z.object({ type: z.string(), serial }).safeParse(req.params);
    if (!p.success || !typeMatches(p.data.type)) return reply.code(404).send();
    const hash = authorizedHash(req, p.data.serial);
    if (!hash) return reply.code(401).send();
    const card = (
      await pools.pool.query('SELECT wallet_pass_card($1,$2) AS card', [p.data.serial, hash])
    ).rows[0].card as (WalletCard & { changed_at: string }) | null;
    if (!card) return reply.code(401).send();
    // Round up to whole seconds so a change within the same second is never answered 304.
    const modified = new Date(Math.ceil(new Date(card.changed_at).getTime() / 1000) * 1000);
    const since = Date.parse(String(req.headers['if-modified-since'] || ''));
    if (!Number.isNaN(since) && modified.getTime() <= since) return reply.code(304).send();
    reply.header('Last-Modified', modified.toUTCString());
    // Built before anything is recorded, so a pass that fails to build confirms nothing.
    const body = await build(withOpenUrl(card, c.PUBLIC_APP_ORIGIN, c.AUTH_PEPPER), p.data.serial);
    // The phone is getting the shop's message: that, not APNs taking the push, is "reached".
    if (card.manual_message?.id)
      await pools.pool
        .query('SELECT wallet_pass_fetched($1,$2,$3)', [
          p.data.serial,
          hash,
          card.manual_message.id,
        ])
        .catch(() => req.log.warn({ event: 'wallet.fetch_record_failed' }));
    return deliver(reply, body);
  });
  app.post(
    wallet + '/log',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const logs = z.object({ logs: z.array(z.string().max(500)).max(20) }).safeParse(req.body);
      // Wallet reports why an update failed (bad signature, unreachable service...). The reason is
      // kept; serials, tokens, links, addresses and long numbers are blanked first.
      if (logs.success && logs.data.logs.length)
        req.log.warn({
          event: 'wallet.apple_log',
          count: logs.data.logs.length,
          lines: logs.data.logs.map(scrubWalletLog),
        });
      return reply.code(200).send();
    },
  );
}
