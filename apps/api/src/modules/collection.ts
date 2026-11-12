import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  collectionSettingsInput,
  branchPositionInput,
  stampCollectionInput,
} from '../../../../packages/contracts/src/commands.js';
import {
  distanceMeters,
  GOOGLE_MAPS_HOST,
  parseMapsPosition,
  SHORT_MAPS_LINK,
} from '../../../../packages/domain/src/geo.js';
import type { Config } from '../config.js';
import { authenticated } from '../auth.js';
import { audit, transaction, type Pools } from '../db.js';
import { requireCondition } from '../errors.js';
import { expectedRevision, idempotencyKey, operation } from '../operations.js';
import { platform } from '../policy.js';
import { createStampRequest } from './requests.js';

const columns =
  'require_location AS "requireLocation",require_cashier AS "requireCashier",max_accuracy_m AS "maxAccuracy",collections_per_day AS "collectionsPerDay",stamps_per_day AS "stampsPerDay",limit_window AS "limitWindow",cooldown_minutes AS "cooldownMinutes",default_stamps AS "defaultStamps",allow_multiple AS "allowMultiple",max_stamps_per_collection AS "maxStampsPerCollection",welcome_stamps AS "welcomeStamps",auto_branch_hourly_cap AS "autoBranchHourlyCap",open_collection_acknowledged AS "openCollectionAcknowledged",revision';
