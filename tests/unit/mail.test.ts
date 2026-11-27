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
test('self-service onboarding mail welcomes, reports the review outcome and escapes reviewer text', () => {
  const link = 'https://nuqta.example.test/onboarding';
  const welcome = mailTemplate('merchant_welcome', 'ar', {
    link: 'https://nuqta.example.test/reset-password/fixture-token?welcome=1',
  });
  assert.equal(welcome.subject, 'أهلًا بيك! حسابك جاهز · Perks');
  assert.ok(welcome.text.startsWith('أهلًا بيك! حسابك جاهز\n\nفاضل خطوة واحدة'));
  assert.ok(!welcome.text.includes('لو طلبت تغيير الباسورد'));
  assert.ok(!welcome.subject.includes('fixture-token'));

  const confirmed = mailTemplate('onboarding_payment_confirmed', 'en', {
    link,
    business: 'Ghazal Cafe',
    live: true,
  });
  assert.ok(confirmed.text.includes('subscription transfer for Ghazal Cafe'));
  assert.ok(confirmed.text.includes('Open shop dashboard:'));
  // Confirmed before publishing: the owner is told to publish, not sent to a dashboard.
  const unpublished = mailTemplate('onboarding_payment_confirmed', 'ar', {
    link,
    business: 'كافيه غزال',
    live: false,
  });
  assert.ok(unpublished.text.includes('فاضل تنشر محلك'));
  assert.ok(unpublished.text.includes('انشر محلك: ' + link));

  const paused = mailTemplate('onboarding_payment_rejected', 'en', {
    link,
    business: 'Ghazal Cafe',
    reason: '<b>Amount</b> missing',
    suspended: true,
  });
  assert.ok(paused.text.includes('the shop is paused'));
  assert.ok(paused.text.includes('Reason: <b>Amount</b> missing'));
  assert.ok(paused.html.includes('Reason: &lt;b&gt;Amount&lt;/b&gt; missing'));
  assert.ok(!paused.html.includes('<b>Amount'));
  const pending = mailTemplate('onboarding_payment_rejected', 'ar', {
    link,
    business: 'كافيه غزال',
    reason: 'المبلغ ناقص',
  });
  assert.ok(pending.text.includes('عشان نكمّل تفعيل محلك'));
  assert.ok(!pending.text.includes('اتوقف'));

  const review = mailTemplate('onboarding_receipt_submitted', 'ar', {
    link: 'https://nuqta.example.test/platform/onboarding-payments',
    business: 'كافيه غزال',
  });
  assert.ok(review.text.includes('كافيه غزال رفع إيصال تحويل الاشتراك'));
});
