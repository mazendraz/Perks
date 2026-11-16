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

test('the stamps field announces each new stamp in both pass styles and both languages', () => {
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
  assert.equal(strings.ar.stamp_change, 'تم إضافة ختم %@');
  assert.equal(strings.en.stamp_change, 'Stamp added %@');
  // Apple requires the placeholder, or the notification is not shown.
  for (const lang of ['ar', 'en'] as const) assert.ok(strings[lang].stamp_change.includes('%@'));
});
