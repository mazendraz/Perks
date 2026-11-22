import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  passJson,
  texts,
  type AppleWalletSigner,
  type WalletCard,
} from '../../apps/api/src/wallet/apple-pass.js';

const card: WalletCard = {
  id: '00000000-0000-4000-8000-000000000001',
  merchant_id: '00000000-0000-4000-8000-000000000002',
  merchant_name: 'Test Café',
  program_name: 'Coffee',
  threshold: 5,
  display_balance: 2,
  pending_rewards: 0,
  primary_color: '#1f4e79',
  accent_color: '#f2a900',
  stamp_shape: 'circle',
  stamp_icon: 'check',
  stamp_style: 'solid',
  reward_title: 'Free coffee',
  reward_terms: '',
  active: true,
  earning_active: true,
};
// passJson only reads the identifiers; the keys are used when signing.
const signer = {
  passTypeIdentifier: 'pass.test.perks',
  teamIdentifier: 'TEAM123456',
} as AppleWalletSigner;

test('the stamps field announces every stamp change, added or taken back, in neutral words', () => {
  const pass = passJson(card, {
    serial: card.id,
    authToken: 'x'.repeat(32),
    origin: 'https://perks.test',
    signer,
  }) as unknown as Record<
    'posterGeneric' | 'storeCard',
    { headerFields: { key: string; value: string; changeMessage?: string }[] }
  >;
  for (const style of ['posterGeneric', 'storeCard'] as const) {
    const stamps = pass[style].headerFields.find((f) => f.key === 'stamps');
    assert.ok(stamps, style + ' has a stamps field');
    assert.equal(stamps.value, '2/5');
    assert.equal(stamps.changeMessage, 'stamp_change', style + ' stamps changeMessage');
  }
  const strings = texts(card);
  assert.equal(strings.ar.stamp_change, 'الأختام: %@');
  assert.equal(strings.en.stamp_change, 'Stamps: %@');
  // Apple requires the placeholder, or the notification is not shown.
  for (const lang of ['ar', 'en'] as const) assert.ok(strings[lang].stamp_change.includes('%@'));
});

type Field = { key: string; value: string; changeMessage?: string };
const backOf = (c: WalletCard) =>
  passJson(c, {
    serial: c.id,
    authToken: 'x'.repeat(32),
    origin: 'https://perks.test',
    signer,
  }) as unknown as Record<'posterGeneric' | 'storeCard', { backFields: Field[] }>;
const reminderValue = (c: WalletCard) =>
  backOf(c).storeCard.backFields.find((f) => f.key === 'reminder')!.value;

test('the iOS 27 poster carries the message and status fields, so it announces them too', () => {
  const pass = backOf({
    ...card,
    manual_message: { id: '00000000-0000-4000-8000-0000000000aa', ar: 'أهلاً', en: 'Hi' },
  });
  for (const style of ['posterGeneric', 'storeCard'] as const) {
    const reminder = pass[style].backFields.find((f) => f.key === 'reminder');
    assert.ok(reminder, style + ' has the message field');
    assert.equal(reminder.changeMessage, '%@');
    assert.match(reminder.value, /^reminder_[0-9a-f]{24}$/);
    assert.equal(
      pass[style].backFields.find((f) => f.key === 'status')?.changeMessage,
      'status_change',
    );
  }
  assert.deepEqual(pass.posterGeneric.backFields, pass.storeCard.backFields);
});

test('repeated words still change the message field; first-time words keep their old value', () => {
  const message = { id: '00000000-0000-4000-8000-0000000000aa', ar: 'أهلاً', en: 'Hi' };
  const first = reminderValue({ ...card, manual_message: message });
  // Unchanged formula for a first-time message: passes already on phones are not re-announced.
  assert.equal(
    reminderValue({
      ...card,
      manual_message: { ...message, id: '00000000-0000-4000-8000-0000000000bb' },
    }),
    first,
  );
  const again = reminderValue({
    ...card,
    manual_message: { ...message, id: '00000000-0000-4000-8000-0000000000bb', repeat: true },
  });
  assert.notEqual(again, first);
  const templates = { wallet: { ar: 'فاضلك {left}', en: '{left} to go' } };
  const step1 = reminderValue({ ...card, reminder_templates: templates });
  assert.equal(reminderValue({ ...card, reminder_templates: { ...templates, step: 1 } }), step1);
  const step2 = reminderValue({ ...card, reminder_templates: { ...templates, step: 2 } });
  const step3 = reminderValue({ ...card, reminder_templates: { ...templates, step: 3 } });
  assert.notEqual(step2, step1);
  assert.notEqual(step3, step2);
});
