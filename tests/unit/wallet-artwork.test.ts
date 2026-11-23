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
  // Noir keeps its look but takes the shop's own colours, like every edition.
  const noir = walletTheme({ ...card, template: 'noir' });
  assert.equal(noir.background, '#204e43');
  assert.equal(noir.label, walletTheme({ ...card, template: 'noir' }).label);
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

test('the shop logo is drawn large in the Apple poster and Google gets the same card face', async () => {
  const { posterArtworkSvg, googleHeroSvg, posterLayout, POSTER } =
    await import('../../apps/api/src/wallet/pass-artwork.js');
  const { artworkLogo } = await import('../../apps/api/src/wallet/apple-pass.js');
  const square = await sharp({
    create: { width: 300, height: 300, channels: 4, background: '#204e43' },
  })
    .png()
    .toBuffer();
  const logo = await artworkLogo(square);
  assert.equal(logo.width, logo.height);
  const svg = posterArtworkSvg(card, 1, false, { logo });
  assert.equal((svg.match(/data-logo="true"/g) || []).length, 1);
  // The stamps move down below the logo and stay in the poster band.
  const firstY = Number(/data-slot="1"[^>]*translate\([\d.]+ ([\d.]+)\)/.exec(svg)![1]);
  assert.ok(firstY > posterLayout(card.threshold).slots[0]!.y);
  assert.ok(firstY < POSTER.bottom);
  const meta = await sharp(Buffer.from(googleHeroSvg(card, 2, true))).metadata();
  assert.deepEqual([meta.width, meta.height], [1032, 812]);
  assert.ok(!googleHeroSvg(card, 1).includes('<image'), 'Google shows the logo itself');
});

test('logos are placed as uploaded: margins trimmed, nothing added behind them', async () => {
  const { walletLogo, posterLogo, artworkLogo } =
    await import('../../apps/api/src/wallet/apple-pass.js');
  const { googleLogoTile } = await import('../../apps/api/src/wallet/google-wallet.js');
  // A small blue dot in the middle of a large transparent canvas.
  const source = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><circle cx="300" cy="300" r="100" fill="#1d4ed8"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  for (const png of [await walletLogo(source, 150), await posterLogo(source, 90, true)]) {
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(data[3], 0, 'corner stays transparent: no tile or frame');
    // Trimmed: the dot fills the logo height instead of a third of it.
    const middle = (Math.floor(info.height / 2) * info.width + Math.floor(info.height / 2)) * 4;
    assert.ok(data[middle + 3]! > 200);
  }
  const art = await artworkLogo(source);
  assert.ok(Math.abs(art.width - art.height) <= 2);
  // Google's circle gets the card colour behind the logo, nothing else.
  const tile = await sharp(await googleLogoTile(source, '#204e43'))
    .raw()
    .toBuffer();
  assert.deepEqual([...tile.subarray(0, 3)], [0x20, 0x4e, 0x43]);
});

test('re-adding a Google card first replaces the stored card, so an old QR code cannot come back', async () => {
  const { refreshSavedGoogleCard } = await import('../../apps/api/src/wallet/google-wallet.js');
  const { generateKeyPairSync } = await import('node:crypto');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const calls: { method: string; url: string; body: Record<string, unknown> | null }[] = [];
  const g = {
    issuerId: '1234',
    clientEmail: 'test@example.iam.gserviceaccount.com',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({
        method: init?.method || 'GET',
        url,
        body: init?.body && !String(url).includes('oauth2') ? JSON.parse(String(init.body)) : null,
      });
      if (String(url).includes('oauth2'))
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  };
  const status = await refreshSavedGoogleCard(
    g,
    { ...card, template: 'barber' },
    '00000000-0000-4000-8000-0000000000aa',
    'https://perks.systems',
    'v1',
  );
  assert.equal(status, 200);
  const put = calls.find((x) => x.method === 'PUT')!;
  assert.ok(put.url.includes('/loyaltyObject/'));
  assert.equal(put.body!.barcode, undefined);
  const klass = calls.find((x) => x.url.includes('/loyaltyClass/'))!;
  assert.equal(klass.method, 'PATCH');
  assert.equal(klass.body!.programName, 'عضوية العناية');
});

