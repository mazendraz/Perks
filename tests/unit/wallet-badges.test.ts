import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WalletButton } from '../../apps/web/src/features/WalletPanel.js';

test('Wallet actions use unchanged official artwork in each language and keep downloads scoped to the customer', async () => {
  const metadata = JSON.parse(await readFile('apps/web/public/wallet/ASSET-SOURCES.json', 'utf8'));
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { pathname: '/customer/example', origin: 'https://perks.test' },
  });
  try {
    for (const provider of ['apple', 'google'] as const)
      for (const lang of ['ar', 'en'] as const) {
        const file = `${provider}-add-to-wallet-${lang}.svg`,
          bytes = await readFile('apps/web/public/wallet/' + file);
        assert.equal(
          createHash('sha256').update(bytes).digest('hex'),
          metadata[provider].files[file],
          'provider artwork bytes must stay unchanged',
        );
        const html = renderToStaticMarkup(
          createElement(WalletButton, { provider, membershipId: 'member-id', lang }),
        );
        assert.ok(html.includes(`/wallet/${file}`));
        assert.ok(
          html.includes(`/api/v1/me/memberships/member-id/wallet/${provider}?__portal=customer`),
        );
        assert.ok(html.includes(lang === 'ar' ? 'إضافة إلى' : 'Add to'));
        assert.ok(!html.includes('wallet-glyph'));
      }
  } finally {
    if (previous) Object.defineProperty(globalThis, 'location', previous);
    else Reflect.deleteProperty(globalThis, 'location');
  }
});
