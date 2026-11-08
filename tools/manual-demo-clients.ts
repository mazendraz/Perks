import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { opaqueToken, tokenHash, keyedHash } from '../apps/api/src/crypto.js';
import { hashPassword } from '../apps/api/src/passwords.js';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../apps/api/src/config.js';
import { buildApp } from '../apps/api/src/server.js';
import { businessDate } from '../packages/domain/src/loyalty.js';
import { loadManualConfig, manualRoot, requireManualDatabase } from './manual-demo.js';

type Headers = { cookie: string; origin: string; 'x-csrf-token': string };
export async function demoCall<T = Record<string, unknown>>(
  app: FastifyInstance,
  path: string,
  headers?: Headers,
  body?: unknown,
  key?: string,
  ip = '127.0.0.1',
): Promise<T> {
  const request = {
    method: body === undefined ? ('GET' as const) : ('POST' as const),
    url: '/api/v1' + path,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(key ? { 'idempotency-key': key } : {}),
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
    remoteAddress: ip,
  };
  let result = await app.inject(request);
  for (let retry = 0; result.statusCode === 429 && retry < 18; retry++) {
    const delay = Math.min(5000, Math.max(1000, Number(result.headers['retry-after'] || 1) * 1000));
    await new Promise((r) => setTimeout(r, delay));
    result = await app.inject(request);
  }
  if (result.statusCode >= 400)
    throw new Error(
      'Manual fixture request failed: ' +
        path.replace(/\/invitations\/[^/]+/, '/invitations/[private]') +
        ' (' +
        result.statusCode +
        ' ' +
        result.json().error?.code +
        ')',
    );
  return result.json() as T;
}
export async function demoLogin(
  app: FastifyInstance,
  c: Config,
  email: string,
  _ip = '127.0.0.2',
): Promise<Headers> {
  requireManualDatabase(c);
  const db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
  await db.connect();
  try {
    const password = 'Fixture-' + keyedHash(email, c.AUTH_PEPPER).slice(0, 24);
    await db.query(
      'INSERT INTO users(email,display_name,password_hash,password_version) VALUES($1,$2,$3,1) ON CONFLICT(email) DO NOTHING',
      [email, email.split('@')[0], await hashPassword(password, c.AUTH_PEPPER)],
    );
    const token = opaqueToken(),
      csrf = opaqueToken();
    // Trusted local fixture bootstrap. Existing user passwords are never read
    // or overwritten. Every subsequent command uses normal live role checks.
    const created = await db.query(
      "INSERT INTO sessions(user_id,token_hash,csrf_hash,expires_at,auth_method,credential_version) SELECT id,$2,$3,clock_timestamp()+interval '1 hour','password',password_version FROM users WHERE email=$1 AND status='active' RETURNING id",
      [email, tokenHash(token), tokenHash(csrf)],
    );
    if (!created.rowCount) throw new Error('Fixture actor is unavailable.');
    return {
      cookie: 'nq_session=' + token + '; nq_csrf=' + csrf,
      origin: c.PUBLIC_APP_ORIGIN,
      'x-csrf-token': csrf,
    };
  } finally {
    await db.end();
  }
}
type Plan = {
  merchantId: string;
  versionId: string;
  branchId: string;
  cashier: string;
  headers: Record<string, Headers>;
  complete?: boolean;
  report?: unknown;
};
const names = [
  'سارة حسن',
  'أحمد علي',
  'مريم محمد',
  'يوسف سمير',
  'نور خالد',
  'عمر محمود',
  'هنا إبراهيم',
  'كريم عادل',
  'دينا طارق',
  'زياد أحمد',
  'ملك شريف',
  'سيف عمرو',
];