// Follows a Google Maps share link to the full link holding the coordinates.
// Only Google's own hosts are contacted, at most four hops, with a short timeout.
export async function resolveShortMapsLink(url: string, fetchImpl: typeof fetch = fetch) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const host = new URL(current).hostname;
    if (new URL(current).protocol !== 'https:' || !GOOGLE_MAPS_HOST.test(host)) return null;
    const position = parseMapsPosition(current);
    if (position) return position;
    const response = await fetchImpl(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
      headers: { 'user-agent': 'Mozilla/5.0 (Perks branch setup)' },
    });
    const next = response.headers.get('location');
    if (!next) {
      // Some links answer with the full page; the pin is in its canonical address.
      const body = response.ok ? (await response.text()).slice(0, 400_000) : '';
      const found = /https:\/\/www\.google\.[a-z.]+\/maps\/[^"'\s<>]+/.exec(body)?.[0];
      return found ? parseMapsPosition(found.replace(/\\u0026/g, '&')) : null;
    }
    current = new URL(next, current).href;
  }
  return parseMapsPosition(current);
}
export function collectionModule(
  app: FastifyInstance,
  pools: Pools,
  c: Config,
  fetchImpl: typeof fetch = fetch,
) {
  app.post(
    '/api/v1/platform/maps/resolve',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (req) => {
      const actor = authenticated(req);
      platform(actor, false);
      const { url } = z
        .object({ url: z.string().trim().max(300).regex(SHORT_MAPS_LINK) })
        .strict()
        .parse(req.body);
      const position = await resolveShortMapsLink(url, fetchImpl).catch(() => null);
      requireCondition(position, 'MAPS_LINK_UNREADABLE', 422);
      return position;
    },
  );
  app.get('/api/v1/platform/merchants/:m/stamp-collection-settings', async (req) => {
    const actor = authenticated(req);
    platform(actor, false);
    const { m } = z.object({ m: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        const settings = (
          await db.query(
            'SELECT ' + columns + ' FROM stamp_collection_settings WHERE merchant_id=$1',
            [m],
          )
        ).rows[0];
        requireCondition(settings, 'NOT_FOUND', 404);
        return {
          settings,
          branches: (
            await db.query(
              'SELECT id,name,address,status,latitude,longitude,geofence_radius_m AS "radius" FROM branches WHERE merchant_id=$1 ORDER BY name',
              [m],
            )
          ).rows,
        };
      },
      actor,
    );
  });
  app.patch('/api/v1/platform/merchants/:m/stamp-collection-settings', async (req) => {
    const actor = authenticated(req);
    platform(actor);
    const { m } = z.object({ m: z.uuid() }).parse(req.params),
      p = collectionSettingsInput.parse(req.body),
      revision = expectedRevision(req);
    return transaction(
      pools.pool,
      async (db) => {
        // Location can only be required once every active branch has a position to compare with.
        if (p.requireLocation)
          requireCondition(
            !(
              await db.query(
                "SELECT 1 FROM branches WHERE merchant_id=$1 AND status='active' AND latitude IS NULL",
                [m],
              )
            ).rowCount,
            'BRANCH_POSITION_REQUIRED',
            422,
          );
        const settings = (
          await db.query(
            'UPDATE stamp_collection_settings SET require_location=$2,require_cashier=$3,max_accuracy_m=$4,collections_per_day=$5,stamps_per_day=$6,limit_window=$7,cooldown_minutes=$8,default_stamps=$9,allow_multiple=$10,max_stamps_per_collection=$11,welcome_stamps=$12,auto_branch_hourly_cap=$13,open_collection_acknowledged=$14,revision=revision+1,updated_at=clock_timestamp(),updated_by=$15 WHERE merchant_id=$1 AND revision=$16 RETURNING ' +
              columns,
            [
              m,
              p.requireLocation,
              p.requireCashier,
              p.maxAccuracy,
              p.collectionsPerDay,
              p.stampsPerDay,
              p.limitWindow,
              p.cooldownMinutes,
              p.defaultStamps,
              p.allowMultiple,
              p.maxStampsPerCollection,
              p.welcomeStamps,
              p.autoBranchHourlyCap,
              p.openCollectionAcknowledged,
              actor.id,
              revision,
            ],
          )
        ).rows[0];
        requireCondition(settings, 'REVISION_CONFLICT', 409);
        await audit(db, actor, 'collection.settings.update', m, m, p);
        return { settings };
      },
      actor,
    );
  });
  app.put('/api/v1/platform/merchants/:m/branches/:b/position', async (req) => {
    const actor = authenticated(req);
    platform(actor);
    const { m, b } = z.object({ m: z.uuid(), b: z.uuid() }).parse(req.params),
      p = branchPositionInput.parse(req.body);
    return transaction(
      pools.pool,
      async (db) => {
        await db.query('SELECT set_branch_position($1,$2,$3,$4,$5)', [
          m,
          b,
          p.latitude,
          p.longitude,
          p.radius,
        ]);
        return { id: b, ...p };
      },
      actor,
    );
  });
  // The single customer entry point. The server alone decides between a stamp now,
  // a request for the cashier, a location prompt, or a clear reason for no stamp.
  app.post('/api/v1/me/stamp-collections', async (req) => {
    const actor = authenticated(req),
      p = stampCollectionInput.parse(req.body),
      key = idempotencyKey(req);
    const decided = await transaction(
      pools.pool,
      async (db) => {
        const context = (
          await db.query('SELECT collection_context($1,$2) AS value', [p.membershipId, p.branchId])
        ).rows[0].value as {
          merchantId: string;
          requireLocation: boolean;
          requireCashier: boolean;
          maxAccuracy: number;
          latitude: number | null;
          longitude: number | null;
          radius: number;
          eligibility: { eligible: boolean; reason?: string; nextAt?: string };
        };
        await db.query('SELECT customer_merchant_guard($1)', [context.merchantId]);
        const placement = (
          await db.query('SELECT resolve_placement($1) AS value', [p.placementCode])
        ).rows[0]?.value;
        requireCondition(placement && placement.status === 'active', 'PLACEMENT_UNAVAILABLE', 410);
        requireCondition(
          placement.branchId === p.branchId &&
            (
              await db.query('SELECT 1 FROM public_merchant_brands WHERE id=$1 AND slug=$2', [
                context.merchantId,
                placement.slug,
              ])
            ).rowCount,
          'REQUEST_CONTEXT_MISMATCH',
          422,
        );
        const record = (outcome: string, distance?: number, accuracy?: number) =>
          db.query(
            'INSERT INTO stamp_collection_checks(merchant_id,membership_id,user_id,branch_id,outcome,distance_m,accuracy_m) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [
              context.merchantId,
              p.membershipId,
              actor.id,
              p.branchId,
              outcome,
              distance ?? null,
              accuracy ?? null,
            ],
          );
        // A retried request returns the stamp it already earned instead of today's "already collected".
        const earlier = (
          await db.query(
            "SELECT result FROM operations WHERE actor_id=$1 AND scope='collection.auto' AND idempotency_key=$2 AND status='committed'",
            [actor.id, key],
          )
        ).rows[0]?.result as Record<string, unknown> | undefined;
        if (earlier?.eligible && earlier.membershipId === p.membershipId)
          return {
            outcome: 'awarded' as const,
            quantity: earlier.quantity as number,
            balanceAfter: earlier.balanceAfter as number,
            rewardEarned: (earlier.rewardGrants as unknown[]).length > 0,
            transactionId: earlier.transactionId as string,
          };
        if (!context.eligibility.eligible) {
          await record(context.eligibility.reason === 'cooldown' ? 'cooldown' : 'limit_reached');
          return {
            outcome: 'not_eligible' as const,
            reason: context.eligibility.reason,
            nextAt: context.eligibility.nextAt,
          };
        }
        let distance: number | undefined, accuracy: number | undefined;
        if (context.requireLocation) {
          if (!p.location) return { outcome: 'location_required' as const };
          accuracy = Math.round(p.location.accuracy);
          // A branch without a position cannot prove anything; the cashier can still stamp the card.
          if (context.latitude === null || context.longitude === null) {
            await record('location_inaccurate', undefined, accuracy);
            return { outcome: 'not_eligible' as const, reason: 'location_unavailable' };
          }
          distance = Math.round(
            distanceMeters(
              p.location.latitude,
              p.location.longitude,
              context.latitude,
              context.longitude,
            ),
          );
          if (accuracy > context.maxAccuracy) {
            await record('location_inaccurate', distance, accuracy);
            return { outcome: 'not_eligible' as const, reason: 'location_inaccurate' };
          }
          if (distance > context.radius) {
            await record('outside_zone', distance, accuracy);
            return { outcome: 'not_eligible' as const, reason: 'outside_zone' };
          }
        }
        if (context.requireCashier) {
          await record('pending', distance, accuracy);
          return { outcome: 'pending' as const };
        }
        const result = await operation(
          db,
          actor,
          {
            scope: 'collection.auto',
            key,
            payload: { membershipId: p.membershipId, branchId: p.branchId },
            merchantId: context.merchantId,
          },
          async (operationId) =>
            (
              await db.query('SELECT collect_stamp_automatically($1,$2,$3) AS value', [
                p.membershipId,
                p.branchId,
                operationId,
              ])
            ).rows[0].value as Record<string, unknown>,
        );
        if (!result.eligible) {
          await record(
            result.reason === 'busy'
              ? 'busy'
              : result.reason === 'cooldown'
                ? 'cooldown'
                : 'limit_reached',
            distance,
            accuracy,
          );
          return {
            outcome: 'not_eligible' as const,
            reason: result.reason as string,
            nextAt: result.nextAt as string | undefined,
          };
        }
        await record('awarded', distance, accuracy);
        return {
          outcome: 'awarded' as const,
          quantity: result.quantity as number,
          balanceAfter: result.balanceAfter as number,
          rewardEarned: (result.rewardGrants as unknown[]).length > 0,
          transactionId: result.transactionId as string,
        };
      },
      actor,
    );
    if (decided.outcome !== 'pending') return decided;
    const request = await createStampRequest(
      pools,
      c,
      actor,
      { membershipId: p.membershipId, branchId: p.branchId, placementCode: p.placementCode },
      key,
    );
    return { outcome: 'pending' as const, request };
  });
}
