import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, readdir, stat, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import nodemailer from 'nodemailer';
import type pg from 'pg';
import { deployed, type Config } from '../config.js';
import { canonicalJson, keyedHash } from '../crypto.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
  metadata?: { kind: string; link?: string; merchantId?: string; expiresAt?: string };
}
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}
export class MailFailure extends Error {
  constructor(
    public code: string,
    public outcome: 'failed' | 'blocked' | 'unknown',
  ) {
    super(code);
  }
}
const fileWrites = new Map<string, Promise<void>>();
export class FileSinkMailer implements Mailer {
  constructor(private c: Config) {
    if (deployed(c)) throw new Error('File mail sink is forbidden in deployed environments.');
  }
  async send(message: MailMessage) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(message.idempotencyKey))
      throw new MailFailure('MAIL_INTENT_CONFLICT', 'blocked');
    const dir = resolve(this.c.MAIL_FILE_ROOT),
      path = resolve(dir, message.idempotencyKey + '.json');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const value = {
      id: message.idempotencyKey,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...message.metadata,
      createdAt: new Date().toISOString(),
    };
    const temp = resolve(dir, randomUUID() + '.tmp');
    const waiting = fileWrites.get(path);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fileWrites.set(path, gate);
    try {
      await waiting;
      let previous: Record<string, unknown> | null = null;
      try {
        previous = JSON.parse(await readFile(path, 'utf8'));
      } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') throw error;
      }
      if (previous) {
        if (
          previous.to !== value.to ||
          previous.link !== value.link ||
          (previous.text && previous.text !== value.text) ||
          (previous.html && previous.html !== value.html) ||
          (previous.subject && previous.subject !== value.subject)
        )
          throw new MailFailure('MAIL_INTENT_CONFLICT', 'blocked');
        return;
      }
      await writeFile(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
      await rename(temp, path);
    } finally {
      await unlink(temp).catch(() => {});
      release();
      if (fileWrites.get(path) === gate) fileWrites.delete(path);
    }
  }
}
export class SmtpMailer implements Mailer {
  constructor(
    private c: Config,
    private pool: pg.Pool,
  ) {}
  async send(message: MailMessage) {
    const ca = this.c.SMTP_CA_FILE ? await readFile(this.c.SMTP_CA_FILE) : undefined;
    const dispatch = randomUUID();
    const hash = keyedHash(
      canonicalJson({
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      this.c.AUTH_PEPPER,
    );
    const state = (
      await this.pool.query('SELECT begin_mail_delivery($1,$2,$3) AS state', [
        message.idempotencyKey,
        hash,
        dispatch,
      ])
    ).rows[0].state;
    if (state === 'sent') return;
    if (state === 'conflict') throw new MailFailure('MAIL_INTENT_CONFLICT', 'blocked');
    if (state === 'rejected') throw new MailFailure('SMTP_REJECTED', 'blocked');
    if (state !== 'dispatch') throw new MailFailure('SMTP_UNKNOWN', 'unknown');
    const transport = nodemailer.createTransport({
      host: this.c.SMTP_HOST,
      port: this.c.SMTP_PORT,
      secure: this.c.SMTP_SECURE === 'true' || this.c.SMTP_PORT === 465,
      requireTLS: this.c.SMTP_STARTTLS === 'true' || deployed(this.c),
      auth: { user: this.c.SMTP_USER!, pass: this.c.SMTP_PASS! },
      tls: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    let smtpAccepted = false;
    try {
      const sent = await transport.sendMail({
        from: this.c.SMTP_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        messageId:
          '<nuqta-' +
          message.idempotencyKey +
          '@' +
          new URL(this.c.PUBLIC_APP_ORIGIN).hostname +
          '>',
      });
      if (!sent.accepted.length) throw new MailFailure('SMTP_REJECTED', 'blocked');
      smtpAccepted = true;
      const saved = (
        await this.pool.query("SELECT finish_mail_delivery($1,$2,'sent',NULL) AS saved", [
          message.idempotencyKey,
          dispatch,
        ])
      ).rows[0].saved;
      if (!saved) throw new MailFailure('SMTP_UNKNOWN', 'unknown');
    } catch (error) {
      let failure: MailFailure;
      if (error instanceof MailFailure) failure = error;
      else {
        const smtp = error as {
          command?: string;
          responseCode?: number;
          code?: string;
          syscall?: string;
        };
        const rejected = smtp.responseCode && smtp.responseCode >= 500;
        const safeRetry =
          (smtp.responseCode && smtp.responseCode >= 400 && smtp.responseCode < 500) ||
          smtp.code === 'EDNS' ||
          smtp.syscall === 'connect' ||
          /^(EHLO|HELO|AUTH|STARTTLS|MAIL FROM|RCPT TO)/.test(smtp.command || '');
        failure = new MailFailure(
          smtpAccepted
            ? 'SMTP_UNKNOWN'
            : rejected
              ? 'SMTP_REJECTED'
              : safeRetry
                ? 'SMTP_UNAVAILABLE'
                : 'SMTP_UNKNOWN',
          smtpAccepted ? 'unknown' : rejected ? 'blocked' : safeRetry ? 'failed' : 'unknown',
        );
      }
      await this.pool
        .query('SELECT finish_mail_delivery($1,$2,$3,$4)', [
          message.idempotencyKey,
          dispatch,
          failure.outcome === 'failed'
            ? 'retryable'
            : failure.outcome === 'blocked'
              ? 'rejected'
              : 'unknown',
          failure.code,
        ])
        .catch(() => {});
      throw failure;
    } finally {
      transport.close();
    }
  }
}
export const createMailer = (c: Config, pool: pg.Pool): Mailer =>
  c.MAIL_TRANSPORT === 'smtp' ? new SmtpMailer(c, pool) : new FileSinkMailer(c);

export async function readLocalMailbox(c: Config) {
  if (deployed(c) || c.AUTH_PROVIDER !== 'local' || c.MAIL_TRANSPORT !== 'file')
    throw new Error('Local mail is unavailable.');
  const directory = resolve(c.MAIL_FILE_ROOT);
  let files: string[];
  try {
    files = await readdir(directory);
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return [];
    throw error;
  }
  const recent: { path: string; time: number }[] = [];
  const candidates = files.filter((name) => /^[0-9a-f-]{36}\.json$/.test(name));
  for (let offset = 0; offset < candidates.length; offset += 32) {
    const batch = await Promise.all(
      candidates.slice(offset, offset + 32).map(async (name) => {
        const path = resolve(directory, name);
        return { path, time: (await stat(path)).mtimeMs };
      }),
    );
    recent.push(...batch);
  }
  const messages: Record<string, unknown>[] = [];
  for (const file of recent.sort((a, b) => b.time - a.time).slice(0, 50)) {
    const value = JSON.parse(await readFile(file.path, 'utf8'));
    if (!value.expiresAt || Date.parse(value.expiresAt) > Date.now()) messages.push(value);
  }
  return messages;
}
