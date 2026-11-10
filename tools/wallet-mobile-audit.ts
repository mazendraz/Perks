import assert from 'node:assert/strict';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';

export async function auditWalletPresentation(page: Page, project: string, directory: string) {
  const current = new URL(page.url()),
    memberPath = current.pathname,
    viewport = page.viewportSize()!;
  const endpoint = '**/api/v1/wallet/availability';
  await page.route(endpoint, (route) => route.fulfill({ json: { apple: true, google: true } }));
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    const link = page.locator('.wallet-badge-button');
    await link.waitFor();
    assert.equal(await link.count(), 1, 'only the device-appropriate official button is offered');
    for (const language of ['en', 'ar']) {
      if (language === 'ar')
        await page.getByRole('button', { name: 'العربية', exact: true }).click();
      for (const width of [320, 390, 430]) {
        await page.setViewportSize({ width, height: 844 });
        await page
          .locator('.wallet-badge-button img')
          .evaluate((img: HTMLImageElement) => img.decode());
        const size = await link.evaluate((el) => {
          const r = el.getBoundingClientRect(),
            img = el.querySelector('img')!,
            a = img.getBoundingClientRect();
          return {
            page: document.documentElement.clientWidth,
            content: document.documentElement.scrollWidth,
            width: r.width,
            height: r.height,
            ratio: a.width / a.height,
            source: img.getAttribute('src')!,
          };
        });
        assert.ok(size.content <= size.page + 1 && size.width >= 44 && size.height >= 48);
        // WebKit rounds naturalWidth/naturalHeight to whole pixels. Apple's
        // original SVG uses fractional dimensions, so compare its real viewBox.
        assert.match(size.source, /^\/wallet\/(apple|google)-add-to-wallet-(ar|en)\.svg$/);
        const artwork = await readFile('apps/web/public' + size.source, 'utf8');
        const bounds = artwork.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!;
        const originalRatio = Number(bounds[1]) / Number(bounds[2]);
        assert.ok(
          Math.abs(size.ratio - originalRatio) < 0.015,
          'official artwork is never stretched',
        );
        if (width === 390) {
          const image = await link.screenshot({
            path: `${directory}/wallet-badge-${project}-${language}.png`,
          });
          const { data, info } = await sharp(image)
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          let colored = 0;
          for (let i = 0; i < data.length; i += info.channels)
            if (
              Math.max(data[i]!, data[i + 1]!, data[i + 2]!) -
                Math.min(data[i]!, data[i + 1]!, data[i + 2]!) >
              45
            )
              colored++;
          assert.ok(colored > 50, 'provider color artwork must actually render under CSP');
        }
      }
    }
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.goto(current.origin + memberPath + '?wallet=1', { waitUntil: 'domcontentloaded' });
    await page.getByRole('dialog', { name: 'Personal QR', exact: true }).waitFor();
    assert.match(
      (await page.locator('.qr-panel code').textContent())!.trim(),
      /^NQP:[a-f0-9]{64}$/,
    );
    await page.getByRole('button', { name: 'Close code', exact: true }).click();
    await page.getByRole('button', { name: 'Back to my cards', exact: true }).click();
    await page.locator('.card-open').first().click();
  } finally {
    await page.unroute(endpoint);
    await page.setViewportSize(viewport);
  }
}