export async function populateManualClients(c: Config, slug: string, directory: string) {
  requireManualDatabase(c);
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug))
    throw new Error('Provide the exact company enrollment slug.');
  const db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
  await db.connect();
  const { app } = await buildApp(c);
  await app.ready();
  try {
    const company = (
      await db.query(
        "SELECT id,name,timezone FROM merchants WHERE slug=$1 AND status IN ('active','trial')",
        [slug],
      )
    ).rows[0];
    if (!company)
      throw new Error(
        'Create and activate the company yourself before adding synthetic customers.',
      );
    const program = (
      await db.query(
        "SELECT p.id,v.id AS version_id,v.threshold,v.max_per_tx FROM programs p JOIN program_versions v ON v.id=p.current_version_id WHERE p.merchant_id=$1 AND p.status='active' AND v.starts_at<=now() AND (v.ends_at IS NULL OR v.ends_at>now()) ORDER BY p.created_at LIMIT 1",
        [company.id],
      )
    ).rows[0];
    if (!program) throw new Error('The company needs an active loyalty program.');
    const cashier = (
      await db.query(
        "SELECT s.email,s.max_qty,g.branch_id FROM staff_memberships s JOIN users u ON u.id=s.user_id JOIN staff_branch_grants g ON g.staff_id=s.id AND g.merchant_id=s.merchant_id JOIN branches b ON b.id=g.branch_id AND b.status='active' JOIN program_branches pb ON pb.branch_id=g.branch_id AND pb.program_version_id=$2 WHERE s.merchant_id=$1 AND s.role='cashier' AND s.status='active' AND u.status='active' ORDER BY s.id LIMIT 1",
        [company.id, program.version_id],
      )
    ).rows[0];
    if (!cashier)
      throw new Error(
        'First invite the cashier from the owner account and accept that invitation. No customers have been added.',
      );
    await mkdir(directory, { recursive: true });
    const file = resolve(directory, 'clients-' + company.id + '.json');
    const plan: Plan = existsSync(file)
      ? JSON.parse(await readFile(file, 'utf8'))
      : {
          merchantId: company.id,
          versionId: program.version_id,
          branchId: cashier.branch_id,
          cashier: cashier.email,
          headers: {},
        };
    if (plan.complete) return plan.report;
    if (
      plan.merchantId !== company.id ||
      plan.versionId !== program.version_id ||
      plan.branchId !== cashier.branch_id ||
      plan.cashier !== cashier.email
    )
      throw new Error(
        'The incomplete fixture configuration changed. Existing customer history was preserved; review before continuing.',
      );
    const save = () => writeFile(file, JSON.stringify(plan, null, 2), { mode: 0o600 });
    const login = async (email: string, n: number) => {
      let headers = plan.headers[email];
      if (headers) {
        const response = await app.inject({ url: '/api/v1/session', headers });
        if (response.statusCode !== 200) headers = undefined;
      }
      if (!headers) {
        headers = await demoLogin(app, c, email, '127.0.0.' + n);
        plan.headers[email] = headers;
        await save();
      }
      return headers;
    };
    const staff = await login(cashier.email, 2),
      rows: unknown[] = [];
    const max = Math.min(cashier.max_qty, program.max_per_tx);
    for (let i = 0; i < names.length; i++) {
      const email = `client-${i + 1}-${company.id.slice(0, 8)}@synthetic.nuqta.test`,
        customer = await login(email, i + 10),
        prefix = 'syn-' + company.id + '-' + (i + 1);
      const list = await demoCall<{ cards: { id: string; program_id: string }[] }>(
        app,
        '/me/memberships',
        customer,
      );
      let membership = list.cards.find((x) => x.program_id === program.id)?.id;
      if (!membership) {
        const terms = await demoCall<{ termsHash: string }>(
          app,
          '/public/programs/' + program.id + '/terms',
        );
        const enrolled = await demoCall<{ membershipId: string }>(
          app,
          '/me/memberships',
          customer,
          {
            merchantId: company.id,
            programId: program.id,
            programVersionId: program.version_id,
            alias: names[i] + ' (تجريبي)',
            branchId: cashier.branch_id,
            source: 'link',
            acceptedTerms: true,
            acceptedTermsHash: terms.termsHash,
          },
          prefix + '-enroll',
        );
        membership = enrolled.membershipId;
      }
      const token = async () =>
        (
          await demoCall<{ token: string }>(
            app,
            '/me/memberships/' + membership + '/presentation-tokens',
            customer,
            {},
            randomUUID(),
          )
        ).token;
      const total = i < 4 ? 0 : i < 8 ? Math.min(i - 3, program.threshold - 1) : program.threshold;
      const quantities: number[] = [];
      for (let left = total; left > 0; left -= Math.min(left, max))
        quantities.push(Math.min(left, max));
      const award = async (quantity: number, index: number) => {
        const key = prefix + '-award-' + index;
        const operation = await demoCall<{ status: string }>(
          app,
          '/operations/by-key?scope=' +
            encodeURIComponent('stamp.award:' + company.id) +
            '&key=' +
            key,
          staff,
        );
        if (operation.status === 'committed') return;
        await demoCall(
          app,
          '/merchants/' + company.id + '/stamp-awards',
          staff,
          {
            membershipId: membership,
            branchId: cashier.branch_id,
            quantity,
            presentationContext: await token(),
            purchaseReference: {
              namespace: 'manual',
              reference: 'SYN-' + company.id.slice(0, 8) + '-' + (i + 1) + '-' + index,
              businessDate: businessDate(company.timezone),
            },
          },
          key,
        );
      };
      for (const [index, qty] of quantities.entries()) await award(qty, index);
      if (i >= 10) {
        const rewards = await demoCall<{ rewards: { id: string; status: string }[] }>(
          app,
          '/me/memberships/' + membership + '/rewards',
          customer,
        );
        if (!rewards.rewards.some((r) => r.status === 'redeemed')) {
          const reward = rewards.rewards.find((r) => r.status === 'available');
          if (!reward)
            throw new Error(
              'The synthetic reward is no longer available. Existing history was left intact.',
            );
          const existing = (
            await db.query(
              "SELECT id FROM redemption_challenges WHERE reward_id=$1 AND status IN ('awaiting_holder','confirmed') AND expires_at>clock_timestamp()",
              [reward.id],
            )
          ).rows[0];
          const ch = existing
            ? (
                await demoCall<{ challenge: { id: string; code: string; status: string } }>(
                  app,
                  '/merchants/' + company.id + '/redemption-challenges/' + existing.id,
                  staff,
                )
              ).challenge
            : null;
          const fresh = ch
            ? null
            : await demoCall<{ challengeId: string; code: string }>(
                app,
                '/merchants/' + company.id + '/rewards/' + reward.id + '/redemption-challenges',
                staff,
                { branchId: cashier.branch_id, presentationContext: await token() },
                randomUUID(),
              );
          const id = ch?.id || fresh!.challengeId,
            code = ch?.code || fresh!.code;
          if (!ch || ch.status === 'awaiting_holder')
            await demoCall(
              app,
              '/me/redemption-challenges/' + id + '/decision',
              customer,
              { approve: true, code },
              prefix + '-holder-' + id,
            );
          await demoCall(
            app,
            '/merchants/' + company.id + '/redemption-challenges/' + id + '/complete',
            staff,
            {},
            prefix + '-redeem-' + id,
          );
        }
        if (i === 11) await award(1, quantities.length);
      }
      const cards = await demoCall<{
          cards: { id: string; balance: number; cycle_number: number; pending_rewards: number }[];
        }>(app, '/me/memberships', customer),
        card = cards.cards.find((x) => x.id === membership)!;
      rows.push({
        name: names[i] + ' (تجريبي)',
        email,
        category:
          i < 4
            ? 'registered_only'
            : i < 8
              ? 'collecting'
              : i < 10
                ? 'reward_ready'
                : i === 10
                  ? 'redeemed'
                  : 'returned_after_redemption',
        balance: card.balance,
        cycle: card.cycle_number,
        availableRewards: card.pending_rewards,
      });
    }
    const drift = (
      await db.query(
        'SELECT count(*)::int AS n FROM loyalty_accounts a WHERE a.merchant_id=$1 AND a.balance<>(SELECT coalesce(sum(amount),0) FROM ledger_entries l WHERE l.membership_id=a.membership_id)',
        [company.id],
      )
    ).rows[0].n;
    if (drift !== 0)
      throw new Error('Balance reconciliation failed. No historical rows were modified.');
    const report = {
      company: company.name,
      slug,
      customersAdded: rows.length,
      balanceDrift: drift,
      customers: rows,
      note: 'Synthetic local customers; all purchases, rewards and holder-confirmed redemptions use real application commands. No external messages or payments.',
    };
    plan.complete = true;
    plan.report = report;
    await save();
    await writeFile(
      resolve(directory, 'report-' + company.id + '.json'),
      JSON.stringify(report, null, 2),
    );
    return report;
  } finally {
    await app.close();
    await db.end();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const c = await loadManualConfig();
    process.chdir(manualRoot);
    const result = await populateManualClients(
      c,
      process.argv[2] || '',
      resolve(manualRoot, 'fixtures'),
    );
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : 'Synthetic customer setup failed.');
    process.exitCode = 1;
  }
}