test('two shops on the same template and colours get different drawings; each shop keeps its own', async () => {
  const { posterArtworkSvg } = await import('../../apps/api/src/wallet/pass-artwork.js');
  const barber = { ...card, template: 'barber' as const };
  const shops = Array.from({ length: 20 }, (_, i) =>
    posterArtworkSvg(
      { ...barber, merchant_id: '00000000-0000-4000-8000-0000000001' + String(i).padStart(2, '0') },
      1,
    ),
  );
  assert.equal(new Set(shops).size, 20, 'every shop has its own arrangement');
  assert.equal(
    posterArtworkSvg({ ...barber, merchant_id: 'a' }, 1),
    posterArtworkSvg({ ...barber, merchant_id: 'a' }, 1),
  );
});

test('"Your logo": the owner picks the side or corner and how much of the logo runs past the edge', async () => {
  const { logoMarkBox } = await import('../../packages/contracts/src/branding.js');
  const { posterArtworkSvg } = await import('../../apps/api/src/wallet/pass-artwork.js');
  const { artworkLogo } = await import('../../apps/api/src/wallet/apple-pass.js');
  // Centre: in the middle of the card, never past the edge.
  const centre = logoMarkBox(600, 420, 'center', 50);
  assert.equal(centre.x, 300 - centre.size / 2);
  assert.equal(centre.y, 210 - centre.size / 2);
  // Right side with 40%: 40% of the logo is past the right edge.
  const right = logoMarkBox(600, 420, 'right', 40);
  assert.ok(Math.abs(right.x + right.size - (600 + right.size * 0.4)) < 1e-9);
  assert.equal(right.y, centre.y);
  // Bottom-left corner with no bleed touches both edges from inside.
  const corner = logoMarkBox(600, 420, 'bottom-left', 0);
  assert.equal(corner.x, 0);
  assert.ok(Math.abs(corner.y + corner.size - 420) < 1e-9);
  // Bleed is capped at 60%.
  assert.deepEqual(logoMarkBox(600, 420, 'left', 99), logoMarkBox(600, 420, 'left', 60));
  // The Wallet artwork uses the same box.
  const logo = await artworkLogo(
    await sharp({ create: { width: 200, height: 200, channels: 4, background: '#204e43' } })
      .png()
      .toBuffer(),
  );
  const svg = posterArtworkSvg(
    { ...card, template: 'logomark', logo_mark_position: 'top-right', logo_mark_bleed: 30 },
    1,
    false,
    { watermark: logo },
  );
  const box = logoMarkBox(358, 448, 'top-right', 30);
  const x = Number(/data-watermark="true"[^>]* x="([\d.-]+)"/.exec(svg)![1]);
  assert.ok(Math.abs(x - box.x) < 0.01);
});

test('the private Apple artwork keeps the six-digit number small and on the right in both languages', async () => {
  const { appleStripSvg, googleHeroSvg, posterArtworkSvg } =
    await import('../../apps/api/src/wallet/pass-artwork.js');
  const numbered = { ...card, card_number: '012345' };
  const poster = (rtl: boolean) =>
    posterArtworkSvg(numbered, 1, rtl, { includeAppleCardNumber: true });
  for (const rtl of [false, true]) {
    assert.match(poster(rtl), /x="340" y="369" text-anchor="end"[^>]+font-size="10"[^>]*>012345</);
    assert.match(
      appleStripSvg(numbered, 1, rtl),
      /x="357" y="126" text-anchor="end"[^>]+font-size="10"[^>]*>012345</,
    );
  }
  assert.ok(!appleStripSvg({ ...numbered, active: false }, 1).includes('data-card-number'));
  assert.ok(!googleHeroSvg(numbered, 1).includes('data-card-number'));
});
