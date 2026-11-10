import { hashPassword } from '../apps/api/src/passwords.js';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import pg from 'pg';
import { readConfig } from '../apps/api/src/config.js';
export const ids = {
  admin: '00000000-0000-4000-8000-000000000001',
  ownerA: '00000000-0000-4000-8000-000000000002',
  ownerB: '00000000-0000-4000-8000-000000000003',
  cashier: '00000000-0000-4000-8000-000000000004',
  customer: '00000000-0000-4000-8000-000000000005',
  merchantA: '10000000-0000-4000-8000-000000000001',
  merchantB: '10000000-0000-4000-8000-000000000002',
  branchA: '20000000-0000-4000-8000-000000000001',
  branchA2: '20000000-0000-4000-8000-000000000002',
  branchB: '20000000-0000-4000-8000-000000000003',
  staffA: '30000000-0000-4000-8000-000000000001',
  staffB: '30000000-0000-4000-8000-000000000002',
  staffCashier: '30000000-0000-4000-8000-000000000003',
};
export async function seed(client: pg.Client) {
  const users = [
    [ids.admin, 'admin@nuqta.test', 'هالة منصور', 'platform_admin'],
    [ids.ownerA, 'owner@bunn.test', 'كريم عزت', 'customer'],
    [ids.ownerB, 'owner@lamsa.test', 'نادية فوزي', 'customer'],
    [ids.cashier, 'cashier@bunn.test', 'يوسف طه', 'customer'],
    [ids.customer, 'sara@example.test', 'سارة محمود', 'customer'],
  ];
  for (const [id, email, name, role] of users)
    await client.query(
      'INSERT INTO users(id,email,display_name,global_role) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [id, email, name, role],
    );
  await client.query(
    "INSERT INTO merchants(id,slug,name,primary_color,accent_color,surface_color,terms,contact_email) VALUES($1,'bunn','بن وحكاية','#6F3F22','#E2A85B','#FBF5EE','ختم لكل مشروب. المكافأة صالحة 30 يوم.','owner@bunn.test'),($2,'lamsa','صالون لمسة','#5E2750','#E7A9C8','#FBF4F8','برنامج زيارات لمسة.','owner@lamsa.test') ON CONFLICT DO NOTHING",
    [ids.merchantA, ids.merchantB],
  );
  for (const [id, mid, name] of [
    [ids.branchA, ids.merchantA, 'الزمالك'],
    [ids.branchA2, ids.merchantA, 'المعادي'],
    [ids.branchB, ids.merchantB, 'مصر الجديدة'],
  ])
    await client.query(
      'INSERT INTO branches(id,merchant_id,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [id, mid, name],
    );
  for (const [id, mid, uid, email, name, role] of [
    [ids.staffA, ids.merchantA, ids.ownerA, 'owner@bunn.test', 'كريم عزت', 'owner'],
    [ids.staffB, ids.merchantB, ids.ownerB, 'owner@lamsa.test', 'نادية فوزي', 'owner'],
    [ids.staffCashier, ids.merchantA, ids.cashier, 'cashier@bunn.test', 'يوسف طه', 'cashier'],
  ])
    await client.query(
      'INSERT INTO staff_memberships(id,merchant_id,user_id,email,name,role) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
      [id, mid, uid, email, name, role],
    );
  for (const [mid, sid, bid] of [
    [ids.merchantA, ids.staffA, ids.branchA],
    [ids.merchantA, ids.staffA, ids.branchA2],
    [ids.merchantB, ids.staffB, ids.branchB],
    [ids.merchantA, ids.staffCashier, ids.branchA],
  ])
    await client.query(
      'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [mid, sid, bid],
    );
  const secret = randomBytes(20).toString('hex');
  await client.query('UPDATE users SET totp_secret=coalesce(totp_secret,$1) WHERE id=$2', [
    secret,
    ids.admin,
  ]);
  if ((await client.query("SELECT to_regclass('feature_entitlements') AS t")).rows[0].t) {
    for (const mid of [ids.merchantA, ids.merchantB])
      await client.query(
        "INSERT INTO feature_entitlements(merchant_id,plan,max_branches,max_staff,max_programs,max_customers) VALUES($1,'growth',3,10,3,3000) ON CONFLICT DO NOTHING",
        [mid],
      );
    for (const [pid, vid, mid, name, reward, threshold] of [
      [
        '40000000-0000-4000-8000-000000000001',
        '50000000-0000-4000-8000-000000000001',
        ids.merchantA,
        'قهوتك السادسة علينا',
        'أي مشروب ساخن مجانًا',
        5,
      ],
      [
        '40000000-0000-4000-8000-000000000002',
        '50000000-0000-4000-8000-000000000002',
        ids.merchantB,
        'زيارات لمسة',
        'سشوار مجاني',
        6,
      ],
    ]) {
      await client.query(
        'INSERT INTO programs(id,merchant_id,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [pid, mid, name],
      );
      const createdVersion = await client.query(
        'INSERT INTO program_versions(id,merchant_id,program_id,version,threshold,max_per_tx,reward_title,reward_terms,validity_days) VALUES($1,$2,$3,1,$4,3,$5,$6,30) ON CONFLICT DO NOTHING',
        [vid, mid, pid, threshold, reward, 'المكافأة صالحة 30 يوم. لازم تأكيد حامل الكارت.'],
      );
      if (createdVersion.rowCount)
        await client.query(
          'INSERT INTO program_branches(merchant_id,program_version_id,branch_id) SELECT merchant_id,$1,id FROM branches WHERE merchant_id=$2 ON CONFLICT DO NOTHING',
          [vid, mid],
        );
      await client.query(
        'UPDATE programs SET current_version_id=coalesce(current_version_id,$1) WHERE id=$2',
        [vid, pid],
      );
    }
  }
  return {
    adminEmail: 'admin@nuqta.test',
    totpSecretHex: (await client.query('SELECT totp_secret FROM users WHERE id=$1', [ids.admin]))
      .rows[0].totp_secret,
  };
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/db/seed.ts')) {
  const c = readConfig();
  if (!['development', 'test'].includes(c.APP_ENV) || !c.DATABASE_MIGRATOR_URL)
    throw new Error('Synthetic seeding is only available locally or in tests.');
  const url = new URL(c.DATABASE_MIGRATOR_URL);
  if (
    url.pathname !== '/nuqta_local' &&
    !(c.APP_ENV === 'test' && /^\/nuqta_test_\d+$/.test(url.pathname))
  )
    throw new Error('Seed requires a dedicated Nuqta database.');
  const db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
  try {
    await db.connect();
    await db.query('BEGIN');
    const bootstrap = await seed(db);
    const credentials: string[] = [];
    if (c.APP_ENV === 'development')
      for (const id of [ids.admin, ids.ownerA, ids.ownerB, ids.cashier, ids.customer]) {
        const u = (await db.query('SELECT email,password_hash FROM users WHERE id=$1', [id]))
          .rows[0];
        if (!u.password_hash) {
          const password = 'Nuqta-' + randomBytes(12).toString('base64url') + '!';
          await db.query(
            'UPDATE users SET password_hash=$1,password_version=password_version+1 WHERE id=$2',
            [await hashPassword(password, c.AUTH_PEPPER), id],
          );
          await db.query(
            'UPDATE sessions SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL',
            [id],
          );
          credentials.push('Email: ' + u.email + '\nPassword: ' + password + '\n');
        }
      }
    await db.query('COMMIT');
    await mkdir('.local', { recursive: true });
    if (credentials.length) {
      const previous = await readFile('.local/seed-logins.txt', 'utf8').catch(() => '');
      await writeFile('.local/seed-logins.txt', previous + credentials.join('\n') + '\n', {
        mode: 0o600,
      });
    }
    await writeFile('.local/admin-mfa.json', JSON.stringify(bootstrap, null, 2), { mode: 0o600 });
    console.log(
      'Synthetic local users and two tenants are ready. Local email/password credentials saved privately in .local/seed-logins.txt; values not printed.',
    );
  } finally {
    await db.end();
  }
}
