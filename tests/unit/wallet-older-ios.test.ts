import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  APPLE_STRIP,
  appleStripLayout,
  appleStripSvg,
  type ArtworkLogo,
} from '../../apps/api/src/wallet/pass-artwork.js';
import {
  buildPkpass,
  loadAppleSigner,
  passJson,
  programLanguage,
  readableLabel,
  shortReward,
  texts,
  type AppleWalletSigner,
  type WalletCard,
} from '../../apps/api/src/wallet/apple-pass.js';
import { contrast, walletTheme } from '../../packages/domain/src/wallet-theme.js';
import { cardTemplates } from '../../packages/contracts/src/branding.js';
import { testWalletCertificates } from '../wallet-certs.js';

const arabic: WalletCard = {
  id: '00000000-0000-4000-8000-000000000001',
  merchant_id: '00000000-0000-4000-8000-000000000002',
  merchant_name: 'بن وحكاية',
  program_name: 'قهوة',
  threshold: 10,
  display_balance: 5,
  pending_rewards: 0,
  primary_color: '#6F3F22',
  accent_color: '#E2A85B',
  surface_color: '#FBF5EE',
  stamp_shape: 'seal',
  stamp_icon: 'coffee',
  stamp_style: 'solid',
  reward_title: 'قهوة على حسابنا',
  reward_terms: 'ختم لكل مشروب',
  active: true,
  earning_active: true,
};
const english: WalletCard = {
  ...arabic,
  merchant_name: 'Bunn',
  program_name: 'Coffee',
  reward_title: 'Free coffee',
  reward_terms: 'One stamp per drink',
};
const signer = { passTypeIdentifier: 'pass.test', teamIdentifier: 'TEAM' } as AppleWalletSigner;
const logo: ArtworkLogo = { href: 'data:image/png;base64,AAAA', width: 240, height: 240 };
const wide: ArtworkLogo = { href: 'data:image/png;base64,AAAA', width: 960, height: 240 };
const options = { serial: 's', authToken: 'x'.repeat(32), origin: 'https://perks.test', signer };

const slotsOf = (svg: string) =>
  [
    ...svg.matchAll(
      /data-slot="(\d+)" data-filled="(true|false)" transform="translate\(([\d.]+) ([\d.]+)\)"/g,
    ),
  ].map((m) => ({ n: Number(m[1]), filled: m[2] === 'true', x: Number(m[3]), y: Number(m[4]) }));

test('strip stamps stay 17% clear of the edges, also when Wallet crops the strip to 375×123', () => {
  const crop = (144 - 123) / 2;
  for (const total of [2, 5, 6, 8, 10, 12, 20, 30, 50])
    for (const art of [null, logo, wide]) {
      const layout = appleStripLayout(total, art);
      // Filled ink reaches a little past the slot.
      const reach = (layout.size * 1.18) / 2;
      for (const { x, y } of layout.slots) {
        assert.ok(y - reach >= Math.max(144 * 0.17, crop + 123 * 0.17) - 0.01, `top ${total}`);
        assert.ok(y + reach <= Math.min(144 * 0.83, crop + 123 * 0.83) + 0.01, `bottom ${total}`);
        assert.ok(x - reach >= 0 && x + reach <= APPLE_STRIP.width, `side ${total}`);
      }
      assert.ok(layout.track.y + 3 <= APPLE_STRIP.bottom);
      if (layout.logo) {
        assert.ok(layout.logo.y >= APPLE_STRIP.top);
        assert.ok(layout.logo.y + layout.logo.height <= APPLE_STRIP.bottom);
        // The stamps never run into the logo.
        for (const { x } of layout.slots)
          assert.ok(x - reach > layout.logo.x + layout.logo.width, `logo ${total}`);
      }
    }
});

test('the Arabic strip is the mirror image: logo on the right, stamps filling from the right', () => {
  const ltr = slotsOf(appleStripSvg(arabic, 1, false, logo)),
    rtl = slotsOf(appleStripSvg(arabic, 1, true, logo));
  assert.equal(ltr.length, 10);
  for (const [i, slot] of rtl.entries()) {
    assert.ok(Math.abs(slot.x - (375 - ltr[i]!.x)) < 0.02);
    assert.equal(slot.y, ltr[i]!.y);
  }
  // The first stamp is on the reading side.
  assert.ok(rtl[0]!.x > rtl[4]!.x);
  assert.ok(ltr[0]!.x < ltr[4]!.x);
  const logoX = (svg: string) => Number(/data-logo="true" x="([\d.]+)"/.exec(svg)![1]);
  assert.ok(logoX(appleStripSvg(arabic, 1, false, logo)) < 100);
  assert.ok(logoX(appleStripSvg(arabic, 1, true, logo)) > 275);
});

test('the strip shows empty, half, full and closed cards', () => {
  const filled = (card: WalletCard) =>
    slotsOf(appleStripSvg(card, 1)).filter((s) => s.filled).length;
  assert.equal(filled({ ...arabic, display_balance: 0 }), 0);
  assert.equal(filled(arabic), 5);
  assert.equal(filled({ ...arabic, display_balance: 10, pending_rewards: 1 }), 10);
  const closed = appleStripSvg({ ...arabic, active: false }, 1);
  assert.ok(closed.includes('data-closed="true"'));
  assert.ok(!appleStripSvg(arabic, 1).includes('data-closed'));
});

test('every edition strip renders at @1x/@2x/@3x', async () => {
  for (const template of cardTemplates)
    for (const scale of [1, 2, 3]) {
      const meta = await sharp(
        Buffer.from(appleStripSvg({ ...arabic, template }, scale, true)),
      ).metadata();
      assert.deepEqual([meta.width, meta.height], [375 * scale, 144 * scale]);
    }
});

