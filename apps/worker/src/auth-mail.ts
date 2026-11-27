import type pg from 'pg';
import type { ServiceConfig } from '../../api/src/config.js';
import { unseal } from '../../api/src/outbox.js';
import { createMailer, MailFailure } from '../../api/src/mail/mailer.js';
import { mailTemplate, type MailKind } from '../../api/src/mail/templates.js';

/** Where each notification's button leads; reset-style mail carries its own token link. */
const linkPaths: Partial<Record<MailKind, string>> = {
  password_changed: '/login',
  onboarding_payment_confirmed: '/merchant',
  onboarding_payment_rejected: '/onboarding',
  onboarding_receipt_submitted: '/platform/onboarding-payments',
};

export async function runAuthMail(pool: pg.Pool, c: ServiceConfig) {
  const job = (await pool.query('SELECT * FROM claim_auth_mail()')).rows[0];
  if (!job) return false;
  let status = 'sent',
    error: string | null = null;
  try {
    const kind = job.kind as MailKind;
    const payload = (job.payload ?? {}) as Record<string, unknown>;
    const resetLink = () =>
      c.PUBLIC_APP_ORIGIN +
      '/reset-password/' +
      unseal(String(payload.encryptedToken), c.AUTH_PEPPER) +
      (kind === 'merchant_welcome' ? '?welcome=1' : '');
    const link =
      kind === 'password_reset' || kind === 'merchant_welcome'
        ? resetLink()
        : c.PUBLIC_APP_ORIGIN + (linkPaths[kind] ?? '/login');
    const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
    const content = mailTemplate(kind, job.locale, {
      link,
      name: text(payload.name),
      business: text(payload.shopName),
      reason: text(payload.reason),
      suspended: payload.suspended === true,
    });
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
