import assert from 'node:assert/strict';
import type { Page } from 'playwright';

// Exercises the real owner editor without publishing the temporary preview.
export async function auditMobileBrand(page: Page, project: string, directory: string) {
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Business sections', exact: true })
    .getByRole('button', { name: 'Loyalty card', exact: true })
    .click();
  for (const lang of ['en', 'ar'] as const) {
    if (lang === 'ar') await page.getByRole('button', { name: 'العربية', exact: true }).click();
    if (lang === 'ar') {
      assert.equal(
        await page.evaluate(async () =>
          (
            await Promise.all([
              document.fonts.load('400 16px "GE SS Arabic"', 'العربية'),
              document.fonts.load('500 16px "GE SS Arabic"', 'العربية'),
            ])
          ).every((faces) => faces.length > 0 && faces.every((face) => face.status === 'loaded')),
        ),
        true,
        project + ' supplied Arabic font weights actually load',
      );
    }
    const name = page.getByRole('textbox', {
      name: lang === 'ar' ? 'اسم النشاط' : 'Business name',
      exact: true,
    });
    await name.fill('بن وحكاية — كافيه تجريبي لاختبار شاشات الموبايل');
    for (const width of [320, 360, 390, 430, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const issues = await page
        .locator(
          '.template-filters button, .logo-choices button, .brand-savebar button, .owner-sections button',
        )
        .evaluateAll((elements) =>
          elements
            .filter(
              (el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
            )
            .map((el) => el.textContent?.trim()),
        );
      assert.deepEqual(issues, [], `${project} ${lang} ${width}px clipped editor controls`);
      assert.equal(
        await page
          .locator('.owner-sections')
          .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        true,
        `${project} ${lang} ${width}px internal section navigation overflow`,
      );
      assert.deepEqual(
        await page.locator('.template-thumb').evaluateAll((frames) =>
          frames
            .filter((frame) => {
              const a = frame.getBoundingClientRect();
              const b = frame.querySelector('.loyalty-card')!.getBoundingClientRect();
              return (
                b.left < a.left - 1 ||
                b.right > a.right + 1 ||
                b.top < a.top - 1 ||
                b.bottom > a.bottom + 1
              );
            })
            .map((frame) => frame.closest('button')?.textContent?.trim()),
        ),
        [],
        `${project} ${lang} ${width}px cropped template artwork`,
      );
      assert.deepEqual(
        await page.locator('.logo-initial').evaluateAll((initials) =>
          initials
            .filter((initial) => {
              const range = document.createRange();
              range.selectNodeContents(initial);
              const text = range.getBoundingClientRect(),
                frame = initial.parentElement!.getBoundingClientRect();
              return (
                text.left < frame.left - 1 ||
                text.right > frame.right + 1 ||
                text.top < frame.top - 1 ||
                text.bottom > frame.bottom + 1
              );
            })
            .map((initial) => initial.textContent),
        ),
        [],
        `${project} ${lang} ${width}px clipped Arabic logo initial`,
      );
      if (width <= 760) {
        await name.focus();
        await name.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        assert.equal(
          await name.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return hit === el || el.contains(hit);
          }),
          true,
          `${project} ${lang} ${width}px save bar covers focused name`,
        );
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        ),
        true,
        `${project} ${lang} ${width}px page overflow`,
      );
      if (width === 390) {
        await page.locator('.logo-controls').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${directory}/mobile-brand-${project}-${lang}-logo.png` });
        await page.locator('.template-filters').scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `${directory}/mobile-brand-${project}-${lang}-templates.png`,
        });
      }
    }
  }
}
