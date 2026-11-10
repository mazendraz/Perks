import { enrollmentInput, preferenceInput } from '../../../../packages/contracts/src/commands.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import QRCode from 'qrcode';
import type { Config } from '../config.js';
import { type Pools, transaction, audit } from '../db.js';
import { authenticated } from '../auth.js';
import { idempotencyKey, operation } from '../operations.js';
import { keyedHash, tokenHash, opaqueToken } from '../crypto.js';
import { requireCondition } from '../errors.js';
import { merchantGrant } from '../policy.js';
import { acceptedLegal } from '../legal.js';
export function readPresentationToken(value: string) {
  return value.replace(/^NQP:/, '');
}
export function enrollmentModule(app: FastifyInstance, pools: Pools, c: Config) {
  app.get('/api/v1/public/programs/:id/terms', async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params),
      result = (await pools.pool.query('SELECT public_enrollment_terms($1) AS value', [id])).rows[0]
        .value;
    requireCondition(result, 'NOT_FOUND', 404);
    return result;
  });
  app.post('/api/v1/me/memberships', async (req) => {
    const actor = authenticated(req),
      body = enrollmentInput.parse(req.body),
      key = idempotencyKey(req);
    const notice = actor.authMethod === 'device' ? acceptedLegal(body) : undefined;
    return transaction(
      pools.pool,
      (db) =>
        operation(
          db,
          actor,
          { scope: 'membership.enroll', key, payload: body, merchantId: body.merchantId },
          async () => {
            if (notice)
              await db.query('SELECT accept_customer_legal($1,$2,$3)', [
                actor.sessionId,
                notice.acceptance.version,
                notice.acceptance.text,
              ]);
            if (body.consents.whatsapp)
              await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
                'consent:' + body.merchantId + ':' + actor.id,
              ]);
            const result = (
              await db.query(
                'SELECT enroll_customer_with_terms($1,$2,$3,$4,$5,$6,$7,$8) AS result',
                [
                  body.merchantId,
                  body.programId,
                  body.programVersionId,
                  body.alias,
                  body.source,
                  body.branchId,
                  body.consents,
                  body.acceptedTermsHash,
                ],
              )
            ).rows[0].result as Record<string, unknown>;
            if (body.contactPhone)
              await db.query('SELECT set_customer_contact_phone($1,$2,true)', [
                body.merchantId,
                body.contactPhone,
              ]);
            if (body.consents.whatsapp) {
              const current = (
                await db.query(
                  "SELECT granted FROM consent_current WHERE merchant_id=$1 AND user_id=$2 AND channel='whatsapp' FOR UPDATE",
                  [body.merchantId, actor.id],
                )
              ).rows[0];
              if (!current?.granted) {
                await db.query(
                  "INSERT INTO consent_events(merchant_id,user_id,channel,granted) VALUES($1,$2,'whatsapp',true)",
                  [body.merchantId, actor.id],
                );
                await db.query(
                  "INSERT INTO consent_current(merchant_id,user_id,channel,granted) VALUES($1,$2,'whatsapp',true) ON CONFLICT(merchant_id,user_id,channel) DO UPDATE SET granted=true,revision=consent_current.revision+1,updated_at=clock_timestamp()",
                  [body.merchantId, actor.id],
                );
              }
            }
            return result;
          },
        ),
      actor,
    );
  });
  app.get('/api/v1/me/memberships', async (req) => {
    const actor = authenticated(req);
    return transaction(
      pools.pool,
      async (db) => ({
        cards: (
          await db.query(
            "SELECT card || jsonb_build_object('logo_asset_id',b.logo_asset_id,'stamp_ink',customer_stamp_artwork((card->>'id')::uuid),'earning_active',(card->>'earning_active')::boolean AND merchant_earning_allowed((card->>'merchant_id')::uuid)) AS card FROM my_cards() card LEFT JOIN public_merchant_brands b ON b.id=(card->>'merchant_id')::uuid",
          )
        ).rows.map((r) => r.card),
      }),
      actor,
    );
  });
  app.get('/api/v1/me/memberships/:id', async (req) => {
    const actor = authenticated(req),
      { id } = z.object({ id: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        const card = (
          await db.query(
            "SELECT card || jsonb_build_object('logo_asset_id',b.logo_asset_id,'stamp_ink',customer_stamp_artwork((card->>'id')::uuid),'earning_active',(card->>'earning_active')::boolean AND merchant_earning_allowed((card->>'merchant_id')::uuid)) AS card FROM my_cards() card LEFT JOIN public_merchant_brands b ON b.id=(card->>'merchant_id')::uuid WHERE card->>'id'=$1",
            [id],
          )
        ).rows[0]?.card;
        requireCondition(card, 'NOT_FOUND', 404);
        return { card };
      },
      actor,
    );
  });
  app.post('/api/v1/me/memberships/:id/presentation-tokens', async (req) => {
    const actor = authenticated(req),
      { id } = z.object({ id: z.uuid() }).parse(req.params),
      key = idempotencyKey(req);
    const issued = await transaction(
      pools.pool,
      async (db) => {
        const member = (
          await db.query('SELECT * FROM memberships WHERE id=$1 AND user_id=$2', [id, actor.id])
        ).rows[0];
        requireCondition(member, 'NOT_FOUND', 404);
        requireCondition(member.status === 'active', 'MEMBERSHIP_DISABLED', 403);
        return operation(
          db,
          actor,
          { scope: 'presentation.issue', key, payload: { id }, merchantId: member.merchant_id },
          async (operationId) => {
            const token = keyedHash('presentation:' + operationId + ':' + actor.id, c.AUTH_PEPPER);
            const p = (
              await db.query(
                "INSERT INTO presentation_tokens(merchant_id,membership_id,created_by,purpose,token_hash,session_id,expires_at) VALUES($1,$2,$3,'customer_presentation',$4,$5,clock_timestamp()+interval '90 seconds') RETURNING id,expires_at",
                [member.merchant_id, id, actor.id, tokenHash(token), actor.sessionId],
              )
            ).rows[0];
            return { presentationId: p.id, expiresAt: p.expires_at.toISOString() as string };
          },
        );
      },
      actor,
    );
    const token = keyedHash('presentation:' + issued.operationId + ':' + actor.id, c.AUTH_PEPPER);
    return {
      ...issued,
      token: 'NQP:' + token,
      qrDataUrl: await QRCode.toDataURL('NQP:' + token, {
        errorCorrectionLevel: 'M',
        margin: 4,
        width: 320,
      }),
    };
  });
  app.post('/api/v1/cashier/scans/resolve', async (req) => {
    const actor = authenticated(req),
      body = z
        .object({ merchantId: z.uuid(), branchId: z.uuid(), token: z.string().max(200) })
        .strict()
        .parse(req.body),
      token = readPresentationToken(body.token);
    requireCondition(/^[a-f0-9]{64}$/.test(token), 'TOKEN_INVALID', 422);
    return transaction(
      pools.pool,
      async (db) => {
        await merchantGrant(
          db,
          actor,
          body.merchantId,
          ['owner', 'manager', 'cashier'],
          body.branchId,
        );
        const r = (
          await db.query(
            'SELECT t.id,t.source_presentation_id,t.expires_at,t.purpose,t.created_by,t.session_id,t.branch_id,m.id AS membership_id,m.status,m.program_version_id,p.alias,a.balance,a.revision,v.threshold,v.reward_title,v.max_per_tx FROM presentation_tokens t JOIN memberships m ON m.id=t.membership_id AND m.merchant_id=t.merchant_id JOIN tenant_customer_profiles p ON p.id=m.profile_id JOIN loyalty_accounts a ON a.membership_id=m.id JOIN program_versions v ON v.id=m.program_version_id WHERE t.token_hash=$1 AND t.merchant_id=$2 AND t.expires_at>clock_timestamp()',
            [tokenHash(token), body.merchantId],
          )
        ).rows[0];
        requireCondition(r, 'TOKEN_INVALID_OR_EXPIRED', 410);
        requireCondition(r.status === 'active', 'MEMBERSHIP_DISABLED', 403);
        requireCondition(r.purpose !== 'cashier_lookup', 'CUSTOMER_QR_REQUIRED', 403);
        if (r.purpose === 'cashier_scan')
          requireCondition(
            r.created_by === actor.id &&
              r.session_id === actor.sessionId &&
              r.branch_id === body.branchId,
            'TOKEN_INVALID',
            403,
          );
        requireCondition(
          (await db.query('SELECT valid_customer_presentation($1) AS valid', [r.id])).rows[0].valid,
          'TOKEN_INVALID_OR_EXPIRED',
          410,
        );
        const proof = keyedHash('cashier-scan:' + opaqueToken(), c.AUTH_PEPPER);
        await db.query(
          "INSERT INTO presentation_tokens(merchant_id,membership_id,created_by,purpose,token_hash,session_id,branch_id,expires_at,source_presentation_id) VALUES($1,$2,$3,'cashier_scan',$4,$5,$6,$7,$8)",
          [
            body.merchantId,
            r.membership_id,
            actor.id,
            tokenHash(proof),
            actor.sessionId,
            body.branchId,
            r.expires_at,
            r.source_presentation_id || r.id,
          ],
        );
        await audit(db, actor, 'membership.scan', body.merchantId, r.membership_id, {
          branchId: body.branchId,
        });
        const rewards = (
          await db.query(
            "SELECT id,title,terms,CASE WHEN status='available' AND expires_at<=clock_timestamp() THEN 'expired' ELSE status END AS status,earned_at,expires_at,redeemed_at FROM reward_grants WHERE merchant_id=$1 AND membership_id=$2 AND $3::uuid=ANY(branch_ids) ORDER BY earned_at DESC LIMIT 20",
            [body.merchantId, r.membership_id, body.branchId],
          )
        ).rows;
        return {
          membership: {
            id: r.membership_id,
            alias: r.alias,
            balance: r.balance,
            threshold: r.threshold,
            rewardTitle: r.reward_title,
            revision: r.revision,
            maxPerTx: r.max_per_tx,
          },
          rewards,
          presentationContext: 'NQP:' + proof,
          expiresAt: r.expires_at,
        };
      },
      actor,
    );
  });
  app.get('/api/v1/me/merchants/:m/preferences', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params);
    return transaction(
      pools.pool,
      async (db) => {
        requireCondition(
          (await db.query('SELECT customer_access($1) AS allowed', [m])).rows[0].allowed,
          'NOT_FOUND',
          404,
        );
        return {
          preferences: (
            await db.query(
              'SELECT channel,granted,revision FROM consent_current WHERE merchant_id=$1 AND user_id=$2 ORDER BY channel',
              [m, actor.id],
            )
          ).rows,
        };
      },
      actor,
    );
  });
  app.patch('/api/v1/me/merchants/:m/preferences', async (req) => {
    const actor = authenticated(req),
      { m } = z.object({ m: z.uuid() }).parse(req.params),
      body = preferenceInput.parse(req.body);
    return transaction(
      pools.pool,
      async (db) => {
        requireCondition(
          (await db.query('SELECT customer_access($1) AS allowed', [m])).rows[0].allowed,
          'NOT_FOUND',
          404,
        );
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          'consent:' + m + ':' + actor.id,
        ]);
        await db.query(
          'INSERT INTO consent_events(merchant_id,user_id,channel,granted) VALUES($1,$2,$3,$4)',
          [m, actor.id, body.channel, body.granted],
        );
        const p = (
          await db.query(
            'INSERT INTO consent_current(merchant_id,user_id,channel,granted) VALUES($1,$2,$3,$4) ON CONFLICT(merchant_id,user_id,channel) DO UPDATE SET granted=EXCLUDED.granted,revision=consent_current.revision+1,updated_at=clock_timestamp() RETURNING *',
            [m, actor.id, body.channel, body.granted],
          )
        ).rows[0];
        return { preference: p };
      },
      actor,
    );
  });
}
