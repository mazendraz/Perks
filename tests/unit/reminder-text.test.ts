import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reminderDefaults,
  reminderSettingsInput,
  walletReminderText,
  withReminderDefaults,
} from '../../packages/contracts/src/customer-reminders.js';

const card = {
  customer_name: 'مريم',
  merchant_name: 'بن البلد',
  threshold: 8,
  display_balance: 6,
  pending_rewards: 0,
  reward_title: 'قهوة مجانًا',
};

test('the Wallet reminder tells each customer their own stamps left, or that the reward is waiting', () => {
  assert.equal(
    walletReminderText(reminderDefaults, card, 'ar'),
    'يا مريم، فاضلك ختمين وتاخد قهوة مجانًا من بن البلد 🎁 مستنيينك!',
  );
  assert.match(
    walletReminderText(reminderDefaults, { ...card, display_balance: 7 }, 'ar'),
    /ختم واحد/,
  );
  assert.match(
    walletReminderText(reminderDefaults, { ...card, display_balance: 3 }, 'ar'),
    /5 أختام/,
  );
  assert.match(
    walletReminderText(reminderDefaults, card, 'en'),
    /just 2 stamps to go for your قهوة/,
  );
  assert.match(
    walletReminderText(reminderDefaults, { ...card, display_balance: 8, pending_rewards: 1 }, 'ar'),
    /مكافأتك جاهزة: قهوة مجانًا/,
  );
  // Settings saved before the reward-ready message existed still send one.
  assert.match(
    walletReminderText({ wallet: reminderDefaults.wallet }, { ...card, pending_rewards: 1 }, 'ar'),
    /مكافأتك جاهزة/,
  );
});

test('owners choose the timing; old saved settings keep working', () => {
  const { maxReminders: _m, walletReady: _w, ...old } = { ...reminderDefaults, cooldownDays: 30 };
  const parsed = reminderSettingsInput.parse(old);
  assert.equal(parsed.maxReminders, 1, 'shops that saved before keep one reminder per absence');
  assert.deepEqual(parsed.walletReady, reminderDefaults.walletReady);
  assert.equal(
    withReminderDefaults(old).maxReminders,
    1,
    'dashboard shows what the scheduler does',
  );
  assert.equal(withReminderDefaults(null).maxReminders, 3);
  assert.throws(() => reminderSettingsInput.parse({ ...reminderDefaults, cooldownDays: 1 }));
  assert.throws(() => reminderSettingsInput.parse({ ...reminderDefaults, maxReminders: 6 }));
  assert.throws(() =>
    reminderSettingsInput.parse({
      ...reminderDefaults,
      whatsapp: { ...reminderDefaults.whatsapp, inactive: { ar: 'فاضلك {left}', en: 'x' } },
    }),
  );
});
