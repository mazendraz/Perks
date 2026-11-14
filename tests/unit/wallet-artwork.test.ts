import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { stripSvg } from '../../apps/api/src/wallet/pass-artwork.js';
import type { WalletCard } from '../../apps/api/src/wallet/apple-pass.js';
import { walletTheme } from '../../packages/domain/src/wallet-theme.js';
import { cardTemplates } from '../../packages/contracts/src/branding.js';

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

test('Wallet follows the shop card edition: paper editions, Noir and the edition artwork', () => {
  const paper = walletTheme({ ...card, template: 'minimal', surface_color: '#F6F1E7' });
  assert.equal(paper.background, '#f6f1e7');
  assert.equal(paper.ink, '#132a26');
  assert.equal(paper.stamp, '#d4b56a');
  // An accent that would vanish on the paper hands the stamps to the brand colour.
  assert.equal(
    walletTheme({ ...card, template: 'minimal', surface_color: '#f6f1e7', accent_color: '#efe6d2' })
      .stamp,
    '#204e43',
  );
  const noir = walletTheme({ ...card, template: 'noir' });
  assert.equal(noir.background, '#171c1b');
  assert.equal(walletTheme({ ...card, template: 'classic' }).background, '#204e43');
  assert.equal(walletTheme({ ...card, template: undefined }).background, '#204e43');
  const strips = cardTemplates.map((template) => stripSvg({ ...card, template }, 1));
  assert.ok(strips.every((svg) => !/<text|<image|<script|foreignObject/.test(svg)));
  assert.ok(new Set(strips).size >= 12, 'editions draw visibly different strips');
  assert.ok(
    stripSvg({ ...card, template: 'minimal', surface_color: '#f6f1e7' }, 1).includes('#f6f1e7'),
  );
});

test('Poster artwork (iOS 27) is 358×448 and keeps the stamps between the header and the reward fields', async () => {
  const { posterArtworkSvg, POSTER } = await import('../../apps/api/src/wallet/pass-artwork.js');
  for (const threshold of [2, 5, 8, 10, 12, 20, 50])
    for (const rtl of [false, true]) {
      const svg = posterArtworkSvg(
        { ...card, threshold, display_balance: Math.floor(threshold / 2) },
        1,
        rtl,
      );
      assert.equal((svg.match(/data-slot=/g) || []).length, threshold);
      assert.ok(!/<text|<image|<script|foreignObject/.test(svg));
      const slots = svg.slice(svg.indexOf('<g data-slot='), svg.lastIndexOf('<rect'));
      const raster = await sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="358" height="448">${slots}</svg>`,
        ),
      )
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let y = 0; y < 448; y++)
        for (let x = 0; x < 358; x++)
          if (raster.data[(y * 358 + x) * 4 + 3]! > 8)
            assert.ok(
              x >= 20 && x < 338 && y >= POSTER.top && y < POSTER.bottom,
              `${threshold} stamps: pixel outside the poster band at ${x},${y}`,
            );
    }
  const meta = await sharp(Buffer.from(posterArtworkSvg(card, 3))).metadata();
  assert.deepEqual([meta.width, meta.height], [1074, 1344]);
});
