import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, utimes, access, unlink, rmdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { readConfig } from '../../apps/api/src/config.js';
import { seed, ids } from '../../db/seed.js';
import { cleanupExports } from '../../apps/worker/src/export-cleanup.js';

test('retention removes only aged expired/revoked/orphan artifacts; ready files, recent writes and live leases survive', async () => {
  const c = readConfig(),
    db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
    worker = new pg.Pool({ connectionString: c.WORKER_DATABASE_URL });
  await db.connect();
  const root = await mkdtemp(resolve('.local/cleanup-test-'));
  const paths: string[] = [],
    dirs: string[] = [];
  try {
    await seed(db);
    for (const mid of [ids.merchantA, ids.merchantB]) {
      const path = resolve(root, mid);
      await mkdir(path);
      dirs.push(path);
    }
    const make = async (mid: string, status: string | null, expired: boolean, old = true) => {
      const id = randomUUID(),
        lease = randomUUID(),
        key = mid + '/' + id + '-' + lease + '.csv',
        path = resolve(root, key);
      await writeFile(path, 'synthetic fixture');
      paths.push(path);
      if (old) await utimes(path, new Date(0), new Date(Date.now() - 3 * 3600000));
      if (status)
        await db.query(
          "INSERT INTO customer_exports(id,merchant_id,requested_by,segment,status,storage_key,expires_at) VALUES($1,$2,$3,'all',$4,$5,clock_timestamp()+$6*interval '1 hour')",
          [id, mid, mid === ids.merchantA ? ids.ownerA : ids.ownerB, status, key, expired ? -1 : 1],
        );
      return { id, lease, key, path, mid };
    };
    const expired = await make(ids.merchantA, 'ready', true),
      revoked = await make(ids.merchantA, 'revoked', false),
      orphan = await make(ids.merchantA, null, false),
      fresh = await make(ids.merchantA, null, false, false),
      ready = await make(ids.merchantB, 'ready', false),
      active = await make(ids.merchantA, null, false);
    const outbox = (
      await db.query(
        "INSERT INTO outbox_events(merchant_id,event_type,aggregate_id,payload,dedupe_key) VALUES($1,'customer.export.requested',$2,$3,$4) RETURNING id",
        [active.mid, active.id, { exportId: active.id }, randomUUID()],
      )
    ).rows[0].id;
    const job = (
      await db.query(
        "INSERT INTO background_jobs(merchant_id,outbox_id,kind,status,lease_id,lease_until) VALUES($1,$2,'customer_export','running',$3,clock_timestamp()+interval '10 minutes') RETURNING id",
        [active.mid, outbox, active.lease],
      )
    ).rows[0].id;
    const result = await cleanupExports(worker, root);
    assert.equal(result.removed, 3);
    for (const ex of [expired, revoked, orphan]) await assert.rejects(access(ex.path));
    for (const ex of [fresh, ready, active]) await access(ex.path);
    await db.query(
      "UPDATE background_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [job],
    );
    assert.equal((await cleanupExports(worker, root)).removed, 1);
    await access(ready.path);
    // Publication and cleanup acquire the same lock; a file becoming ready while
    // cleanup waits is rechecked after lock acquisition and remains intact.
    const racing = await make(ids.merchantA, null, false);
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'export-file:' + racing.key,
    ]);
    const sweep = cleanupExports(worker, root);
    await db.query(
      "INSERT INTO customer_exports(id,merchant_id,requested_by,segment,status,storage_key) VALUES($1,$2,$3,'all','ready',$4)",
      [racing.id, racing.mid, ids.ownerA, racing.key],
    );
    await db.query('COMMIT');
    await sweep;
    await access(racing.path);
    assert.equal(
      (await worker.query('SELECT export_artifact_deletable($1) AS allowed', ['../outside.csv']))
        .rows[0].allowed,
      false,
    );
  } finally {
    for (const path of paths)
      await unlink(path).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e;
      });
    for (const dir of dirs) await rmdir(dir);
    await rmdir(root);
    await worker.end();
    await db.end();
  }
});
