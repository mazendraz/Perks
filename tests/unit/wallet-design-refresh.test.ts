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

test('iPhones before iOS 27 get the new card face as a 375×144 strip, with every stamp inside it', async () => {
  for (const template of cardTemplates)
    for (const rtl of [false, true]) {
      const svg = appleStripSvg({ ...card, template }, 3, rtl);
      const meta = await sharp(Buffer.from(svg)).metadata();
      assert.equal(meta.width, 1125);
      assert.equal(meta.height, 432);
      // Same slots and progress line as the poster, not the old plain stamp row.
      assert.equal(svg.match(/data-slot=/g)?.length, 8);
      assert.equal(svg.match(/data-filled="true"/g)?.length, 3);
    }
});

test('a business edition draws its business on the older-iPhone strip, like on the poster', () => {
  const cafe = { ...card, template: 'cafe' as WalletCard['template'] },
    plain = { ...card, template: 'classic' as WalletCard['template'] };
  assert.notEqual(appleStripSvg(cafe, 1), appleStripSvg(plain, 1));
  assert.ok(posterArtworkSvg(cafe, 1).length > 0);
});

test('the design fingerprint is stable within a build and feeds the Google image address', () => {
  assert.match(artworkSignature(), /^[0-9a-f]{16}$/);
  assert.equal(artworkSignature(), artworkSignature());
  assert.match(walletDesignSignature(), /^[0-9a-f]{16}$/);
  assert.equal(walletDesignSignature(), walletDesignSignature());
  assert.match(stripVersion(card), /^[0-9a-f]{12}$/);
});