test('the program language comes from the program, not the phone', () => {
  assert.equal(programLanguage(arabic), 'ar');
  assert.equal(programLanguage(english), 'en');
  // An English shop name does not make an Arabic program English.
  assert.equal(programLanguage({ ...arabic, program_name: 'Bunn' }), 'ar');
});

test('the card face reward is about 30 characters, cut at a word, with the full title on the back', () => {
  assert.equal(shortReward('Free coffee'), 'Free coffee');
  const long = 'One free large iced latte with any pastry of your choice';
  const short = shortReward(long);
  assert.ok(Array.from(short).length <= 30);
  assert.ok(short.endsWith('…'));
  assert.ok(long.startsWith(short.slice(0, -1)));
  const pass = passJson({ ...english, reward_title: long }, options) as unknown as {
    storeCard: {
      secondaryFields: { value: string }[];
      backFields: { key: string; value: string }[];
    };
    posterGeneric: { primaryFields: { value: string }[] };
  };
  assert.equal(pass.storeCard.secondaryFields[0]!.value, short);
  assert.equal(pass.storeCard.backFields.find((f) => f.key === 'reward_full')!.value, long);
  // The poster keeps the full title.
  assert.equal(pass.posterGeneric.primaryFields[0]!.value, long);
});

test('a long shop name is left out of the logo row when the logo is there', () => {
  const long = { ...english, merchant_name: 'The Very Long Coffee Roasters Company' };
  const logoText = (card: WalletCard, o: { logo?: boolean; wordmark?: boolean }) =>
    (passJson(card, { ...options, ...o }) as { logoText?: string }).logoText;
  assert.equal(logoText(english, { logo: true }), 'Bunn');
  assert.equal(logoText(long, { logo: true }), undefined);
  // With no logo, the name is all the logo row has.
  assert.equal(logoText(long, {}), long.merchant_name);
  assert.equal(logoText(english, { logo: true, wordmark: true }), undefined);
});

test('field captions are readable on every edition', () => {
  for (const template of cardTemplates)
    for (const [primary, accent] of [
      ['#6F3F22', '#E2A85B'],
      ['#204E43', '#D4B56A'],
      ['#f5f5f5', '#ffffff'],
      ['#ffd400', '#ffe066'],
    ]) {
      const theme = walletTheme({ template, primary_color: primary!, accent_color: accent! });
      assert.ok(contrast(readableLabel(theme), theme.background) >= 4.5, template + primary);
    }
});

test('the reminder field stays on the back so a new reminder is still announced', () => {
  const pass = passJson(arabic, options) as unknown as {
    storeCard: { backFields: { key: string; value: string; changeMessage?: string }[] };
  };
  const reminder = pass.storeCard.backFields.find((f) => f.key === 'reminder')!;
  assert.equal(reminder.value, '');
  assert.equal(reminder.changeMessage, '%@');
});

test('the pass carries 38-point icons and the program language for every phone', async () => {
  const certs = testWalletCertificates('pass.test.perks');
  const real = loadAppleSigner({
    APPLE_WALLET_ENABLED: 'true',
    APPLE_PASS_TYPE_ID: 'pass.test.perks',
    APPLE_TEAM_ID: 'TEAM123456',
    ...certs.files,
  })!;
  for (const card of [arabic, english]) {
    const zip = await buildPkpass(card, { ...options, signer: real });
    const files = unzip(zip);
    for (const [name, size] of [
      ['icon.png', 38],
      ['icon@2x.png', 76],
      ['icon@3x.png', 114],
    ] as const) {
      const meta = await sharp(files.get(name)!).metadata();
      assert.deepEqual([meta.width, meta.height], [size, size], name);
    }
    const lang = programLanguage(card);
    const expected = texts(card)[lang];
    for (const folder of ['ar', 'en']) {
      const strings = files
        .get(folder + '.lproj/pass.strings')!
        .subarray(2)
        .toString('utf16le');
      assert.ok(strings.includes(`"stamps_label" = "${expected.stamps_label}"`), folder + lang);
      assert.ok(strings.includes(`"left_value" = "${expected.left_value}"`), folder + lang);
    }
    // One strip direction for every phone: the program's.
    for (const scale of ['', '@2x', '@3x']) {
      const base = files.get(`strip${scale}.png`)!,
        ar = files.get(`ar.lproj/strip${scale}.png`)!;
      assert.equal(sha(base), sha(ar));
    }
    const pass = JSON.parse(files.get('pass.json')!.toString());
    assert.equal(pass.storeCard.headerFields[0].value, '5/10');
    assert.equal(pass.barcodes, undefined);
    assert.equal(pass.voided, undefined);
    // The poster still has its own artwork for both directions.
    assert.ok(files.has('artwork@3x.png') && files.has('ar.lproj/artwork@3x.png'));
  }
  const closed = JSON.parse(
    unzip(await buildPkpass({ ...arabic, active: false }, { ...options, signer: real }))
      .get('pass.json')!
      .toString(),
  );
  assert.equal(closed.voided, true);
});

const sha = (b: Buffer) => createHash('sha1').update(b).digest('hex');
function unzip(zip: Buffer) {
  const files = new Map<string, Buffer>();
  let at = 0;
  while (zip.readUInt32LE(at) === 0x04034b50) {
    const size = zip.readUInt32LE(at + 18),
      nameLength = zip.readUInt16LE(at + 26),
      name = zip.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    files.set(name, zip.subarray(at + 30 + nameLength, at + 30 + nameLength + size));
    at += 30 + nameLength + size;
  }
  return files;
}
