import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  appleStripSvg,
  artworkSignature,
  posterArtworkSvg,
} from '../../apps/api/src/wallet/pass-artwork.js';
import { walletDesignSignature } from '../../apps/api/src/wallet/design-signature.js';
import { stripVersion } from '../../apps/api/src/wallet/google-wallet.js';
import type { WalletCard } from '../../apps/api/src/wallet/apple-pass.js';
import { cardTemplates } from '../../packages/contracts/src/branding.js';

const card: WalletCard = {
  id: '00000000-0000-4000-8000-000000000001',
  merchant_id: '00000000-0000-4000-8000-000000000002',
  merchant_name: 'بن البلد',
  program_name: 'قهوة',
  threshold: 8,
  display_balance: 3,
  pending_rewards: 0,
  primary_color: '#204E43',
  accent_color: '#D4B56A',
  stamp_shape: 'seal',
  stamp_icon: 'coffee',
  stamp_style: 'solid',
  reward_title: 'قهوة على حسابنا',
  reward_terms: '',
  active: true,
  earning_active: true,
};

test('iPhones before iOS 27 get a 375×144 strip with every stamp and the progress line', async () => {
  for (const template of cardTemplates)
    for (const rtl of [false, true]) {
      const svg = appleStripSvg({ ...card, template }, 3, rtl);
      const meta = await sharp(Buffer.from(svg)).metadata();
      assert.equal(meta.width, 1125);
      assert.equal(meta.height, 432);
      assert.equal(svg.match(/data-slot=/g)?.length, 8);
      assert.equal(svg.match(/data-filled="true"/g)?.length, 3);
      assert.ok(svg.includes('data-track="true"'));
    }
});

test('the older-iPhone strip has no business drawing: it does not fit a strip this short', () => {
  const cafe = { ...card, template: 'cafe' as WalletCard['template'] },
    plain = { ...card, template: 'classic' as WalletCard['template'] };
  // Same colours, so the only difference would be the drawing.
  assert.equal(appleStripSvg(cafe, 1), appleStripSvg(plain, 1));
  // The poster keeps its drawing.
  assert.notEqual(posterArtworkSvg(cafe, 1), posterArtworkSvg(plain, 1));
});

test('the design fingerprint is stable within a build and feeds the Google image address', () => {
  assert.match(artworkSignature(), /^[0-9a-f]{16}$/);
  assert.equal(artworkSignature(), artworkSignature());
  assert.match(walletDesignSignature(), /^[0-9a-f]{16}$/);
  assert.equal(walletDesignSignature(), walletDesignSignature());
  assert.match(stripVersion(card), /^[0-9a-f]{12}$/);
});

test('a shop logo is processed once and reused for every pass of that shop', async () => {
  const { logoAssets } = await import('../../apps/api/src/wallet/apple-pass.js');
  const logo = await sharp({
    create: { width: 300, height: 120, channels: 4, background: '#204E43' },
  })
    .png()
    .toBuffer();
  const first = logoAssets(logo);
  assert.equal(logoAssets(Buffer.from(logo)), first);
  const assets = await first;
  assert.equal(assets.wordmark, true);
  assert.deepEqual(
    assets.files.map(([name]) => name),
    [
      'logo.png',
      'logo@2x.png',
      'logo@3x.png',
      'primaryLogo.png',
      'ar.lproj/primaryLogo.png',
      'primaryLogo@2x.png',
      'ar.lproj/primaryLogo@2x.png',
      'primaryLogo@3x.png',
      'ar.lproj/primaryLogo@3x.png',
    ],
  );
});
