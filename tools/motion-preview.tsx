// Local visual-test entry only; production's web entry never imports this file.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LoyaltyCard } from '../packages/ui/src/LoyaltyCard.js';
import type { CardData } from '../packages/contracts/src/index.js';
import '../apps/web/src/styles.css';
import '../apps/web/src/features.css';
import '../apps/web/src/design.css';
import '../apps/web/src/mobile.css';
const marks = Array.from({ length: 50 }, (_, i) => ({
  ledgerId: '00000000-0000-4000-8000-' + String(Math.floor(i / 3) + 1).padStart(12, '0'),
  ordinal: (i % 3) + 1,
}));
const initial: CardData = {
  id: '00000000-0000-4000-8000-000000000001',
  merchant_id: '00000000-0000-4000-8000-000000000002',
  merchant_name: 'كافيه غزال',
  alias: 'ياسمين. م',
  program_name: 'كارت القهوة',
  threshold: 8,
  balance: 2,
  display_balance: 2,
  primary_color: '#1f3b2d',
  accent_color: '#c8893b',
  surface_color: '#f6efe4',
  template: 'classic',
  stamp_shape: 'circle',
  stamp_icon: 'coffee',
  stamp_style: 'solid',
  reward_title: 'قهوة مجانًا',
  revision: 1,
  cycle_number: 1,
  pending_rewards: 0,
  stamp_ink: marks.slice(0, 2),
};
function Preview() {
  const [card, setCard] = useState(initial),
    [waiting, setWaiting] = useState(false),
    [instance, setInstance] = useState(0);
  const reset = (balance: number) => {
    setInstance((value) => value + 1);
    setWaiting(false);
    setCard((current) => ({
      ...initial,
      revision: current.revision + 1,
      balance,
      display_balance: balance,
      stamp_ink: marks.slice(0, balance),
    }));
  };
  const stamp = (count: number) => {
    setWaiting(false);
    setCard((current) => {
      const end = Math.min(8, (current.display_balance ?? current.balance) + count);
      return {
        ...current,
        revision: current.revision + 1,
        balance: end === 8 ? 0 : end,
        display_balance: end,
        pending_rewards: end === 8 ? 1 : 0,
        stamp_ink: marks.slice(0, end),
      };
    });
  };
  (
    window as unknown as {
      nuqtaMotionFixture: {
        reset: (n: number) => void;
        stamp: (n: number) => void;
        waiting: () => void;
        shape: (shape: CardData['stamp_shape']) => void;
      };
    }
  ).nuqtaMotionFixture = {
    reset,
    stamp,
    waiting: () => setWaiting(true),
    shape: (shape) => setCard((current) => ({ ...current, stamp_shape: shape })),
  };
  return (
    <main style={{ maxWidth: 420, margin: '24px auto', padding: 16 }}>
      <LoyaltyCard key={instance} card={card} waiting={waiting} experience lang="ar" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 20 }}>
        <button onClick={() => reset(2)}>Reset two</button>
        <button onClick={() => stamp(1)}>One stamp</button>
        <button onClick={() => stamp(3)}>Three stamps</button>
        <button onClick={() => setWaiting(true)}>Waiting</button>
        <button onClick={() => reset(7)}>Before reward</button>
      </div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Preview />);
