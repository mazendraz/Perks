import { z } from 'zod';
import type { Config } from './config.js';
import { transaction, type Pools, type Actor } from './db.js';
export const portals = ['platform', 'merchant', 'cashier', 'customer'] as const;
export type Portal = (typeof portals)[number];
export function requestPortal(header: unknown): Portal | undefined {
  return header === undefined ? undefined : z.enum(portals).parse(header);
}
export function portalCookies(c: Config, portal?: Portal) {
  const suffix = portal ? '_' + portal : '';
  return {
    session: (c.COOKIE_SECURE === 'true' ? '__Host-nq_session' : 'nq_session') + suffix,
    csrf: (c.COOKIE_SECURE === 'true' ? '__Host-nq_csrf' : 'nq_csrf') + suffix,
  };
}
export async function portalAllowed(pools: Pools, actor: Actor, portal: Portal, legacy = false) {
  if (actor.authMethod === 'device' && portal !== 'customer') return false;
  if (portal === 'platform') return ['platform_admin', 'platform_support'].includes(actor.role);
  if (portal === 'customer') {
    if (actor.role !== 'customer') return false;
    return (
      !legacy ||
      transaction(
        pools.pool,
        async (db) =>
          !(
            await db.query(
              "SELECT 1 FROM staff_memberships WHERE user_id=$1 AND status='active' LIMIT 1",
              [actor.id],
            )
          ).rowCount,
        actor,
      )
    );
  }
  if (actor.role !== 'customer') return false;
  return transaction(
    pools.pool,
    async (db) =>
      !!(
        await db.query(
          "SELECT 1 FROM staff_memberships WHERE user_id=$1 AND status='active' AND (($2='cashier' AND (NOT $3::boolean OR role='cashier')) OR ($2='merchant' AND role IN ('owner','manager'))) LIMIT 1",
          [actor.id, portal, legacy],
        )
      ).rowCount,
    actor,
  );
}
