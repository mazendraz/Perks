import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticated } from '../auth.js';
import { audit, transaction, type DB, type Pools } from '../db.js';
import { platform } from '../policy.js';
import { requireCondition } from '../errors.js';

async function ownerContext(db: DB, merchantId: string, staffId?: string) {
  const row = (
    await db.query(
      `SELECT s.id,s.user_id,u.email,s.name AS owner_name,s.merchant_id,s.role,s.max_qty,
      m.name,m.slug,m.status,m.timezone,m.primary_color,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) ORDER BY b.name)
        FROM staff_branch_grants g JOIN branches b ON b.id=g.branch_id AND b.merchant_id=g.merchant_id
        WHERE g.staff_id=s.id AND b.status='active'),'[]') AS branches
     FROM staff_memberships s JOIN users u ON u.id=s.user_id JOIN merchants m ON m.id=s.merchant_id
     WHERE s.merchant_id=$1 AND s.role='owner' AND s.status='active' AND u.status='active'
       AND u.global_role='customer' AND ($2::uuid IS NULL OR s.id=$2) ORDER BY s.id LIMIT 1`,
      [merchantId, staffId || null],
    )
  ).rows[0];
  requireCondition(row, 'PREVIEW_OWNER_UNAVAILABLE', 409);
  const { user_id, email, owner_name, ...grant } = row;
  return {
    owner: { id: user_id as string, email: email as string, name: owner_name as string },
    grant,
  };
}

export function ownerPreviewModule(app: FastifyInstance, pools: Pools) {
  // This header never creates an owner session. Every request reauthorizes the
  // current platform session, selected membership and narrowly allowed read path.
  app.addHook('onRequest', async (req) => {
    const raw = req.headers['x-nuqta-owner-preview'];
    if (raw === undefined) return;
    const admin = authenticated(req);
    platform(admin);
    requireCondition(req.method === 'GET', 'OWNER_PREVIEW_READ_ONLY', 403);
    const [merchantId, staffId] = z.tuple([z.uuid(), z.uuid()]).parse(String(raw).split(':'));
    const url = new URL(req.url, 'http://local');
    const base = '/api/v1/merchants/' + merchantId;
    const relative = url.pathname.startsWith(base + '/') ? url.pathname.slice(base.length + 1) : '';
    const allowed =
      url.pathname === base ||
      /^(?:overview|experience|programs|staff|transactions|corrections|branches|account-security|customers|customer-outreach|customer-exports|segments|placements)$/.test(
        relative,
      ) ||
      /^customers\/[a-f0-9-]{36}$/.test(relative) ||
      /^assets\/[a-f0-9-]{36}$/.test(relative) ||
      /^placements\/[a-f0-9-]{36}\/qr$/.test(relative);
    const context = await transaction(
      pools.pool,
      async (db) => {
        if (!allowed) {
          const ticketId = /^\/api\/v1\/support\/tickets\/([a-f0-9-]{36})$/.exec(url.pathname)?.[1];
          if (url.pathname === '/api/v1/support/tickets')
            requireCondition(
              url.searchParams.get('merchantId') === merchantId,
              'OWNER_PREVIEW_SCOPE',
              403,
            );
          else if (ticketId)
            requireCondition(
              (
                await db.query('SELECT 1 FROM support_tickets WHERE id=$1 AND merchant_id=$2', [
                  ticketId,
                  merchantId,
                ])
              ).rowCount,
              'NOT_FOUND',
              404,
            );
          else requireCondition(false, 'OWNER_PREVIEW_SCOPE', 403);
        }
        return ownerContext(db, merchantId, staffId);
      },
      admin,
    );
    req.actor = {
      ...admin,
      id: context.owner.id,
      email: context.owner.email,
      role: 'customer',
      mfaAt: null,
      preview: { adminId: admin.id, merchantId, staffId },
    };
  });
  app.get('/api/v1/platform/merchants/:m/owner-preview', async (req) => {
    const admin = authenticated(req);
    platform(admin);
    const { m } = z.object({ m: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        const context = await ownerContext(db, m);
        await audit(db, admin, 'merchant.owner_preview', m, context.grant.id, { readOnly: true });
        return { ...context, readOnly: true };
      },
      admin,
    );
  });
}
