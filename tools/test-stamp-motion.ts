import { chromium, devices, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import helmet from '@fastify/helmet';
import {
  legacyTargets,
  legacyScriptHashes,
  scriptSources,
} from '../packages/domain/src/browser-policy.js';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { readConfig } from '../apps/api/src/config.js';
const config = readConfig(),
  origin = config.PUBLIC_APP_ORIGIN;
assert.ok(['development', 'test'].includes(config.APP_ENV));
assert.equal(new URL(origin).hostname, '127.0.0.1');
const directory = 'docs/execution/evidence/animation',
  reference = await readFile('docs/design/stamp-motion-v2.html', 'utf8');
const preview = origin + '/@fs/' + resolve('tools/motion-preview.html').replaceAll('\\', '/');
interface Probe {
  records: { animation: Animation; start: number; target: Element }[];
}
interface Fixture {
  reset: (n: number) => void;
  stamp: (n: number) => void;
}
const report: {
  at: string;
  status: string;
  referenceSha256: string;
  frames: { scenario: string; ms: number; reference: number; implementation: number }[];
  checks: string[];
  performance?: {
    cpuThrottle: number;
    maxFrameMs: number;
    framesOver32: number;
    frameMs: number[];
  };
  reason?: string;
} = {
  at: new Date().toISOString(),
  status: 'running',
  referenceSha256: createHash('sha256').update(reference).digest('hex'),
  frames: [],
  checks: [],
};
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true }),
  pages: Page[] = [];
