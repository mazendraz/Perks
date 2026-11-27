import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import {
  LINES,
  CLIP_SECONDS,
  PLAN_LINE,
  SUPPORT_PHONE,
  supportPhoneFor,
  PRICE_CURRENCY,
} from '../../apps/web/src/business/lines.js';
import { publicPlanCatalog } from '../../packages/contracts/src/plan-catalog.js';

const htmlPath = 'apps/web/business/index.html';

test('every guide line has its recording and a known length', async () => {
  for (const [key, line] of Object.entries(LINES)) {
    const file = 'apps/web/public/business/voice/' + line.clip + '.m4a';
    assert.ok((await stat(file)).size > 1000, key + ' recording is missing or empty');
    assert.ok((CLIP_SECONDS[line.clip] ?? 0) > 0.5, key + ' has no clip length');
  }
  for (const plan of publicPlanCatalog)
    assert.ok(PLAN_LINE[plan.key] in LINES, plan.key + ' has no line');
});

test('without JavaScript each bubble already shows the same words the voice says', async () => {
  const html = await readFile(htmlPath, 'utf8');
  const bubbles = [
    ...html.matchAll(
      /data-guide="(\d)"[\s\S]*?<span data-typed aria-hidden="true">([^<]*)<\/span>/g,
    ),
  ];
  assert.equal(bubbles.length, 7);
  const firstLine = [
    'hero',
    'problem',
    'demoStart',
    'cards',
    'owner',
    'plansAsk',
    'close',
  ] as const;
  for (const [, stop, text] of bubbles) assert.equal(text, LINES[firstLine[Number(stop)]!].text);
});

test('the landing page is CSP-safe and external links cannot reach back into the page', async () => {
  const html = await readFile(htmlPath, 'utf8');
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    assert.match(m[1]!, /\bsrc=/, 'inline scripts are blocked by the site CSP');
    assert.equal(m[2]!.trim(), '');
  }
  assert.doesNotMatch(html, /\son[a-z]+=/i, 'no inline event handlers');
  assert.doesNotMatch(html, /style="/, 'no inline styles');
  for (const m of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g))
    assert.match(m[0], /rel="noopener noreferrer"/);
  for (const m of html.matchAll(/https?:\/\/[^"'\s<]+/g))
    assert.ok(m[0].startsWith('https://wa.me/' + SUPPORT_PHONE), 'unexpected external URL ' + m[0]);
});

test('every image on the landing page exists and declares its size', async () => {
  const html = await readFile(htmlPath, 'utf8');
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(imgs.length >= 6);
  for (const img of imgs) {
    const src = /src="([^"]+)"/.exec(img)?.[1];
    assert.ok(src?.startsWith('/'), 'local image expected: ' + img);
    assert.match(img, /\swidth="\d+"/);
    assert.match(img, /\sheight="\d+"/);
    assert.match(img, /\salt="/);
    await stat('apps/web/public' + src);
  }
});

test('the WhatsApp number follows the device language', () => {
  for (const lang of ['en-US', 'fr', 'es-419', 'de-DE', 'EN_gb'])
    assert.equal(supportPhoneFor(lang), '201069012881', lang);
  for (const lang of ['it-IT', 'ru', 'tr-TR'])
    assert.equal(supportPhoneFor(lang), '201008605904', lang);
  for (const lang of ['ar-EG', 'ar', 'ja', '', undefined])
    assert.equal(supportPhoneFor(lang), SUPPORT_PHONE, String(lang));
});

test('prices are in Egyptian pounds whatever the device language', () => {
  assert.equal(PRICE_CURRENCY.unit, 'جنيه');
  assert.equal(PRICE_CURRENCY.name, 'الجنيه المصري');
  const main = readFileSync('apps/web/src/business/main.ts', 'utf8');
  assert.doesNotMatch(main, /priceCurrencyFor|CURRENCY_BY_LANGUAGE/);
});
