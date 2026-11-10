import { contactPhone } from '../../../../packages/contracts/src/account-management.js';
import { enrollmentPlacementLabel } from '../../../../packages/domain/src/placement-labels.js';
import { publishDraftLogo } from './onboarding.js';
import { hashPassword } from '../passwords.js';
import {
  cardTemplate,
  stampDesign,
  logoStyles,
} from '../../../../packages/contracts/src/branding.js';
import { draftInput, draftActivationInput } from '../../../../packages/contracts/src/commands.js';
import type { FastifyInstance } from 'fastify';
import { randomUUID, randomBytes } from 'node:crypto';
import { createFileStore } from '../storage/file-store.js';
import { sanitizeLogo } from '../storage/logo.js';
import { z } from 'zod';
import {
  provisioningInput,
  planLimits,
  programInput,
  color,
} from '../../../../packages/contracts/src/provisioning.js';
import { authenticated } from '../auth.js';
import { audit, transaction, type Pools, type DB, type Actor } from '../db.js';
import { deployed, type Config } from '../config.js';
import { requireCondition } from '../errors.js';
import { merchantGrant, platform } from '../policy.js';
import { expectedRevision, idempotencyKey, operation } from '../operations.js';
import { emitOutbox, seal } from '../outbox.js';
import { opaqueToken, tokenHash, keyedHash } from '../crypto.js';
const uuidParams = z.object({ m: z.uuid() });
async function invitation(
  db: DB,
  actor: Actor,
  c: Config,
  merchantId: string,
  p: { email: string; role: string; maxQty: number; branchIds: string[] },
) {
  const token = opaqueToken();
  const inv = (
    await db.query(
      "INSERT INTO invitations(merchant_id,email,role,max_qty,branch_ids,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '7 days') RETURNING id,email,role,status,expires_at",
      [merchantId, p.email, p.role, p.maxQty, p.branchIds, tokenHash(token)],
    )
  ).rows[0];
  await emitOutbox(db, {
    merchantId,
    eventType: 'staff.invited',
    aggregateId: inv.id,
    payload: {
      email: p.email,
      encryptedToken: seal(token, c.AUTH_PEPPER),
      locale: actor.locale || 'ar',
    },
    dedupeKey: 'invite:' + inv.id + ':1',
    kind: 'invitation_email',
  });
  await audit(db, actor, 'staff.invite', merchantId, inv.id, {
    role: p.role,
    branchIds: p.branchIds,
  });
  return inv;
}
async function createAccount(
  db: DB,
  actor: Actor,
  mid: string,
  p: { email: string; role: string; maxQty: number; branchIds: string[] },
  hash: string,
) {
  // Replace only this business's pending invitation after the operator explicitly
  // chooses direct account creation. A conflict rolls the entire transaction back.
  const revoked = await db.query(
    "UPDATE invitations SET status='revoked' WHERE merchant_id=$1 AND email=$2 AND status='pending' RETURNING id",
    [mid, p.email],
  );
  const account = (
    await db.query('SELECT create_staff_password_account($1,$2,$3,$4,$5,$6) AS account', [
      mid,
      p.email,
      hash,
      p.role,
      p.maxQty,
      p.branchIds,
    ])
  ).rows[0].account;
  for (const invite of revoked.rows)
    await audit(db, actor, 'invitation.revoke', mid, invite.id, {
      reason: 'Replaced by an explicitly created password account',
    });
  return account;
}
export function provisioningModule(app: FastifyInstance, pools: Pools, c: Config) {
  const files = createFileStore(c);
  app.post(
    '/api/v1/platform/merchants/:m/accounts',
    { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } },
    async (req) => {
      const actor = authenticated(req);
      platform(actor);
      const { m } = uuidParams.parse(req.params),
        body = z
          .object({
            email: z.email().transform((e) => e.toLowerCase()),
            password: z.string().min(10).max(128),
            role: z.enum(['owner', 'manager', 'cashier']),
            branchIds: z.array(z.uuid()).min(1).max(10),
            maxQty: z.number().int().min(1).max(100),
          })
          .strict()
          .parse(req.body),
        key = idempotencyKey(req);
      const hash = await hashPassword(body.password, c.AUTH_PEPPER);
      return transaction(
        pools.pool,
        (db) =>
          operation(
            db,
            actor,
            {
              scope: 'platform.account:' + m,
              key,
              payload: { ...body, password: keyedHash(body.password, c.AUTH_PEPPER) },
              merchantId: m,
            },
            async () => ({ account: await createAccount(db, actor, m, body, hash) }),
          ),
        actor,
      );
    },
  );
  app.get('/api/v1/platform/merchants', async (req) => {
    const actor = authenticated(req);
    platform(actor, false);
    return transaction(
      pools.pool,
      async (db) => ({
        merchants: (
          await db.query(
            'SELECT m.*,e.plan,e.max_branches,e.max_staff,(SELECT count(*)::int FROM branches b WHERE b.merchant_id=m.id) AS branch_count,(SELECT count(*)::int FROM staff_memberships s WHERE s.merchant_id=m.id) AS staff_count FROM merchants m LEFT JOIN feature_entitlements e ON e.merchant_id=m.id ORDER BY m.created_at DESC LIMIT 100',
          )
        ).rows,
      }),
      actor,
    );
  });
  app.get('/api/v1/platform/provisioning-drafts', async (req) => {
    const actor = authenticated(req);
    platform(actor);
    return transaction(
      pools.pool,
      async (db) => ({
        drafts: (
          await db.query(
            'SELECT * FROM provisioning_drafts WHERE created_by=$1 ORDER BY updated_at DESC LIMIT 100',
            [actor.id],
          )
        ).rows,
      }),
      actor,
    );
  });
  app.post('/api/v1/platform/provisioning-drafts', async (req) => {
    const actor = authenticated(req);
    platform(actor);
    const body = draftInput.parse(req.body);
    const key = idempotencyKey(req);
    return transaction(
      pools.pool,
      (db) =>
        operation(db, actor, { scope: 'draft.create', key, payload: body }, async () => ({
          draft: (
            await db.query(
              'INSERT INTO provisioning_drafts(created_by,data) VALUES($1,$2) RETURNING *',
              [actor.id, body.data],
            )
          ).rows[0],
        })),
      actor,
    );
  });
  app.patch('/api/v1/platform/provisioning-drafts/:id', async (req) => {
    const actor = authenticated(req);
    platform(actor);
    const { id } = z.object({ id: z.uuid() }).parse(req.params),
      body = draftInput.parse(req.body),
      rev = expectedRevision(req);
    return transaction(
      pools.pool,
      async (db) => {
        const row = (
          await db.query(
            "UPDATE provisioning_drafts SET data=$1,revision=revision+1,updated_at=now() WHERE id=$2 AND revision=$3 AND status='draft' AND created_by=$4 RETURNING *",
            [body.data, id, rev, actor.id],
          )
        ).rows[0];
        requireCondition(row, 'REVISION_CONFLICT', 409);
        return { draft: row };
      },
      actor,
    );
  });
  app.post('/api/v1/platform/provisioning-drafts/:id/activate', async (req) => {
    const actor = authenticated(req);
    platform(actor);
    const { id } = z.object({ id: z.uuid() }).parse(req.params),
      body = draftActivationInput.parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        const draft = (
          await db.query('SELECT * FROM provisioning_drafts WHERE id=$1 FOR UPDATE', [id])
        ).rows[0];
        requireCondition(draft && draft.created_by === actor.id, 'NOT_FOUND', 404);
        const old = (
          await db.query(
            'SELECT result FROM provisioning_activations WHERE draft_id=$1 AND draft_revision=$2',
            [id, body.draftRevision],
          )
        ).rows[0];
        if (old) return old.result;
        requireCondition(
          draft.status === 'draft' && draft.revision === body.draftRevision,
          'REVISION_CONFLICT',
          409,
        );
        const d = provisioningInput.parse(draft.data),
          limits = planLimits[d.plan];
        requireCondition(
          d.branches.length <= limits.branches && d.staff.length <= limits.staff,
          'PLAN_LIMIT',
          409,
        );
        return operation(
          db,
          actor,
          { scope: 'draft.activate:' + id, key, payload: body },
          async (operationId) => {
            const m = (
              await db.query(
                'INSERT INTO merchants(slug,name,timezone,primary_color,accent_color,surface_color,template,terms,contact_email,stamp_shape,stamp_icon,stamp_style,contact_phone,logo_style,logo_size) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *',
                [
                  d.slug,
                  d.name,
                  d.timezone,
                  d.primaryColor,
                  d.accentColor,
                  d.surfaceColor,
                  d.template,
                  d.terms,
                  d.contactEmail,
                  d.stampShape,
                  d.stampIcon,
                  d.stampStyle,
                  d.contactPhone,
                  d.logoStyle,
                  d.logoSize,
                ],
              )
            ).rows[0];
            await db.query(
              'INSERT INTO feature_entitlements(merchant_id,plan,max_branches,max_staff,max_programs,max_customers,billing_required) VALUES($1,$2,$3,$4,$5,$6,$7)',
              [
                m.id,
                d.plan,
                limits.branches,
                limits.staff,
                limits.programs,
                limits.customers,
                deployed(c),
              ],
            );
            const branches: { id: string; name: string }[] = [];
            for (const b of d.branches)
              branches.push(
                (
                  await db.query(
                    'INSERT INTO branches(merchant_id,name,address) VALUES($1,$2,$3) RETURNING id,name',
                    [m.id, b.name, b.address],
                  )
                ).rows[0],
              );
            const p = (
              await db.query('INSERT INTO programs(merchant_id,name) VALUES($1,$2) RETURNING id', [
                m.id,
                d.program.name,
              ])
            ).rows[0];
            const v = (
              await db.query(
                'INSERT INTO program_versions(merchant_id,program_id,version,threshold,max_per_tx,reward_title,reward_terms,validity_days,ends_at) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8) RETURNING id',
                [
                  m.id,
                  p.id,
                  d.program.threshold,
                  d.program.maxPerTx,
                  d.program.rewardTitle,
                  d.program.rewardTerms,
                  d.program.validityDays,
                  d.program.endsAt,
                ],
              )
            ).rows[0];
            for (const b of branches)
              await db.query(
                'INSERT INTO program_branches(merchant_id,program_version_id,branch_id) VALUES($1,$2,$3)',
                [m.id, v.id, b.id],
              );
            await db.query('UPDATE programs SET current_version_id=$1 WHERE id=$2', [v.id, p.id]);
            if (d.logoAssetId) {
              await publishDraftLogo(db, actor, id, m.id, d.logoAssetId, files);
              m.logo_asset_id = d.logoAssetId;
            }
            const invites = [],
              accounts = [];
            for (const s of d.staff) {
              const branchIds = s.branchIndexes.map((i) => branches[i]!.id);
              if (s.accessMode === 'password') {
                const credential = (
                  await db.query(
                    'SELECT password_hash FROM provisioning_credentials WHERE draft_id=$1 AND email=$2 AND created_by=$3',
                    [id, s.email, actor.id],
                  )
                ).rows[0];
                requireCondition(credential, 'STAFF_PASSWORD_REQUIRED', 422);
                accounts.push(
                  (
                    await db.query(
                      'SELECT create_staff_password_account($1,$2,$3,$4,$5,$6) AS account',
                      [m.id, s.email, credential.password_hash, s.role, s.maxQty, branchIds],
                    )
                  ).rows[0].account,
                );
              } else invites.push(await invitation(db, actor, c, m.id, { ...s, branchIds }));
            }
            const placements = [];
            for (const b of branches) {
              const p = (
                await db.query(
                  "INSERT INTO placements(merchant_id,branch_id,label,kind,public_code,created_by) VALUES($1,$2,$3,'stand',$4,$5) RETURNING id,branch_id,label",
                  [
                    m.id,
                    b.id,
                    enrollmentPlacementLabel(
                      b.name,
                      req.headers['x-nuqta-language'] === 'ar' ? 'ar' : 'en',
                    ),
                    randomBytes(24).toString('base64url'),
                    actor.id,
                  ],
                )
              ).rows[0];
              await db.query(
                "INSERT INTO placement_events(merchant_id,placement_id,actor_id,action,reason) VALUES($1,$2,$3,'requested','Enrollment QR generated at activation')",
                [m.id, p.id, actor.id],
              );
              placements.push(p);
            }
            const activationId = randomUUID(),
              result = {
                activationId,
                merchant: m,
                branches,
                programId: p.id,
                versionId: v.id,
                invitations: invites,
                accounts,
                placements,
                operationId,
                capabilities: {
                  webCard: 'ready',
                  appleWallet: 'not_configured',
                  googleWallet: 'not_configured',
                  paidMessaging: 'not_configured',
                },
              };
            await db.query(
              'INSERT INTO provisioning_activations(id,draft_id,draft_revision,merchant_id,result) VALUES($1,$2,$3,$4,$5)',
              [activationId, id, body.draftRevision, m.id, result],
            );
            for (const [step, status, resources] of [
              ['merchant', 'done', [m.id]],
              ['branches', 'done', branches.map((b) => b.id)],
              ['program', 'done', [p.id]],
              ['invitations', invites.length ? 'pending' : 'done', invites.map((i) => i.id)],
              ['apple_wallet', 'blocked', []],
              ['google_wallet', 'blocked', []],
            ] as const)
              await db.query(
                'INSERT INTO provisioning_steps(activation_id,step_key,status,resource_ids) VALUES($1,$2,$3,$4)',
                [activationId, step, status, JSON.stringify(resources)],
              );
            await db.query(
              "UPDATE provisioning_drafts SET status='activated',updated_at=now() WHERE id=$1",
              [id],
            );
            await db.query('DELETE FROM provisioning_credentials WHERE draft_id=$1', [id]);
            await audit(db, actor, 'merchant.activate', m.id, m.id, { activationId, draftId: id });
            return result;
          },
        );
      },
      actor,
    );
  });
  app.get('/api/v1/platform/activations/:id', async (req) => {
    const actor = authenticated(req);
    platform(actor);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        const a = (await db.query('SELECT * FROM provisioning_activations WHERE id=$1', [id]))
          .rows[0];
        requireCondition(a, 'NOT_FOUND', 404);
        return {
          activation: a,
          steps: (
            await db.query(
              'SELECT * FROM provisioning_steps WHERE activation_id=$1 ORDER BY step_key',
              [id],
            )
          ).rows,
        };
      },
      actor,
    );
  });
  app.post('/api/v1/invitations/:token/accept', async (req) => {
    const actor = authenticated(req),
      { token } = z.object({ token: z.string().min(40).max(100) }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) =>
        (await db.query('SELECT accept_invitation($1) AS result', [tokenHash(token)])).rows[0]
          .result,
      actor,
    );
  });
  app.get('/api/v1/merchants/:m', async (req) => {
    const actor = authenticated(req),
      { m } = uuidParams.parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        if (actor.role === 'platform_admin') platform(actor, false);
        else await merchantGrant(db, actor, m, ['owner', 'manager']);
        const merchant = (await db.query('SELECT * FROM merchants WHERE id=$1', [m])).rows[0];
        requireCondition(merchant, 'NOT_FOUND', 404);
        return {
          merchant,
          branches: (
            await db.query('SELECT * FROM branches WHERE merchant_id=$1 ORDER BY name', [m])
          ).rows,
          entitlements: (
            await db.query('SELECT * FROM feature_entitlements WHERE merchant_id=$1', [m])
          ).rows[0],
        };
      },
      actor,
    );
  });
  app.get('/api/v1/merchants/:m/staff', async (req) => {
    const actor = authenticated(req),
      { m } = uuidParams.parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner']);
        return {
          staff: (
            await db.query(
              "SELECT s.*,coalesce((SELECT jsonb_agg(g.branch_id) FROM staff_branch_grants g WHERE g.staff_id=s.id),'[]') AS branch_ids FROM staff_memberships s WHERE s.merchant_id=$1 ORDER BY s.name",
              [m],
            )
          ).rows,
          invitations: (
            await db.query(
              'SELECT id,email,role,status,expires_at,revision,branch_ids FROM invitations WHERE merchant_id=$1 ORDER BY created_at DESC',
              [m],
            )
          ).rows,
        };
      },
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/invitations', async (req) => {
    const actor = authenticated(req),
      { m } = uuidParams.parse(req.params),
      body = z
        .object({
          email: z.email().transform((e) => e.toLowerCase()),
          role: z.enum(['owner', 'manager', 'cashier']),
          password: z.string().min(10).max(128).optional(),
          branchIds: z.array(z.uuid()).min(1).max(10),
          maxQty: z.number().int().min(1).max(100),
        })
        .strict()
        .parse(req.body),
      key = idempotencyKey(req);
    await transaction(
      pools.pool,
      (db) => merchantGrant(db, actor, m, ['owner'], undefined, true),
      actor,
    );
    const passwordHash = body.password ? await hashPassword(body.password, c.AUTH_PEPPER) : null;
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner'], undefined, true);
        return operation(
          db,
          actor,
          {
            scope: 'invitation.create:' + m,
            key,
            payload: {
              ...body,
              password: body.password ? keyedHash(body.password, c.AUTH_PEPPER) : null,
            },
            merchantId: m,
          },
          async () => {
            if (passwordHash)
              return { account: await createAccount(db, actor, m, body, passwordHash) };
            const limits = (
              await db.query('SELECT * FROM feature_entitlements WHERE merchant_id=$1 FOR UPDATE', [
                m,
              ])
            ).rows[0];
            requireCondition(limits, 'ENTITLEMENTS_NOT_CONFIGURED', 409);
            const used = Number(
              (
                await db.query(
                  "SELECT (SELECT count(*) FROM staff_memberships WHERE merchant_id=$1)+(SELECT count(*) FROM invitations WHERE merchant_id=$1 AND status='pending' AND expires_at>now()) AS n",
                  [m],
                )
              ).rows[0].n,
            );
            requireCondition(used < limits.max_staff, 'PLAN_LIMIT', 409);
            const count = (
              await db.query(
                "SELECT count(*)::int AS n FROM branches WHERE merchant_id=$1 AND id=ANY($2) AND status='active'",
                [m, body.branchIds],
              )
            ).rows[0].n;
            requireCondition(count === new Set(body.branchIds).size, 'BRANCH_UNAUTHORIZED', 403);
            return { invitation: await invitation(db, actor, c, m, body) };
          },
        );
      },
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/invitations/:id/resend', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner'], undefined, true);
        return operation(
          db,
          actor,
          { scope: 'invite.resend:' + id, key, payload: { id }, merchantId: m },
          async () => {
            const inv = (
              await db.query(
                "SELECT * FROM invitations WHERE merchant_id=$1 AND id=$2 AND status='pending' FOR UPDATE",
                [m, id],
              )
            ).rows[0];
            requireCondition(inv, 'NOT_FOUND', 404);
            const token = opaqueToken(),
              revision = inv.revision + 1;
            await db.query(
              "UPDATE invitations SET token_hash=$1,expires_at=now()+interval '7 days',revision=$2 WHERE id=$3",
              [tokenHash(token), revision, id],
            );
            await emitOutbox(db, {
              merchantId: m,
              eventType: 'staff.invited',
              aggregateId: id,
              revision,
              payload: {
                email: inv.email,
                encryptedToken: seal(token, c.AUTH_PEPPER),
                locale: actor.locale || 'ar',
              },
              dedupeKey: 'invite:' + id + ':' + revision,
              kind: 'invitation_email',
            });
            await audit(db, actor, 'invitation.resend', m, id);
            return { id, status: 'pending', revision };
          },
        );
      },
      actor,
    );
  });
  app.delete('/api/v1/merchants/:m/invitations/:id', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner']);
        const r = await db.query(
          "UPDATE invitations SET status='revoked' WHERE merchant_id=$1 AND id=$2 AND status='pending' RETURNING id",
          [m, id],
        );
        requireCondition(r.rowCount, 'NOT_FOUND', 404);
        await audit(db, actor, 'invitation.revoke', m, id);
        return { revoked: true };
      },
      actor,
    );
  });
  app.patch('/api/v1/merchants/:m/staff/:id', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params),
      body = z
        .object({
          name: z.string().trim().min(1).max(100).optional(),
          status: z.enum(['active', 'disabled']),
          role: z.enum(['owner', 'manager', 'cashier']),
          branchIds: z.array(z.uuid()).min(1),
          maxQty: z.number().int().min(1).max(100),
          reason: z.string().trim().min(4).max(500),
        })
        .strict()
        .parse(req.body),
      rev = expectedRevision(req);
    return transaction(
      pools.pool,
      async (db) => {
        if (actor.role === 'platform_admin') platform(actor);
        else await merchantGrant(db, actor, m, ['owner']);
        await db.query('SELECT id FROM merchants WHERE id=$1 FOR UPDATE', [m]);
        const target = (
          await db.query(
            'SELECT * FROM staff_memberships WHERE merchant_id=$1 AND id=$2 FOR UPDATE',
            [m, id],
          )
        ).rows[0];
        requireCondition(target, 'NOT_FOUND', 404);
        requireCondition(target.revision === rev, 'REVISION_CONFLICT', 409);
        requireCondition(
          target.user_id !== actor.id || (body.status === 'active' && body.role === 'owner'),
          'SELF_ESCALATION_FORBIDDEN',
          403,
        );
        if (target.role === 'owner' && (body.role !== 'owner' || body.status === 'disabled'))
          requireCondition(
            Number(
              (
                await db.query(
                  "SELECT count(*) AS n FROM staff_memberships WHERE merchant_id=$1 AND role='owner' AND status='active'",
                  [m],
                )
              ).rows[0].n,
            ) > 1,
            'LAST_OWNER',
            409,
          );
        const count = (
          await db.query(
            'SELECT count(*)::int AS n FROM branches WHERE merchant_id=$1 AND id=ANY($2)',
            [m, body.branchIds],
          )
        ).rows[0].n;
        requireCondition(count === body.branchIds.length, 'BRANCH_UNAUTHORIZED', 403);
        const s = (
          await db.query(
            'UPDATE staff_memberships SET role=$1,status=$2,max_qty=$3,name=coalesce($5,name),revision=revision+1 WHERE id=$4 RETURNING *',
            [body.role, body.status, body.maxQty, id, body.name || null],
          )
        ).rows[0];
        await db.query('DELETE FROM staff_branch_grants WHERE staff_id=$1', [id]);
        for (const b of body.branchIds)
          await db.query(
            'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3)',
            [m, id, b],
          );
        await audit(db, actor, 'staff.update', m, id, {
          reason: body.reason,
          status: body.status,
          branchIds: body.branchIds,
        });
        return { staff: s };
      },
      actor,
    );
  });
  app.post('/api/v1/platform/merchants/:m/status', async (req) => {
    const actor = authenticated(req);
    platform(actor);
    const { m } = uuidParams.parse(req.params),
      body = z
        .object({
          status: z.enum(['active', 'trial', 'suspended']),
          reason: z.string().trim().min(4).max(500),
        })
        .strict()
        .parse(req.body);
    return transaction(
      pools.pool,
      async (db) => {
        const row = (
          await db.query(
            'UPDATE merchants SET status=$1,suspend_reason=$2,revision=revision+1 WHERE id=$3 RETURNING id,status,revision',
            [body.status, body.reason, m],
          )
        ).rows[0];
        requireCondition(row, 'NOT_FOUND', 404);
        await audit(db, actor, 'merchant.status', m, m, body);
        return { merchant: row };
      },
      actor,
    );
  });
  app.patch('/api/v1/merchants/:m/branding', async (req) => {
    const actor = authenticated(req),
      { m } = uuidParams.parse(req.params),
      body = z
        .object({
          contactPhone: contactPhone.optional(),
          contactEmail: z.email().optional(),
          name: z.string().trim().min(2).max(120),
          primaryColor: color,
          accentColor: color,
          surfaceColor: color,
          template: cardTemplate,
          logoStyle: z.enum(logoStyles).optional(),
          logoSize: z.number().int().min(32).max(72).optional(),
          stampShape: stampDesign.stampShape.removeDefault().optional(),
          stampIcon: stampDesign.stampIcon.removeDefault().optional(),
          stampStyle: stampDesign.stampStyle.removeDefault().optional(),
          terms: z.string().min(4).max(3000),
          logoAssetId: z.uuid().nullable().optional(),
        })
        .strict()
        .parse(req.body),
      rev = expectedRevision(req);
    return transaction(
      pools.pool,
      async (db) => {
        if (actor.role === 'platform_admin') platform(actor);
        else await merchantGrant(db, actor, m, ['owner']);
        const row = (
          await db.query(
            'UPDATE merchants SET name=$1,primary_color=$2,accent_color=$3,surface_color=$4,template=$5,terms=$6,logo_asset_id=coalesce($7,logo_asset_id),stamp_shape=coalesce($10,stamp_shape),stamp_icon=coalesce($11,stamp_icon),stamp_style=coalesce($12,stamp_style),contact_email=coalesce($13,contact_email),contact_phone=coalesce($14,contact_phone),logo_style=coalesce($15,logo_style),logo_size=coalesce($16,logo_size),revision=revision+1 WHERE id=$8 AND revision=$9 RETURNING *',
            [
              body.name,
              body.primaryColor,
              body.accentColor,
              body.surfaceColor,
              body.template,
              body.terms,
              body.logoAssetId || null,
              m,
              rev,
              body.stampShape || null,
              body.stampIcon || null,
              body.stampStyle || null,
              body.contactEmail ?? null,
              body.contactPhone ?? null,
              body.logoStyle ?? null,
              body.logoSize ?? null,
            ],
          )
        ).rows[0];
        requireCondition(row, 'REVISION_CONFLICT', 409);
        await audit(db, actor, 'branding.publish', m, m, { revision: row.revision });
        return { merchant: row };
      },
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/assets', { bodyLimit: 3_000_000 }, async (req) => {
    const actor = authenticated(req),
      { m } = uuidParams.parse(req.params),
      body = z
        .object({ base64: z.string().max(2_800_000), publishLogo: z.boolean().default(false) })
        .strict()
        .parse(req.body);
    const rev = body.publishLogo ? expectedRevision(req) : null;
    const uploadKey = body.publishLogo ? idempotencyKey(req) : null;
    await transaction(
      pools.pool,
      async (db) => {
        if (actor.role === 'platform_admin') platform(actor);
        else await merchantGrant(db, actor, m, ['owner']);
      },
      actor,
    );
    const sanitized = await sanitizeLogo(body.base64),
      output = sanitized.bytes,
      info = sanitized;
    return transaction(
      pools.pool,
      async (db) => {
        if (actor.role === 'platform_admin') platform(actor);
        else await merchantGrant(db, actor, m, ['owner']);
        const store = async () => {
          if (body.publishLogo)
            requireCondition(
              (
                await db.query('SELECT id FROM merchants WHERE id=$1 AND revision=$2 FOR UPDATE', [
                  m,
                  rev,
                ])
              ).rowCount,
              'REVISION_CONFLICT',
              409,
            );
          const id = randomUUID(),
            key = m + '/' + id + '.png';
          await files.put(key, output, { contentType: 'image/png' });
          const asset = (
            await db.query(
              'INSERT INTO assets(id,merchant_id,storage_key,mime,bytes,width,height,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,mime,width,height',
              [
                id,
                m,
                key,
                'image/png',
                output.length,
                info.width,
                info.height,
                tokenHash(output.toString('base64')),
                actor.id,
              ],
            )
          ).rows[0];
          await audit(db, actor, 'asset.upload', m, id);
          if (body.publishLogo) {
            const merchant = (
              await db.query(
                'UPDATE merchants SET logo_asset_id=$1,revision=revision+1 WHERE id=$2 AND revision=$3 RETURNING *',
                [id, m, rev],
              )
            ).rows[0];
            requireCondition(merchant, 'REVISION_CONFLICT', 409);
            await audit(db, actor, 'branding.logo_publish', m, id, { revision: merchant.revision });
            return { asset, merchant };
          }
          return { asset, merchant: null };
        };
        return body.publishLogo
          ? operation(
              db,
              actor,
              {
                scope: 'branding.logo:' + m,
                key: uploadKey!,
                merchantId: m,
                payload: { revision: rev, sha256: tokenHash(output.toString('base64')) },
              },
              store,
            )
          : store();
      },
      actor,
    );
  });
  app.get('/api/v1/merchants/:m/assets/:id', async (req, reply) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params);
    await transaction(
      pools.pool,
      async (db) => {
        if (actor.role === 'platform_admin') platform(actor, false);
        else await merchantGrant(db, actor, m, ['owner', 'manager']);
        requireCondition(
          (await db.query('SELECT id FROM assets WHERE merchant_id=$1 AND id=$2', [m, id]))
            .rowCount,
          'NOT_FOUND',
          404,
        );
      },
      actor,
    );
    return reply
      .type('image/png')
      .header('X-Content-Type-Options', 'nosniff')
      .send(await files.get(m + '/' + id + '.png'));
  });
  app.get('/api/v1/merchants/:m/programs', async (req) => {
    const actor = authenticated(req),
      { m } = uuidParams.parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        if (actor.role === 'platform_admin') platform(actor, false);
        else await merchantGrant(db, actor, m, ['owner', 'manager']);
        return {
          programs: (
            await db.query(
              "SELECT p.*,v.version,v.threshold,v.max_per_tx,v.reward_title,v.reward_terms,v.validity_days,v.ends_at,coalesce((SELECT jsonb_agg(branch_id) FROM program_branches WHERE program_version_id=v.id),'[]') AS branch_ids FROM programs p JOIN program_versions v ON v.id=p.current_version_id WHERE p.merchant_id=$1 ORDER BY p.created_at",
              [m],
            )
          ).rows,
        };
      },
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/programs', async (req) => {
    const actor = authenticated(req),
      { m } = uuidParams.parse(req.params),
      p = programInput
        .extend({ branchIds: z.array(z.uuid()).min(1).max(10) })
        .strict()
        .parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner'], undefined, true);
        return operation(
          db,
          actor,
          { scope: 'program.create:' + m, key, payload: p, merchantId: m },
          async () => {
            const limits = (
              await db.query('SELECT * FROM feature_entitlements WHERE merchant_id=$1 FOR UPDATE', [
                m,
              ])
            ).rows[0];
            requireCondition(limits, 'ENTITLEMENTS_NOT_CONFIGURED', 409);
            requireCondition(
              Number(
                (
                  await db.query(
                    "SELECT count(*) AS n FROM programs WHERE merchant_id=$1 AND status='active'",
                    [m],
                  )
                ).rows[0].n,
              ) < limits.max_programs,
              'PLAN_LIMIT',
              409,
            );
            requireCondition(
              (
                await db.query(
                  "SELECT id FROM branches WHERE merchant_id=$1 AND id=ANY($2) AND status='active'",
                  [m, p.branchIds],
                )
              ).rowCount === p.branchIds.length,
              'BRANCH_UNAUTHORIZED',
              403,
            );
            const program = (
              await db.query(
                'INSERT INTO programs(merchant_id,name) VALUES($1,$2) RETURNING id,name,status',
                [m, p.name],
              )
            ).rows[0];
            const version = (
              await db.query(
                'INSERT INTO program_versions(merchant_id,program_id,version,threshold,max_per_tx,reward_title,reward_terms,validity_days,ends_at) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8) RETURNING *',
                [
                  m,
                  program.id,
                  p.threshold,
                  p.maxPerTx,
                  p.rewardTitle,
                  p.rewardTerms,
                  p.validityDays,
                  p.endsAt,
                ],
              )
            ).rows[0];
            for (const branch of p.branchIds)
              await db.query(
                'INSERT INTO program_branches(merchant_id,program_version_id,branch_id) VALUES($1,$2,$3)',
                [m, version.id, branch],
              );
            await db.query('UPDATE programs SET current_version_id=$1 WHERE id=$2', [
              version.id,
              program.id,
            ]);
            await audit(db, actor, 'program.create', m, program.id, {
              programVersionId: version.id,
              branchIds: p.branchIds,
            });
            return { program, version };
          },
        );
      },
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/programs/:id/earning-status', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params),
      p = z
        .object({ enabled: z.boolean(), reason: z.string().trim().min(4).max(500) })
        .strict()
        .parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner'], undefined, true);
        return operation(
          db,
          actor,
          { scope: 'program.earning:' + id, key, payload: p, merchantId: m },
          async () => {
            const limits = (
                await db.query(
                  'SELECT * FROM feature_entitlements WHERE merchant_id=$1 FOR UPDATE',
                  [m],
                )
              ).rows[0],
              program = (
                await db.query(
                  'SELECT p.*,v.starts_at,v.ends_at FROM programs p JOIN program_versions v ON v.id=p.current_version_id WHERE p.merchant_id=$1 AND p.id=$2 FOR UPDATE OF p',
                  [m, id],
                )
              ).rows[0];
            requireCondition(program, 'NOT_FOUND', 404);
            if (p.enabled) {
              requireCondition(limits, 'ENTITLEMENTS_NOT_CONFIGURED', 409);
              if (program.status !== 'active')
                requireCondition(
                  Number(
                    (
                      await db.query(
                        "SELECT count(*) AS n FROM programs WHERE merchant_id=$1 AND status='active'",
                        [m],
                      )
                    ).rows[0].n,
                  ) < limits.max_programs,
                  'PLAN_LIMIT',
                  409,
                );
              const clock = (await db.query('SELECT clock_timestamp() AS at')).rows[0].at;
              requireCondition(
                program.starts_at <= clock && (!program.ends_at || program.ends_at > clock),
                'PROGRAM_INACTIVE',
                409,
              );
            }
            const status = p.enabled ? 'active' : 'ended';
            await db.query('UPDATE programs SET status=$1 WHERE id=$2', [status, id]);
            await audit(db, actor, 'program.earning', m, id, p);
            return { id, status };
          },
        );
      },
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/programs/:id/versions', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params),
      body = programInput
        .extend({ branchIds: z.array(z.uuid()).min(1).max(10).optional() })
        .parse(req.body),
      key = idempotencyKey(req);
    return transaction(
      pools.pool,
      async (db) => {
        if (actor.role === 'platform_admin') platform(actor);
        else await merchantGrant(db, actor, m, ['owner']);
        return operation(
          db,
          actor,
          { scope: 'program.publish:' + id, key, payload: body, merchantId: m },
          async () => {
            const p = (
              await db.query('SELECT * FROM programs WHERE merchant_id=$1 AND id=$2 FOR UPDATE', [
                m,
                id,
              ])
            ).rows[0];
            requireCondition(p, 'NOT_FOUND', 404);
            const current = (
              await db.query('SELECT * FROM program_versions WHERE id=$1', [p.current_version_id])
            ).rows[0];
            const v = (
              await db.query(
                'INSERT INTO program_versions(merchant_id,program_id,version,threshold,max_per_tx,reward_title,reward_terms,validity_days,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
                [
                  m,
                  id,
                  current.version + 1,
                  body.threshold,
                  body.maxPerTx,
                  body.rewardTitle,
                  body.rewardTerms,
                  body.validityDays,
                  body.endsAt,
                ],
              )
            ).rows[0];
            if (body.branchIds) {
              const count = (
                await db.query(
                  "SELECT count(*)::int AS n FROM branches WHERE merchant_id=$1 AND id=ANY($2) AND status='active'",
                  [m, body.branchIds],
                )
              ).rows[0].n;
              requireCondition(count === body.branchIds.length, 'BRANCH_UNAUTHORIZED', 403);
              for (const b of body.branchIds)
                await db.query(
                  'INSERT INTO program_branches(merchant_id,program_version_id,branch_id) VALUES($1,$2,$3)',
                  [m, v.id, b],
                );
            } else
              await db.query(
                'INSERT INTO program_branches SELECT merchant_id,$1,branch_id FROM program_branches WHERE program_version_id=$2',
                [v.id, p.current_version_id],
              );
            await db.query('UPDATE programs SET current_version_id=$1,name=$2 WHERE id=$3', [
              v.id,
              body.name,
              id,
            ]);
            await audit(db, actor, 'program.publish', m, id, {
              version: v.version,
              existingMemberships: 'pinned',
            });
            return { version: v };
          },
        );
      },
      actor,
    );
  });
  app.post('/api/v1/merchants/:m/programs/:id/end-earning', async (req) => {
    const actor = authenticated(req),
      { m, id } = z.object({ m: z.uuid(), id: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(db, actor, m, ['owner']);
        const r = await db.query(
          "UPDATE programs SET status='ended' WHERE merchant_id=$1 AND id=$2 RETURNING id",
          [m, id],
        );
        requireCondition(r.rowCount, 'NOT_FOUND', 404);
        await audit(db, actor, 'program.end', m, id);
        return { ended: true };
      },
      actor,
    );
  });
  app.get('/api/v1/public/merchants/:slug', async (req) => {
    const { slug } = z.object({ slug: z.string().max(63) }).parse(req.params);
    const r = await pools.pool.query('SELECT public_merchant_details($1) AS result', [slug]);
    requireCondition(r.rows[0]?.result, 'NOT_FOUND', 404);
    return r.rows[0].result;
  });
}