const performanceServer = Fastify({ logger: false });
async function productionFixture() {
  const temporary = resolve('.local', 'motion-production-' + randomUUID()),
    source = resolve(temporary, 'src'),
    output = resolve(temporary, 'dist');
  await mkdir(source, { recursive: true });
  const entry = relative(source, resolve('tools/motion-preview.tsx')).replaceAll('\\', '/');
  await writeFile(
    resolve(source, 'index.html'),
    '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="' +
      entry +
      '"></script></html>',
  );
  await build({
    configFile: false,
    root: source,
    publicDir: resolve('apps/web/public'),
    plugins: [react(), legacy({ targets: legacyTargets, renderModernChunks: false })],
    logLevel: 'error',
    build: {
      outDir: output,
      emptyOutDir: false,
      sourcemap: false,
      cssTarget: ['safari13', 'chrome80'],
    },
  });
  const html = await readFile(resolve(output, 'index.html'), 'utf8');
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))
    if (!/(?:^|\s)src\s*=/.test(script[1]!) && script[2]!.trim())
      assert.ok(
        legacyScriptHashes.includes(createHash('sha256').update(script[2]!).digest('base64')),
      );
  await performanceServer.register(helmet, {
    contentSecurityPolicy: {
      directives: { scriptSrc: scriptSources, upgradeInsecureRequests: null },
    },
  });
  await performanceServer.register(fastifyStatic, { root: output });
  return performanceServer.listen({ port: 0, host: '127.0.0.1' });
}
const pass = (value: string) => {
  report.checks.push(value);
  console.log('PASS ' + value);
};
async function freeze(page: Page) {
  await page.evaluate(() => {
    const state = (window as unknown as { motionProbe: Probe }).motionProbe,
      now = performance.now();
    for (const animation of document.getAnimations()) {
      let record = state.records.find((item) => item.animation === animation);
      if (!record) {
        record = {
          animation,
          start: now,
          target: (animation.effect as KeyframeEffect).target as Element,
        };
        state.records.push(record);
      }
      const timing = animation.effect!.getComputedTiming(),
        elapsed = Math.max(0, now - record.start),
        end = Number(timing.endTime);
      if (Number.isFinite(end) && elapsed >= end) {
        animation.finish();
        animation.pause();
        animation.currentTime = end;
      } else {
        animation.pause();
        animation.currentTime = elapsed;
      }
    }
  });
  await delay(5);
}
async function advance(page: Page, ms: number) {
  await page.clock.runFor(ms);
  await delay(5);
  await freeze(page);
}
async function setup(kind: 'reference' | 'implementation', scenario: string) {
  const page = await browser.newPage({
    viewport: { width: 420, height: 1000 },
    reducedMotion: scenario === 'reduced' ? 'reduce' : 'no-preference',
  });
  pages.push(page);
  page.setDefaultTimeout(10000);
  await page.addInitScript('window.__name = function(value) { return value; }');
  await page.addInitScript(() => {
    const state: Probe = { records: [] };
    (window as unknown as { motionProbe: Probe }).motionProbe = state;
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      const animation = original.call(this, frames, options);
      animation.pause();
      state.records.push({ animation, start: performance.now(), target: this });
      return animation;
    };
  });
  await page.clock.install({ time: new Date('2026-11-09T00:00:00Z') });
  if (kind === 'reference') {
    await page.route(origin + '/__nuqta-motion-reference', (route) =>
      route.fulfill({ contentType: 'text/html; charset=utf-8', body: reference }),
    );
    await page.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({
        contentType: 'text/css',
        body: `@font-face{font-family:'IBM Plex Sans Arabic';src:url('${origin}/fonts/ibm-regular.ttf')} @font-face{font-family:'IBM Plex Sans Arabic';font-weight:600 700;src:url('${origin}/fonts/ibm-semibold.ttf')}`,
      }),
    );
    await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
    await page.goto(origin + '/__nuqta-motion-reference');
    await page.locator('#card').waitFor();
  } else {
    await page.goto(preview);
    await page.locator('.loyalty-card').waitFor();
  }
  await page.evaluate(() => document.fonts.ready);
  await page.clock.pauseAt(await page.evaluate(() => new Date(Date.now() + 100)));
  if (scenario === 'reward') {
    if (kind === 'reference') {
      await page.locator('#br').click();
      for (const button of ['#b3', '#b3', '#b1']) {
        await page.locator(button).click();
        await advance(page, 1800);
      }
      assert.equal(await page.locator('#bal').textContent(), '7');
    } else {
      await page.evaluate(() =>
        (window as unknown as { nuqtaMotionFixture: Fixture }).nuqtaMotionFixture.reset(7),
      );
      await advance(page, 50);
    }
  }
  await page.evaluate(() =>
    (window as unknown as { motionProbe: Probe }).motionProbe.records.splice(0),
  );
  if (kind === 'reference') await page.locator(scenario === 'three' ? '#b3' : '#b1').click();
  else
    await page.evaluate(
      (count) =>
        (window as unknown as { nuqtaMotionFixture: Fixture }).nuqtaMotionFixture.stamp(count),
      scenario === 'three' ? 3 : 1,
    );
  // React's commit is a message task, not a fake timer. Let it settle without
  // advancing the animation clock, then use the actual first animation start.
  await delay(20);
  for (let attempt = 0; attempt < 10; attempt++) {
    if (
      await page.evaluate(() =>
        (window as unknown as { motionProbe: Probe }).motionProbe.records.some((r) =>
          /tool|ink/.test(r.target.getAttribute('class') || ''),
        ),
      )
    )
      break;
    await advance(page, 1);
  }
  await freeze(page);
  const start = await page.evaluate((reduced) => {
    const records = (window as unknown as { motionProbe: Probe }).motionProbe.records;
    return Math.min(
      ...records
        .filter((r) =>
          reduced
            ? /ink/.test(r.target.getAttribute('class') || '')
            : /tool/.test(r.target.getAttribute('class') || ''),
        )
        .map((r) => r.start),
    );
  }, scenario === 'reduced');
  assert.ok(Number.isFinite(start), 'first animation must exist');
  return { page, start };
}
try {
  for (const scenario of ['single', 'three', 'reward', 'reduced']) {
    const left = await setup('reference', scenario),
      right = await setup('implementation', scenario);
    let elapsed = 0;
    for (const ms of [0, 120, 300, 350, 360, 420, 480, 650, 700]) {
      for (const { page, start } of [left, right]) {
        const now = await page.evaluate(() => performance.now());
        const target = start + ms;
        if (target > now) await advance(page, target - now);
        else await freeze(page);
      }
      elapsed = ms;
      if (![0, 120, 300, 360, 480, 700].includes(ms)) continue;
      const expected =
        scenario === 'reduced'
          ? 3
          : scenario === 'reward'
            ? ms >= 300
              ? 8
              : 7
            : scenario === 'three'
              ? 2 + (ms >= 300 ? 1 : 0) + (ms >= 650 ? 1 : 0)
              : ms >= 300
                ? 3
                : 2;
      const a = Number(await left.page.locator('#bal').textContent()),
        b = Number(await right.page.locator('[role=progressbar]').getAttribute('aria-valuenow'));
      assert.equal(a, expected, scenario + ' reference at ' + ms);
      assert.equal(b, expected, scenario + ' implementation at ' + ms);
      const ref = await left.page.locator('#stage').screenshot({ animations: 'allow' }),
        actual = await right.page
          .locator('.loyalty-card-shell')
          .screenshot({ animations: 'allow' });
      await writeFile(directory + '/' + scenario + '-' + ms + '-reference.png', ref);
      await writeFile(directory + '/' + scenario + '-' + ms + '-implementation.png', actual);
      const ra = await sharp(ref).metadata(),
        rb = await sharp(actual).metadata();
      const caption = Buffer.from(
        '<svg width="' +
          (ra.width! + rb.width! + 24) +
          '" height="32"><rect width="100%" height="100%" fill="#efece6"/><text x="8" y="22" font-family="sans-serif" font-size="14">Reference ' +
          ms +
          'ms</text><text x="' +
          (ra.width! + 32) +
          '" y="22" font-family="sans-serif" font-size="14">Nuqta ' +
          ms +
          'ms</text></svg>',
      );
      await sharp({
        create: {
          width: ra.width! + rb.width! + 24,
          height: Math.max(ra.height!, rb.height!) + 32,
          channels: 4,
          background: '#efece6',
        },
      })
        .composite([
          { input: caption, left: 0, top: 0 },
          { input: ref, left: 0, top: 32 },
          { input: actual, left: ra.width! + 24, top: 32 },
        ])
        .png()
        .toFile(directory + '/' + scenario + '-' + ms + '-comparison.png');
      report.frames.push({ scenario, ms, reference: a, implementation: b });
    }
    assert.equal(elapsed, 700);
    if (scenario === 'reduced')
      assert.equal(await right.page.locator('.nq-stamp-tool,.nq-confetti').count(), 0);
    for (const value of [left, right]) await value.page.close();
    pass(
      scenario +
        ': six frozen WAAPI frames match reference counter timing at 0/120/300/360/480/700ms',
    );
  }
  const page = await browser.newPage({ ...devices['Pixel 5'] });
  pages.push(page);
  await page.addInitScript('window.__name = function(value) { return value; }');
  await page.goto(await productionFixture());
  await page.locator('.loyalty-card').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('button', { name: 'Three stamps', exact: true }).click();
  await page.waitForTimeout(1700);
  await page.getByRole('button', { name: 'Reset two', exact: true }).click();
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await session.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame',
    transferMode: 'ReturnAsStream',
  });
  const frameMs = await page.evaluate(
    () =>
      new Promise<number[]>((resolveResult) => {
        const frames: number[] = [];
        let previous = performance.now();
        const start = previous;
        const tick = (now: number) => {
          if (now > previous) frames.push(now - previous);
          previous = now;
          if (now - start < 1900) requestAnimationFrame(tick);
          else resolveResult(frames);
        };
        requestAnimationFrame(tick);
        (window as unknown as { nuqtaMotionFixture: Fixture }).nuqtaMotionFixture.stamp(3);
      }),
  );
  const complete = new Promise<{ stream?: string }>((resolveResult) =>
    session.once('Tracing.tracingComplete', resolveResult),
  );
  await session.send('Tracing.end');
  const { stream } = await complete;
  assert.ok(stream, 'Chrome must return the recorded trace stream');
  let trace = '';
  for (;;) {
    const part = await session.send('IO.read', { handle: stream });
    trace += part.base64Encoded ? Buffer.from(part.data, 'base64').toString('utf8') : part.data;
    if (part.eof) break;
    assert.ok(trace.length < 30 * 1024 * 1024);
  }
  await session.send('IO.close', { handle: stream });
  await writeFile(directory + '/pixel5-cpu4x-trace.json', trace);
  const framesOver32 = frameMs.filter((ms) => ms > 32).length;
  report.performance = { cpuThrottle: 4, maxFrameMs: Math.max(...frameMs), framesOver32, frameMs };
  assert.equal(framesOver32, 0, 'motion frame intervals must stay at or below 32ms under CPU4x');
  pass('Pixel 5 emulation at CPU4x: recorded Chrome trace and no frame interval above 32ms');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.reason = String(error);
  console.error(report.reason);
  process.exitCode = 1;
} finally {
  await performanceServer.close();
  await browser.close();
  await writeFile(directory + '/animation.json', JSON.stringify(report, null, 2) + '\n');
}
