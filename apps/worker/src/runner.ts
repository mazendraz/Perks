import pg from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Config } from '../../api/src/config.js';
import { unseal } from '../../api/src/outbox.js';
import { tokenHash } from '../../api/src/crypto.js';
import { createMailer, MailFailure } from '../../api/src/mail/mailer.js';
import { mailTemplate } from '../../api/src/mail/templates.js';
import { runAuthMail } from './auth-mail.js';
export interface ClaimedJob {
  job_id: string;
  merchant_id: string;
  kind: string;
  payload: Record<string, unknown>;
  aggregate_id: string;
  aggregate_revision: number;
  lease_id: string;
  outbox_id: string;
}
export async function runOne(pool: pg.Pool, c: Config): Promise<boolean> {
  const claim = (await pool.query<ClaimedJob>('SELECT * FROM claim_next_job()')).rows[0];
  if (!claim) return runAuthMail(pool, c);
  const started = new Date();
  let outcome = 'succeeded',
    error: string | null = null;
  try {
    if (claim.kind === 'invitation_email') {
      const token = unseal(String(claim.payload.encryptedToken), c.AUTH_PEPPER);
      const context = (
        await pool.query('SELECT invitation_mail_context($1,$2,$3) AS value', [
          claim.merchant_id,
          claim.aggregate_id,
          tokenHash(token),
        ])
      ).rows[0].value;
      if (!context) {
        outcome = 'blocked';
        error = 'INVITATION_NOT_AVAILABLE';
      } else {
        const link = c.PUBLIC_APP_ORIGIN + '/invite/' + token;
        await createMailer(c, pool).send({
          ...mailTemplate(
            'invitation',
            (context.locale || claim.payload.locale) === 'en' ? 'en' : 'ar',
            { link, business: context.name },
          ),
          to: context.email,
          idempotencyKey: claim.outbox_id,
          metadata: {
            kind: 'invitation',
            link,
            merchantId: claim.merchant_id,
            expiresAt: context.expiresAt,
          },
        });
      }
    } else if (claim.kind === 'customer_export') {
      if (!['development', 'test'].includes(c.APP_ENV)) {
        outcome = 'blocked';
        error = 'OBJECT_STORAGE_NOT_CONFIGURED';
      } else {
        const ex = (
          await pool.query('SELECT prepare_customer_export($1,$2) AS value', [
            String(claim.payload.exportId),
            claim.lease_id,
          ])
        ).rows[0].value;
        if (!ex.existingStorageKey) {
          const columns = [
            'id',
            'alias',
            'contact_email',
            'created_at',
            'last_purchase_at',
            'visits',
            'net_stamps',
            'segment',
          ];
          const cell = (v: unknown) =>
            '"' +
            String(v ?? '')
              .replace(/^[=+@\-\t\r]/, "'$&")
              .replaceAll('"', '""') +
            '"';
          const csv =
            '\uFEFF' +
            [
              columns.join(','),
              ...ex.rows.map((row: Record<string, unknown>) =>
                columns.map((k) => cell(row[k])).join(','),
              ),
            ].join('\r\n');
          const dir = resolve('.local/exports', claim.merchant_id);
          await mkdir(dir, { recursive: true });
          const d = await pool.connect();
          try {
            await d.query('BEGIN');
            await d.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
              'export-file:' +
                claim.merchant_id +
                '/' +
                ex.exportId +
                '-' +
                claim.lease_id +
                '.csv',
            ]);
            await writeFile(resolve(dir, ex.exportId + '-' + claim.lease_id + '.csv'), csv, {
              mode: 0o600,
            });

            await d.query("SELECT set_config('app.worker_tenant',$1,true)", [claim.merchant_id]);
            await d.query(
              "UPDATE customer_exports SET status='ready',storage_key=$1,row_count=$2 WHERE id=$3 AND status='queued' AND expires_at>clock_timestamp() AND EXISTS(SELECT 1 FROM background_jobs WHERE id=$4 AND lease_id=$5 AND status='running' AND lease_until>clock_timestamp())",
              [
                claim.merchant_id + '/' + ex.exportId + '-' + claim.lease_id + '.csv',
                ex.rows.length,
                ex.exportId,
                claim.job_id,
                claim.lease_id,
              ],
            );
            await d.query('COMMIT');
          } catch (e) {
            await d.query('ROLLBACK');
            throw e;
          } finally {
            d.release();
          }
        }
      }
    } else if (claim.kind === 'domain_event') {
      // Records internal processing only. Never marks external delivery as successful.
    } else {
      outcome = 'blocked';
      error = 'PROVIDER_NOT_CONFIGURED';
    }
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : '';
    if (cause instanceof MailFailure) {
      outcome = cause.outcome;
      error = cause.code;
    } else if (
      claim.kind === 'customer_export' &&
      ['NQ:EXPORT_SCOPE_CHANGED', 'NQ:NOT_FOUND'].includes(code)
    ) {
      outcome = 'blocked';
      error = code === 'NQ:EXPORT_SCOPE_CHANGED' ? 'EXPORT_SCOPE_CHANGED' : 'EXPORT_NOT_AVAILABLE';
    } else {
      outcome = 'failed';
      error = 'JOB_EXECUTION_FAILED';
    }
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.worker_tenant',$1,true)", [claim.merchant_id]);
    const done = await db.query(
      "UPDATE background_jobs SET status=$1,last_error=$2,lease_until=NULL WHERE id=$3 AND merchant_id=$4 AND lease_id=$5 AND status='running' AND lease_until>clock_timestamp() RETURNING id",
      [outcome, error, claim.job_id, claim.merchant_id, claim.lease_id],
    );
    if (done.rowCount) {
      if (claim.kind === 'customer_export' && outcome !== 'succeeded')
        await db.query(
          "UPDATE customer_exports SET status='failed',error_code=$1 WHERE id=$2 AND merchant_id=$3 AND status='queued'",
          [error, String(claim.payload.exportId), claim.merchant_id],
        );
      await db.query(
        'INSERT INTO job_attempts(merchant_id,job_id,lease_id,outcome,error_code,started_at) VALUES($1,$2,$3,$4,$5,$6)',
        [claim.merchant_id, claim.job_id, claim.lease_id, outcome, error, started],
      );
    }
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
  await runAuthMail(pool, c);
  return true;
}
