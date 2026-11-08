const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const base = process.env.NUQTA_AUDIT_NODE_MODULES;
const requireBrowser = base ? createRequire(path.join(base, '_audit.cjs')) : require;
const { chromium } = requireBrowser('playwright');
const out = path.resolve(__dirname, '../../docs/execution/evidence');
process.env.DEMO_PORT = process.env.DEMO_PORT || '4174';
const localServer = require('../serve-demo.cjs');
const origin = 'http://127.0.0.1:' + process.env.DEMO_PORT;
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ar-EG' });
  const results = [];
  for (const file of fs.readdirSync(path.resolve(__dirname, '../../standalone')).filter(f => f.endsWith('.html'))) {
    const page = await context.newPage();
    const errors = [], failedRequests = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('requestfailed', r => failedRequests.push({ url: r.url(), error: r.failure()?.errorText }));
    page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
    const response = await page.goto(origin + '/' + encodeURIComponent(file));
    await page.waitForFunction(() => !document.getElementById('__bundler_loading'), { timeout: 20000 });
    await page.waitForTimeout(800);
    const text = await page.locator('body').innerText();
    const slug = file.replace('Nuqta - ', '').replace('.html', '').toLowerCase().replaceAll(' ', '-');
    fs.writeFileSync(path.join(out, slug + '.body.txt'), text);
    await page.screenshot({ path: path.join(out, slug + '.png'), fullPage: true });
    results.push({ file, status: response.status(), title: await page.title(), textLength: text.length, errors, failedRequests, requests, nq: await page.evaluate(() => !!window.NQ), preview: text.slice(0, 800) });
    await page.close();
  }
  fs.writeFileSync(path.join(out, 'browser-smoke.json'), JSON.stringify({ at: new Date().toISOString(), browser: browser.version(), results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); localServer.close(); });
