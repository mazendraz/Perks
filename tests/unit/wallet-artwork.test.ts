import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { stripSvg } from '../../apps/api/src/wallet/pass-artwork.js';
import type { WalletCard } from '../../apps/api/src/wallet/apple-pass.js';

const card: WalletCard = {
  id: '00000000-0000-4000-8000-000000000001',
  merchant_id: '00000000-0000-4000-8000-000000000002',
  merchant_name: 'كافيه تجريبي',
  customer_name: 'اسم خاص لا يظهر في الرسم',
  program_name: 'قهوة',
  threshold: 5,
  display_balance: 2,
  pending_rewards: 0,
  primary_color: '#204E43',
  accent_color: '#D4B56A',
  stamp_shape: 'circle',
  stamp_icon: 'coffee',
  stamp_style: 'solid',
  reward_title: 'قهوة مجانًا',
  reward_terms: 'تجربة',
  active: true,
  earning_active: true,
};

test('native Wallet strip has the correct aspect ratio and keeps every real stamp inside its safe area', async () => {
  for (const threshold of [2, 5, 6, 8, 12, 20, 50])
    for (const stamp_shape of ['circle', 'hexagon', 'seal', 'rounded', 'square'] as const)
      for (const stamp_style of ['solid', 'outline'] as const) {
        const svg = stripSvg(
          { ...card, threshold, display_balance: threshold, stamp_shape, stamp_style },
          1,
        );
        assert.equal((svg.match(/data-slot=/g) || []).length, threshold);
        assert.equal((svg.match(/data-filled="true"/g) || []).length, threshold);
        assert.ok(!svg.includes(card.customer_name!));
        const defs = svg.match(/<defs>[\s\S]*?<\/defs>/)?.[0] ?? '';
        const slots = svg.slice(svg.indexOf('<g data-slot='), svg.lastIndexOf('</svg>'));
        const raster = await sharp(
          Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="375" height="144">${defs}${slots}</svg>`,
          ),
        )
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        for (let y = 0; y < 144; y++)
          for (let x = 0; x < 375; x++)
            if (raster.data[(y * 375 + x) * 4 + 3]! > 8) {
              assert.ok(
                x >= 24 && x < 351 && y >= 8 && y < 136,
                `${threshold} ${stamp_shape} ${stamp_style}: stamp pixel outside safe area at ${x},${y}`,
              );
            }
      }
  for (const scale of [1, 2, 3]) {
    const meta = await sharp(Buffer.from(stripSvg(card, scale))).metadata();
    assert.deepEqual([meta.width, meta.height], [375 * scale, 144 * scale]);
  }
});

test('Wallet artwork is stable, reflects committed progress and contains no customer text or external images', () => {
  const first = stripSvg(card, 3);
  assert.equal(first, stripSvg(card, 3));
  assert.notEqual(first, stripSvg({ ...card, display_balance: 0 }, 3));
  assert.notEqual(first, stripSvg({ ...card, display_balance: 5, pending_rewards: 1 }, 3));
  assert.equal((first.match(/data-filled="true"/g) || []).length, 2);
  assert.ok(!/<text|<image|<script|foreignObject/.test(first));
});
