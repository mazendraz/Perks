import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import { authenticated } from '../auth.js';
import { audit, transaction, type Pools, type Actor } from '../db.js';
import { platform, merchantGrant } from '../policy.js';
import { requireCondition } from '../errors.js';
import { operation, idempotencyKey, expectedRevision } from '../operations.js';
function support(actor: Actor) {
  requireCondition(['platform_admin', 'platform_support'].includes(actor.role), 'FORBIDDEN', 403);
}
export function platformModule(app: FastifyInstance, pools: Pools, c: Config) {
  app.get('/api/v1/platform/merchants/:m/workspace', async (req) => {
    const actor = authenticated(req);
    platform(actor, false);
    const { m } = z.object({ m: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        const merchant = (
          await db.query(
            'SELECT m.*,e.plan,e.max_staff,e.max_branches,e.max_customers FROM merchants m JOIN feature_entitlements e ON e.merchant_id=m.id WHERE m.id=$1',
            [m],
          )
        ).rows[0];
        requireCondition(merchant, 'NOT_FOUND', 404);
        const summary = (
          await db.query(
            `SELECT
        (SELECT count(*)::int FROM tenant_customer_profiles WHERE merchant_id=$1) AS customers,
        (SELECT count(*)::int FROM loyalty_transactions WHERE merchant_id=$1) AS transactions,
        (SELECT coalesce(sum(quantity),0)::int FROM loyalty_transactions WHERE merchant_id=$1 AND type='award') AS stamps,
        (SELECT count(*)::int FROM reward_grants WHERE merchant_id=$1 AND status='available' AND expires_at>now()) AS open_rewards,
        (SELECT count(*)::int FROM reward_grants WHERE merchant_id=$1 AND status='redeemed') AS redeemed_rewards,
        (SELECT count(*)::int FROM loyalty_accounts a WHERE merchant_id=$1 AND balance<>(SELECT coalesce(sum(amount),0) FROM ledger_entries e WHERE e.membership_id=a.membership_id)) AS balance_drift,
        (SELECT count(*)::int FROM support_tickets WHERE merchant_id=$1 AND status<>'resolved') AS open_tickets,
        (SELECT count(*)::int FROM background_jobs WHERE merchant_id=$1 AND status IN ('failed','unknown','blocked')) AS attention_jobs`,
            [m],
          )
        ).rows[0];
        return {
          merchant,
          summary,
          programs: (
            await db.query(
              "SELECT p.id,p.name,p.status,v.threshold,v.reward_title,v.reward_terms,v.max_per_tx,v.validity_days,v.ends_at,v.version,coalesce((SELECT jsonb_agg(branch_id) FROM program_branches WHERE program_version_id=v.id),'[]') AS branch_ids FROM programs p JOIN program_versions v ON v.id=p.current_version_id WHERE p.merchant_id=$1 ORDER BY p.created_at",
              [m],
            )
          ).rows,
          readiness: (
            await db.query(
              "SELECT (SELECT count(*)::int FROM placements WHERE merchant_id=$1 AND status<>'revoked') AS codes,(merchant_contact_readiness($1)->>'missing_phones')::int AS missing_phones,(SELECT count(*)::int FROM tenant_customer_profiles cp WHERE cp.merchant_id=$1 AND NOT EXISTS(SELECT 1 FROM memberships ms JOIN loyalty_transactions t ON t.membership_id=ms.id WHERE ms.profile_id=cp.id AND t.type='award')) AS never_purchased,(SELECT count(*)::int FROM tenant_customer_profiles cp WHERE cp.merchant_id=$1 AND NOT EXISTS(SELECT 1 FROM consent_current cc WHERE cc.merchant_id=cp.merchant_id AND cc.user_id=cp.user_id AND cc.channel='whatsapp' AND cc.granted)) AS without_whatsapp_consent,(merchant_contact_readiness($1)->>'whatsapp_ready')::int AS whatsapp_ready",
              [m],
            )
          ).rows[0],
          branches: (
            await db.query(
              'SELECT id,name,address,status FROM branches WHERE merchant_id=$1 ORDER BY name',
              [m],
            )
          ).rows,
          staff: (
            await db.query(
              `SELECT s.id,s.email,s.name,s.role,s.status,s.max_qty,coalesce((SELECT jsonb_agg(b.name) FROM staff_branch_grants g JOIN branches b ON b.id=g.branch_id WHERE g.staff_id=s.id),'[]') AS branches FROM staff_memberships s WHERE merchant_id=$1 ORDER BY role,name`,
              [m],
            )
          ).rows,
          invitations: (
            await db.query(
              "SELECT id,email,role,status,branch_ids,max_qty FROM invitations WHERE merchant_id=$1 AND status='pending' ORDER BY created_at",
              [m],
            )
          ).rows,
          transactions: (
            await db.query(
              'SELECT t.public_reference,t.type,t.quantity,t.at,b.name AS branch_name FROM loyalty_transactions t JOIN branches b ON b.id=t.branch_id WHERE t.merchant_id=$1 ORDER BY t.at DESC LIMIT 30',
              [m],
            )
          ).rows,
          jobs: (
            await db.query(
              'SELECT id,kind,status,attempts,last_error,created_at FROM background_jobs WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 50',
              [m],
            )
          ).rows,
          events: (
            await db.query(
              'SELECT a.id,a.action,a.target_id,a.at,u.display_name AS actor_name,u.email AS actor_email FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.merchant_id=$1 ORDER BY a.at DESC LIMIT 50',
              [m],
            )
          ).rows,
          checkedAt: new Date(),
        };
      },
      actor,
    );
  });
  app.get('/api/v1/platform/health', async (req) => {
    const actor = authenticated(req);
    support(actor);
    return transaction(
      pools.pool,
      async (db) => (await db.query('SELECT platform_health() AS value')).rows[0].value,
      actor,
    );
  });
  app.get('/api/v1/platform/jobs', async (req) => {
    const actor = authenticated(req);
    support(actor);
    return transaction(
      pools.pool,
      async (db) => ({
        jobs: (await db.query('SELECT platform_jobs() AS job')).rows.map((r) => r.job),
      }),
      actor,
    );
  });
  app.get('/api/v1/platform/integrations', async (req) => {
    support(authenticated(req));
    return {
      providers: [
        {
          id: 'auth',
          status: c.AUTH_PROVIDER === 'local' ? 'local_only' : 'requires_environment_verification',
        },
        { id: 'object_storage', status: 'local_only' },
        { id: 'apple_wallet', status: 'not_configured' },
        { id: 'google_wallet', status: 'not_configured' },
        { id: 'email', status: c.AUTH_PROVIDER === 'local' ? 'local_sink_only' : 'not_configured' },
        { id: 'whatsapp', status: 'not_configured' },
        { id: 'sms', status: 'not_configured' },
        { id: 'web_push', status: 'not_configured' },
        { id: 'payments', status: 'not_configured' },
      ],
      checkedAt: new Date(),
    };
  });
  app.get('/api/v1/platform/placements', async (req) => {
    const actor = authenticated(req);
    platform(actor, false);
    return transaction(
      pools.pool,
      async (db) => ({
        placements: (
          await db.query(
            'SELECT p.id,p.merchant_id,p.label,p.status,p.revision,b.name AS branch_name,m.name AS merchant_name FROM placements p JOIN merchants m ON m.id=p.merchant_id JOIN branches b ON b.id=p.branch_id ORDER BY p.created_at DESC LIMIT 100',
          )
        ).rows,
      }),
      actor,
    );
  });
  app.get('/api/v1/platform/audit', async (req) => {
    const actor = authenticated(req);
    platform(actor, false);
    const q = z
      .object({ merchantId: z.uuid().optional(), before: z.iso.datetime().optional() })
      .parse(req.query);
    return transaction(
      pools.pool,
      async (db) => ({
        events: (
          await db.query(
            'SELECT a.id,a.actor_id,a.merchant_id,a.action,a.target_id,a.detail,a.at,u.display_name AS actor_name,u.email AS actor_email FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE ($1::uuid IS NULL OR a.merchant_id=$1) AND ($2::timestamptz IS NULL OR a.at<$2) ORDER BY a.at DESC LIMIT 100',
            [q.merchantId || null, q.before || null],
          )
        ).rows,
      }),
      actor,
    );
  });
  app.post('/api/v1/platform/jobs/:id/retry', async (req) => {
    const actor = authenticated(req);
    platform(actor);
    const { id } = z.object({ id: z.uuid() }).parse(req.params),
      p = z
        .object({ reason: z.string().trim().min(4).max(500) })
        .strict()
        .parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        const job = (await db.query('SELECT * FROM background_jobs WHERE id=$1 FOR UPDATE', [id]))
          .rows[0];
        requireCondition(job, 'NOT_FOUND', 404);
        return operation(
          db,
          actor,
          { scope: 'job.retry:' + id, key, payload: p, merchantId: job.merchant_id },
          async () => {
            requireCondition(job.status === 'failed' && job.attempts < 5, 'JOB_NOT_RETRYABLE', 409);
            requireCondition(
              ['domain_event', 'customer_export', 'invitation_email'].includes(job.kind),
              'PROVIDER_RECONCILIATION_REQUIRED',
              409,
            );
            await db.query(
              "UPDATE background_jobs SET status='pending',next_run_at=clock_timestamp(),last_error=NULL,lease_id=NULL,lease_until=NULL WHERE id=$1",
              [id],
            );
            await audit(db, actor, 'job.retry', job.merchant_id, id, {
              reason: p.reason,
              previousAttempts: job.attempts,
            });
            return { id, status: 'pending' };
          },
        );
      },
      actor,
    );
  });
  app.get('/api/v1/support/tickets', async (req) => {
    const actor = authenticated(req),
      q = z.object({ merchantId: z.uuid().optional() }).parse(req.query);
    return transaction(
      pools.pool,
      async (db) => {
        if (q.merchantId && !['platform_admin', 'platform_support'].includes(actor.role))
          await merchantGrant(db, actor, q.merchantId, ['owner']);
        else support(actor);
        return {
          tickets: (
            await db.query(
              'SELECT t.*,m.name AS merchant_name FROM support_tickets t LEFT JOIN merchants m ON m.id=t.merchant_id WHERE ($1::uuid IS NULL OR t.merchant_id=$1) ORDER BY t.updated_at DESC LIMIT 100',
              [q.merchantId || null],
            )
          ).rows,
        };
      },
      actor,
    );
  });
  app.post('/api/v1/support/tickets', async (req) => {
    const actor = authenticated(req),
      p = z
        .object({
          merchantId: z.uuid(),
          subject: z.string().trim().min(4).max(160),
          category: z.enum(['loyalty', 'access', 'materials', 'billing', 'other']),
          message: z.string().trim().min(4).max(4000),
        })
        .strict()
        .parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        if (actor.role === 'platform_admin') platform(actor);
        else await merchantGrant(db, actor, p.merchantId, ['owner']);
        return operation(
          db,
          actor,
          { scope: 'support.create', key, payload: p, merchantId: p.merchantId },
          async () => {
            const t = (
              await db.query(
                'INSERT INTO support_tickets(merchant_id,created_by,subject,category) VALUES($1,$2,$3,$4) RETURNING *',
                [p.merchantId, actor.id, p.subject, p.category],
              )
            ).rows[0];
            await db.query(
              'INSERT INTO support_messages(merchant_id,ticket_id,author_id,body) VALUES($1,$2,$3,$4)',
              [p.merchantId, t.id, actor.id, p.message],
            );
            await audit(db, actor, 'support.create', p.merchantId, t.id);
            return { ticket: t };
          },
        );
      },
      actor,
    );
  });
  app.get('/api/v1/support/tickets/:id', async (req) => {
    const actor = authenticated(req),
      { id } = z.object({ id: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        const ticket = (await db.query('SELECT * FROM support_tickets WHERE id=$1', [id])).rows[0];
        requireCondition(ticket, 'NOT_FOUND', 404);
        return {
          ticket,
          messages: (
            await db.query(
              'SELECT id,author_id,body,at FROM support_messages WHERE ticket_id=$1 ORDER BY at',
              [id],
            )
          ).rows,
        };
      },
      actor,
    );
  });
  app.post('/api/v1/support/tickets/:id/messages', async (req) => {
    const actor = authenticated(req),
      { id } = z.object({ id: z.uuid() }).parse(req.params),
      p = z
        .object({ body: z.string().trim().min(1).max(4000) })
        .strict()
        .parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        const t = (await db.query('SELECT * FROM support_tickets WHERE id=$1 FOR UPDATE', [id]))
          .rows[0];
        requireCondition(t, 'NOT_FOUND', 404);
        return operation(
          db,
          actor,
          { scope: 'support.message:' + id, key, payload: p, merchantId: t.merchant_id },
          async () => {
            const message = (
              await db.query(
                'INSERT INTO support_messages(merchant_id,ticket_id,author_id,body) VALUES($1,$2,$3,$4) RETURNING id,body,at',
                [t.merchant_id, id, actor.id, p.body],
              )
            ).rows[0];
            await db.query(
              'UPDATE support_tickets SET updated_at=clock_timestamp(),revision=revision+1 WHERE id=$1',
              [id],
            );
            await audit(db, actor, 'support.reply', t.merchant_id, id, { messageId: message.id });
            return { message };
          },
        );
      },
      actor,
    );
  });
  app.patch('/api/v1/support/tickets/:id', async (req) => {
    const actor = authenticated(req),
      { id } = z.object({ id: z.uuid() }).parse(req.params),
      p = z
        .object({ status: z.enum(['open', 'waiting', 'resolved']) })
        .strict()
        .parse(req.body),
      revision = expectedRevision(req);
    return transaction(
      pools.pool,
      async (db) => {
        const t = (
          await db.query(
            'UPDATE support_tickets SET status=$1,revision=revision+1,updated_at=clock_timestamp() WHERE id=$2 AND revision=$3 RETURNING *',
            [p.status, id, revision],
          )
        ).rows[0];
        requireCondition(t, 'REVISION_CONFLICT', 409);
        await audit(db, actor, 'support.status', t.merchant_id, id, p);
        return { ticket: t };
      },
      actor,
    );
  });
}
