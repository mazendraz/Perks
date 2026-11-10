import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config.js';
import { authenticated } from '../auth.js';
import { transaction, type Pools } from '../db.js';
import { requireCondition } from '../errors.js';
import { safeEqual, tokenHash } from '../crypto.js';
import { createFileStore } from '../storage/file-store.js';
import {
  buildPkpass,
  loadAppleSigner,
  passAuthToken,
  type AppleWalletSigner,
  type WalletCard,
} from '../wallet/apple-pass.js';
import { APPLE_PASS_MIME, APPLE_SERVICE_PREFIX } from '../wallet/constants.js';

const device = z.string().regex(/^[A-Za-z0-9._-]{1,128}$/);
const serial = z.uuid();
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
  async function send(reply: FastifyReply, card: WalletCard, id: string) {
    const body = await buildPkpass(card, {
      serial: id,
      authToken: passAuthToken(id, c.AUTH_PEPPER),
      origin: c.PUBLIC_APP_ORIGIN,
      signer: signer!,
      logo: await logo(card),
    });
    return reply
      .type(APPLE_PASS_MIME)
      .header('Content-Disposition', 'attachment; filename="perks-card.pkpass"')
      .header('X-Content-Type-Options', 'nosniff')
      .send(body);
  }
  app.get('/api/v1/wallet/availability', async () => ({ apple: !!signer }));
  app.get('/api/v1/me/memberships/:id/wallet/apple', async (req, reply) => {
    const actor = authenticated(req),
      { id } = z.object({ id: z.uuid() }).parse(req.params);
    requireCondition(signer, 'WALLET_UNAVAILABLE', 404);
    const candidate = randomUUID();
    const issued = await transaction(
      pools.pool,
      async (db) => {
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
        return { serial: s, card };
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
    return send(reply, card, p.data.serial);
  });
  app.post(
    wallet + '/log',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const logs = z.object({ logs: z.array(z.string().max(500)).max(20) }).safeParse(req.body);
      // Device log lines can contain identifiers; record only that Wallet reported a problem.
      if (logs.success && logs.data.logs.length)
        req.log.warn({ event: 'wallet.apple_log', count: logs.data.logs.length });
      return reply.code(200).send();
    },
  );
}
