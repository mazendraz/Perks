import pg from 'pg';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Config } from './config.js';
import { authenticated } from './auth.js';
import { transaction, type Actor, type Pools } from './db.js';
import { merchantGrant } from './policy.js';
import { requireCondition } from './errors.js';

const activitySchema = z
  .object({
    kind: z.enum(['ledger', 'request', 'challenge']),
    id: z.uuid(),
    membershipId: z.uuid(),
    merchantId: z.uuid(),
    branchId: z.uuid(),
    userId: z.uuid(),
  })
  .strict();
type Activity = z.infer<typeof activitySchema>;

// One LISTEN connection per API process, never one pooled connection per phone.
// A notification is not authorization and cannot mutate business state.
export function liveEventsModule(app: FastifyInstance, pools: Pools, c: Config) {
  const subscribers = new Set<(event: Activity) => void>(),
    closers = new Set<() => void>();
  let listener: pg.Client | undefined,
    connecting: Promise<void> | undefined,
    closed = false;
  async function connect() {
    if (listener) return;
    connecting ??= (async () => {
      const client = new pg.Client({
        connectionString: c.DATABASE_URL,
        connectionTimeoutMillis: 5000,
        application_name: 'nuqta-live-hints',
      });
      const failed = () => {
        if (listener === client) {
          listener = undefined;
          for (const close of [...closers]) close();
        }
        void client.end().catch(() => {});
      };
      client.on('error', failed);
      client.on('end', () => {
        if (listener === client) failed();
      });
      client.on('notification', (message) => {
        if (
          message.channel !== 'nuqta_customer_activity' ||
          !message.payload ||
          message.payload.length > 1200
        )
          return;
        let value: unknown;
        try {
          value = JSON.parse(message.payload);
        } catch {
          return;
        }
        const parsed = activitySchema.safeParse(value);
        if (parsed.success) for (const receive of subscribers) receive(parsed.data);
      });
      try {
        await client.connect();
        await client.query('LISTEN nuqta_customer_activity');
        if (closed) {
          await client.end();
          return;
        }
        listener = client;
      } catch (error) {
        await client.end().catch(() => {});
        throw error;
      }
    })().finally(() => {
      connecting = undefined;
    });
    await connecting;
    requireCondition(listener && !closed, 'LIVE_UNAVAILABLE', 503);
  }
  async function sessionActive(actor: Actor) {
    return !!(
      await pools.authPool.query(
        "SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND u.global_role=$3 AND u.status='active' AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.credential_version=u.password_version AND (s.auth_method<>'device' OR customer_device_active(s.customer_device_id,s.user_id)) AND (s.auth_method<>'password' OR s.created_at+CASE WHEN password_session_portal(u.id)='platform' THEN interval '12 hours' WHEN password_session_portal(u.id) IN ('merchant','cashier') THEN interval '7 days' ELSE interval '30 days' END>clock_timestamp())",
        [actor.sessionId, actor.id, actor.role],
      )
    ).rowCount;
  }
  async function stream(
    req: FastifyRequest,
    reply: FastifyReply,
    branch?: { id: string; merchantId: string },
  ) {
    const actor = authenticated(req);
    requireCondition(closers.size < 200, 'LIVE_CAPACITY', 503);
    await connect();
    requireCondition(await sessionActive(actor), 'UNAUTHENTICATED', 401);
    reply.hijack();
    for (const [name, value] of Object.entries(reply.getHeaders()))
      if (value !== undefined) reply.raw.setHeader(name, value);
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      Connection: 'close',
    });
    let ended = false,
      busy = false,
      dirty = false;
    const close = () => {
      if (ended) return;
      ended = true;
      subscribers.delete(receive);
      closers.delete(close);
      clearInterval(heartbeat);
      reply.raw.end();
    };
    const send = (event: string, value: Record<string, string>) => {
      if (
        !ended &&
        !reply.raw.write('event: ' + event + '\ndata: ' + JSON.stringify(value) + '\n\n')
      )
        close();
    };
    const authorized = async (event?: Activity) => {
      if (!(await sessionActive(actor))) return false;
      return transaction(
        pools.pool,
        async (db) => {
          if (branch) await merchantGrant(db, actor, branch.merchantId, undefined, branch.id);
          if (!event) return true;
          if (event.kind === 'challenge')
            return !!(
              await db.query(
                'SELECT 1 FROM redemption_challenges WHERE id=$1 AND merchant_id=$2 AND membership_id=$3 AND branch_id=$4 AND ($5::uuid IS NULL OR holder_user_id=$5)',
                [
                  event.id,
                  event.merchantId,
                  event.membershipId,
                  event.branchId,
                  branch ? null : actor.id,
                ],
              )
            ).rowCount;
          if (event.kind === 'request')
            return !!(
              await db.query(
                'SELECT 1 FROM stamp_requests WHERE id=$1 AND merchant_id=$2 AND membership_id=$3 AND branch_id=$4 AND ($5::uuid IS NULL OR user_id=$5)',
                [
                  event.id,
                  event.merchantId,
                  event.membershipId,
                  event.branchId,
                  branch ? null : actor.id,
                ],
              )
            ).rowCount;
          return !!(
            await db.query(
              'SELECT 1 FROM ledger_entries e JOIN memberships m ON m.id=e.membership_id AND m.merchant_id=e.merchant_id JOIN loyalty_transactions t ON t.id=e.transaction_id AND t.merchant_id=e.merchant_id WHERE e.id=$1 AND e.merchant_id=$2 AND e.membership_id=$3 AND t.branch_id=$4 AND ($5::uuid IS NULL OR m.user_id=$5)',
              [
                event.id,
                event.merchantId,
                event.membershipId,
                event.branchId,
                branch ? null : actor.id,
              ],
            )
          ).rowCount;
        },
        actor,
      );
    };
    async function deliver(event: Activity) {
      if (ended) return;
      // Coalesce a burst for this same authorized recipient; never build an
      // unbounded promise queue while a slow connection or DB is busy.
      if (busy) {
        dirty = true;
        return;
      }
      busy = true;
      try {
        if (!(await authorized(event))) {
          close();
          return;
        }
        send('activity', {
          kind: event.kind,
          id: event.id,
          membershipId: event.membershipId,
          branchId: event.branchId,
        });
        if (dirty) {
          dirty = false;
          send('sync', {});
        }
      } catch {
        close();
      } finally {
        busy = false;
      }
    }
    function receive(event: Activity) {
      if (
        branch
          ? event.branchId !== branch.id || event.merchantId !== branch.merchantId
          : event.userId !== actor.id
      )
        return;
      void deliver(event);
    }
    const heartbeat = setInterval(() => {
      void authorized()
        .then((valid) => {
          if (!valid) close();
          else if (!ended && !reply.raw.write(': heartbeat\n\n')) close();
        })
        .catch(close);
    }, 25000);
    heartbeat.unref();
    closers.add(close);
    subscribers.add(receive);
    reply.raw.once('close', close);
    req.raw.once('aborted', close);
    // Reconnection always re-reads current authorized state, so disconnects do
    // not require retaining or replaying private event bodies.
    send('sync', {});
  }
  app.get('/api/v1/me/events', async (req, reply) => stream(req, reply));
  app.get('/api/v1/branches/:b/events', async (req, reply) => {
    const actor = authenticated(req),
      { b } = z.object({ b: z.uuid() }).parse(req.params);
    const branch = await transaction(
      pools.pool,
      async (db) => {
        const row = (await db.query('SELECT merchant_id FROM branches WHERE id=$1', [b])).rows[0];
        requireCondition(row, 'NOT_FOUND', 404);
        await merchantGrant(db, actor, row.merchant_id, undefined, b);
        return { id: b, merchantId: row.merchant_id as string };
      },
      actor,
    );
    return stream(req, reply, branch);
  });
  app.addHook('preClose', async () => {
    closed = true;
    for (const close of [...closers]) close();
    await connecting?.catch(() => {});
    const client = listener;
    listener = undefined;
    await client?.end();
  });
}
