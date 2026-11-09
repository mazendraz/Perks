import type pg from 'pg';
import type { ServiceConfig } from '../../api/src/config.js';
import { unseal } from '../../api/src/outbox.js';
import { createMailer, MailFailure } from '../../api/src/mail/mailer.js';
import { mailTemplate } from '../../api/src/mail/templates.js';

export async function runAuthMail(pool: pg.Pool, c: ServiceConfig) {
  const job = (await pool.query('SELECT * FROM claim_auth_mail()')).rows[0];
  if (!job) return false;
  let status = 'sent',
    error: string | null = null;
  try {
    const link =
      job.kind === 'password_reset'
        ? c.PUBLIC_APP_ORIGIN +
          '/reset-password/' +
          unseal(String(job.payload.encryptedToken), c.AUTH_PEPPER)
        : c.PUBLIC_APP_ORIGIN + '/login';
    const content = mailTemplate(job.kind, job.locale, { link });
    await createMailer(c, pool).send({
      ...content,
      to: job.email,
      idempotencyKey: job.mail_id,
      metadata: { kind: job.kind, link, expiresAt: job.expires_at.toISOString() },
    });
  } catch (cause) {
    if (cause instanceof MailFailure) {
      status = cause.outcome;
      error = cause.code;
    } else {
      status = 'failed';
      error = 'MAIL_EXECUTION_FAILED';
    }
  }
  await pool.query('SELECT finish_auth_mail($1,$2,$3,$4)', [
    job.mail_id,
    job.lease_id,
    status,
    error,
  ]);
  return true;
}
