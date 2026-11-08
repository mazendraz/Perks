import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { mailTemplate } from '../../apps/api/src/mail/templates.js';
import { FileSinkMailer } from '../../apps/api/src/mail/mailer.js';
import { readConfig } from '../../apps/api/src/config.js';

test('Arabic/English invitation, recovery and change confirmation match reviewed HTML/text snapshots without subject tokens', async () => {
  const expected = JSON.parse(await readFile('tests/fixtures/mail-templates.json', 'utf8'));
  const actual: Record<string, unknown> = {};
  for (const locale of ['ar', 'en'] as const)
    for (const kind of ['invitation', 'password_reset', 'password_changed'] as const) {
      const value = mailTemplate(kind, locale, {
        link:
          'https://nuqta.example.test/' +
          (kind === 'password_changed'
            ? 'login'
            : (kind === 'invitation' ? 'invite' : 'reset-password') + '/fixture-token'),
        business: 'Ghazal Cafe',
      });
      actual[locale + ':' + kind] = value;
      assert.ok(!value.subject.includes('fixture-token'));
      assert.ok(value.text.includes('https://nuqta.example.test/'));
      assert.ok(value.html.includes('dir="' + (locale === 'ar' ? 'rtl' : 'ltr') + '"'));
    }
  assert.deepEqual(actual, expected);
  const escaped = mailTemplate('invitation', 'en', {
    business: '<img src=x onerror=alert(1)>',
    link: 'https://nuqta.example.test/invite/fixture-token',
  });
  assert.ok(!escaped.html.includes('<img'));
  assert.ok(escaped.html.includes('&lt;img'));
  assert.throws(() => mailTemplate('password_reset', 'en', { link: 'javascript:alert(1)' }));
});
test('the local mail sink writes a complete file once under concurrency and forbids deployed environments and conflicting intents', async () => {
  await mkdir('.local', { recursive: true });
  const root = await mkdtemp(resolve('.local', 'file-mail-test-'));
  try {
    const c = readConfig({ APP_ENV: 'test', MAIL_TRANSPORT: 'file', MAIL_FILE_ROOT: root });
    const mailer = new FileSinkMailer(c),
      id = randomUUID();
    const message = {
      ...mailTemplate('password_reset', 'en', {
        link: 'http://localhost/reset-password/fixture-token',
      }),
      to: 'synthetic@nuqta.test',
      idempotencyKey: id,
    };
    await Promise.all([mailer.send(message), mailer.send(message)]);
    assert.deepEqual(await readdir(root), [id + '.json']);
    const stored = JSON.parse(await readFile(resolve(root, id + '.json'), 'utf8'));
    assert.equal(stored.text, message.text);
    await assert.rejects(
      mailer.send({ ...message, to: 'different@nuqta.test' }),
      /MAIL_INTENT_CONFLICT/,
    );
    await assert.rejects(
      mailer.send({ ...message, idempotencyKey: '../invalid' }),
      /MAIL_INTENT_CONFLICT/,
    );
    assert.throws(() => new FileSinkMailer({ ...c, APP_ENV: 'production' }), /forbidden/);
  } finally {
    assert.ok(resolve(root).startsWith(resolve('.local') + sep));
    await rm(root, { recursive: true, force: true });
  }
});
