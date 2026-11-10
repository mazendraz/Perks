import type { Page } from 'playwright';

export async function auditCustomerLoading(page: Page, project: string, directory: string) {
  const returnUrl = page.url();
  // A scan can leave the rotating code open after reload. Close it through the
  // UI and let its current request settle before this test navigates away.
  const closeCode = page.getByRole('button', { name: /Close code|اقفل الكود/, exact: true });
  if (await closeCode.isVisible()) await closeCode.click();
  await page.locator('.card-actions button.primary:not(:disabled)').waitFor();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pattern = '**/api/v1/me/redemption-challenges';
  await page.route(pattern, async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  try {
    await page.goto(new URL('/customer', returnUrl).href, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /My cards|كروتي/, exact: true }).waitFor();
    await page.locator('.card-open').first().waitFor({ timeout: 2500 });
    await page.screenshot({ path: directory + '/customer-independent-list-' + project + '.png' });
    await page.locator('.card-open').first().click();
    await page.locator('.wallet-panel').waitFor({ timeout: 2500 });
    await page.screenshot({ path: directory + '/customer-independent-wallet-' + project + '.png' });
  } catch (error) {
    await page.screenshot({ path: directory + '/customer-missing-card-' + project + '.png' });
    throw error;
  } finally {
    release();
    await page.unroute(pattern);
    // The card opened above is already the return destination. Reloading its
    // old placement query would start another automatic QR during later tests.
  }
}
