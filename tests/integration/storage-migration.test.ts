import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import sharp from 'sharp';
import pg from 'pg';
import { readConfig } from '../../apps/api/src/config.js';
import { tokenHash } from '../../apps/api/src/crypto.js';
import { LocalDiskStore } from '../../apps/api/src/storage/file-store.js';
import { migrateLocalStorage } from '../../tools/migrate-local-storage.js';
test('legacy assets/drafts and CSV links migrate byte-for-byte, retry safely and preserve an existing conflicting file', async () => {
  const c = readConfig(),
    db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
  await db.connect();
  await mkdir('.local', { recursive: true });
  const root = await mkdtemp(resolve('.local', 'legacy-store-test-')),
    target = resolve(root, 'new-store'),
    legacy = resolve(root, 'old-store'),
    files = new LocalDiskStore(target);
  try {
    const user = (
      await db.query(
        "INSERT INTO users(email,display_name) VALUES($1,'Migration fixture') RETURNING id",
        ['migration-' + randomUUID() + '@nuqta.test'],
      )
    ).rows[0].id;
    const merchant = (
      await db.query(
        "INSERT INTO merchants(name,slug) VALUES('Migration fixture',$1) RETURNING id",
        ['migration-' + randomUUID()],
      )
    ).rows[0].id;
    const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#204c41' } })
        .png()
        .toBuffer(),
      asset = randomUUID(),
      draftAsset = randomUUID();
    await db.query(
      "INSERT INTO assets(id,merchant_id,storage_key,mime,bytes,width,height,sha256,created_by) VALUES($1,$2,$3,'image/png',$4,4,4,$5,$6)",
      [
        asset,
        merchant,
        merchant + '/' + asset + '.png',
        png.length,
        tokenHash(png.toString('base64')),
        user,
      ],
    );
    const assetPath = resolve(legacy, 'assets', merchant, asset + '.png');
    await mkdir(resolve(legacy, 'assets', merchant), { recursive: true });
    await writeFile(assetPath, png);
    const draft = (
      await db.query(
        'INSERT INTO provisioning_drafts(created_by,data) VALUES($1,$2) RETURNING id',
        [user, {}],
      )
    ).rows[0].id;
    await db.query(
      'INSERT INTO provisioning_logos(id,draft_id,created_by,bytes,width,height,sha256) VALUES($1,$2,$3,$4,4,4,$5)',
      [draftAsset, draft, user, png.length, tokenHash(png.toString('base64'))],
    );
    await mkdir(resolve(legacy, 'draft-assets', user, draft), { recursive: true });
    await writeFile(resolve(legacy, 'draft-assets', user, draft, draftAsset + '.png'), png);
    const lease = randomUUID(),
      id = randomUUID(),
      oldKey = merchant + '/' + id + '-' + lease + '.csv',
      newKey = merchant + '/' + lease + '.csv',
      csv = Buffer.from('id,alias\nfixture,Synthetic');
    await mkdir(resolve(legacy, 'exports', merchant), { recursive: true });
    await writeFile(resolve(legacy, 'exports', oldKey), csv);
    await db.query(
      "INSERT INTO customer_exports(id,merchant_id,requested_by,segment,status,storage_key) VALUES($1,$2,$3,'all','ready',$4)",
      [id, merchant, user, oldKey],
    );
    const expectedMissing = (
      await db.query(
        'SELECT (SELECT count(*) FROM assets)+(SELECT count(*) FROM provisioning_logos)-2 AS n',
      )
    ).rows[0].n;
    const cfg = readConfig({ STORAGE_ROOT: target });
    const result = await migrateLocalStorage(cfg, legacy);
    assert.equal(result.assetsCopied, 1);
    assert.equal(result.draftLogosCopied, 1);
    assert.equal(result.exportsConverted, 1);
    assert.equal(result.missingFiles, Number(expectedMissing));
    assert.ok((await files.get(merchant + '/' + asset + '.png')).equals(png));
    assert.ok((await files.get(draft + '/' + draftAsset + '.png')).equals(png));
    assert.ok((await files.get('exports/' + newKey)).equals(csv));
    await assert.rejects(access(resolve(legacy, 'exports', oldKey)));
    assert.equal(
      (await db.query('SELECT storage_key FROM customer_exports WHERE id=$1', [id])).rows[0]
        .storage_key,
      newKey,
    );
    assert.equal((await migrateLocalStorage(cfg, legacy)).exportsConverted, 0);
    const conflictId = randomUUID(),
      conflictLease = randomUUID(),
      conflictOld = merchant + '/' + conflictId + '-' + conflictLease + '.csv',
      conflictNew = 'exports/' + merchant + '/' + conflictLease + '.csv';
    await writeFile(resolve(legacy, 'exports', conflictOld), csv);
    await files.put(conflictNew, Buffer.from('existing differing bytes'), {
      contentType: 'text/csv',
    });
    await db.query(
      "INSERT INTO customer_exports(id,merchant_id,requested_by,segment,status,storage_key) VALUES($1,$2,$3,'all','ready',$4)",
      [conflictId, merchant, user, conflictOld],
    );
    await assert.rejects(migrateLocalStorage(cfg, legacy), /Export bytes differ/);
    assert.ok((await readFile(resolve(legacy, 'exports', conflictOld))).equals(csv));
    assert.equal((await files.get(conflictNew)).toString(), 'existing differing bytes');
    assert.equal(
      (await db.query('SELECT storage_key FROM customer_exports WHERE id=$1', [conflictId])).rows[0]
        .storage_key,
      conflictOld,
    );
  } finally {
    await db.end();
    assert.ok(resolve(root).startsWith(resolve('.local') + sep));
    await rm(root, { recursive: true, force: true });
  }
});
