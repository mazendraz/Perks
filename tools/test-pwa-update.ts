// Silent PWA updates, end to end in a real browser against real production builds:
// three releases are built, served one after another, and the open tabs must pick each
// one up without a prompt, without a reload loop, and never mid-write or mid-cashier-flow.
// The API is a small in-process mock, so no database is needed.
import { build, type Plugin } from 'vite';
import { chromium, type Page } from 'playwright';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('apps/web');
const work = await mkdtemp(join(tmpdir(), 'perks-pwa-update-'));
const ok = (name: string) => console.log('PASS ' + name);

function releaseMarker(label: string): Plugin {
  return {
    name: 'perks-test-release-marker',
    transformIndexHtml: (html) =>
      html.replace('</head>', `<meta name="perks-release" content="${label}" /></head>`),
  };
}
async function buildRelease(label: string) {
  const outDir = join(work, label);
  await build({
    root,
    configFile: join(root, 'vite.config.ts'),
    logLevel: 'warn',
    plugins: [releaseMarker(label)],
    build: { outDir, emptyOutDir: true },
  });
  const { version } = JSON.parse(await readFile(join(outDir, 'shell-build.json'), 'utf8')) as {
    version: string;
  };
  return { label, dir: outDir, version, cache: 'nuqta-shell-' + version };
}
const v1 = await buildRelease('v1'),
  v2 = await buildRelease('v2'),
  v3 = await buildRelease('v3');
assert.equal(new Set([v1.cache, v2.cache, v3.cache]).size, 3, 'Each build is a new release.');

// --- Server: static release + mocked API ---------------------------------------------------
let current = v1;
let heldPost: ((status: number) => void) | undefined, postArrived: (() => void) | undefined;
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};
const grant = {
  id: 'grant-1',
  merchant_id: 'merchant-1',
  role: 'cashier',
  max_qty: 5,
  name: 'Test Cafe',
  slug: 'test-cafe',
  status: 'active',
  timezone: 'Africa/Cairo',
  primary_color: '#2f5d50',
  branches: [{ id: 'branch-1', name: 'Main branch' }],
};
const session = {
  user: { id: 'user-1', email: 'cashier@perks.test', role: 'customer', mfaVerified: true },
  csrfToken: 'csrf-test',
  grants: [grant],
};
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/v1/session') return json(res, 200, session);
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/logout') {
      // Held open until the test decides the outcome, to stand in for a slow stamp/redeem.
      heldPost = (status) => {
        heldPost = undefined;
        json(res, status, { error: { code: 'REQUEST_FAILED', requestId: 'test' } });
      };
      postArrived?.();
      return;
    }
    if (req.headers.accept === 'text/event-stream') return json(res, 404, {});
    if (url.pathname.endsWith('/today'))
      return json(res, 200, {
        pendingRequests: 0,
        rewardsReady: 0,
        today: { visits: 0, stamps: 0, redeemed: 0 },
        mine: { visits: 0, stamps: 0, redeemed: 0, firstAt: null },
      });
    return json(res, 200, { transactions: [], requests: [] });
  }
  let file = resolve(current.dir, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(current.dir + sep) || !(await stat(file).catch(() => null))?.isFile())
    file = join(current.dir, 'index.html');
  res.writeHead(200, {
    'Content-Type': types[extname(file)] || 'application/octet-stream',
    'Cache-Control': url.pathname === '/sw.js' ? 'no-cache' : 'no-store',
  });
  res.end(await readFile(file));
}
const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    console.error(error);
    res.writeHead(500).end();
  });
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
assert.ok(address && typeof address === 'object');
const origin = 'http://127.0.0.1:' + address.port;

// --- Browser --------------------------------------------------------------------------------
const browserName =
  process.env.NUQTA_E2E_BROWSER || (process.platform === 'win32' ? 'msedge' : 'chromium');
const browser = await chromium.launch({
  ...(browserName === 'msedge' ? { channel: 'msedge' } : {}),
  headless: true,
});
const context = await browser.newContext({ baseURL: origin });
context.setDefaultTimeout(20000);
// A string, not a function: tsx would inject a `__name` helper the page doesn't have.
// Headless tabs are always visible; this lets the test hide one the way a phone would.
await context.addInitScript(`
  localStorage.setItem('nuqta-language', 'en');
  let hidden = false;
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get() { return hidden; } });
  Object.defineProperty(Document.prototype, 'visibilityState', {
    configurable: true,
    get() { return hidden ? 'hidden' : 'visible'; },
  });
  window.__setHidden = function (value) {
    hidden = value;
    document.dispatchEvent(new Event('visibilitychange'));
  };
`);
const errors: string[] = [];
const loads = new Map<Page, number>();
async function open(path: string) {
  const page = await context.newPage();
  loads.set(page, 0);
  page.on('load', () => loads.set(page, loads.get(page)! + 1));
  page.on('pageerror', (error) => errors.push(error.message));
  if (process.env.PWA_DEBUG_SHOT) {
    page.on('console', (m) => console.log('[page ' + m.type() + '] ' + m.text()));
    page.on('requestfailed', (r) =>
      console.log('[failed] ' + r.url() + ' ' + r.failure()?.errorText),
    );
    page.on('response', (r) => r.status() >= 400 && console.log('[' + r.status() + '] ' + r.url()));
  }
  await page.goto(path);
  return page;
}
const release = (page: Page) => page.locator('meta[name="perks-release"]').getAttribute('content');
const setHidden = (page: Page, value: boolean) =>
  page.evaluate(
    (v) => (window as unknown as { __setHidden(v: boolean): void }).__setHidden(v),
    value,
  );
const cacheNames = (page: Page) =>
  page.evaluate(async () =>
    (await caches.keys()).filter((key) => key.startsWith('nuqta-shell-')).sort(),
  );
const settle = (page: Page) => page.waitForTimeout(1500);
// The worker records its release in activate, immediately before clients.claim().
const activeRelease = (page: Page) =>
  page.evaluate(async () => {
    const hit = await (await caches.open('nuqta-meta')).match('/active');
    return hit ? hit.text() : null;
  });
async function deploy(page: Page, next: typeof v1) {
  current = next;
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())!.update();
  });
  await page.waitForFunction(
    async (version) => {
      const hit = await (await caches.open('nuqta-meta')).match('/active');
      const reg = await navigator.serviceWorker.getRegistration();
      return (
        !!hit &&
        (await hit.text()) === version &&
        !reg?.waiting &&
        !reg?.installing &&
        navigator.serviceWorker.controller === reg?.active
      );
    },
    next.version,
    { polling: 200 },
  );
}
const noPrompt = async (page: Page) => {
  assert.equal(await page.getByRole('button', { name: /update now|حدّث دلوقتي/i }).count(), 0);
  assert.equal(await page.getByText(/update is ready|فيه تحديث جاهز/i).count(), 0);
};

try {
  // Release 1: first install claims the tab without treating it as an update.
  const cashier = await open('/cashier');
  await cashier.getByText('Restore a customer card').waitFor();
  await cashier.waitForFunction(() => !!navigator.serviceWorker.controller);
  await settle(cashier);
  assert.equal(loads.get(cashier), 1);
  assert.equal(await release(cashier), 'v1');
  assert.equal(await activeRelease(cashier), v1.version);
  ok('first install takes control without reloading');

  // Release 2 lands while the cashier is looking at the page: nothing visible happens.
  await deploy(cashier, v2);
  await settle(cashier);
  assert.equal(loads.get(cashier), 1, 'A visible tab is never reloaded under the user.');
  await noPrompt(cashier);
  assert.ok((await cacheNames(cashier)).includes(v2.cache));
  ok('release 2 activates silently (skipWaiting + clientsClaim), no prompt, no reload');

  // A write is in flight when the tab is hidden: the reload waits for the response.
  const arrived = new Promise<void>((done) => (postArrived = done));
  await cashier.getByRole('button', { name: 'Lock shift' }).click();
  await arrived;
  await setHidden(cashier, true);
  await settle(cashier);
  assert.equal(loads.get(cashier), 1, 'No reload while a POST is in flight.');
  assert.equal(await release(cashier), 'v1');
  ok('no reload while a POST is in flight');
  const reloaded = cashier.waitForEvent('load');
  heldPost!(500);
  await reloaded;
  assert.equal(loads.get(cashier), 2);
  assert.equal(await release(cashier), 'v2');
  assert.equal(new URL(cashier.url()).pathname, '/cashier');
  ok('hidden cashier tab reloads into release 2 once the POST settles');
  await cashier.getByText('Restore a customer card').waitFor();
  await settle(cashier);
  await settle(cashier);
  assert.equal(loads.get(cashier), 2, 'The new release does not reload itself again.');
  ok('no reload loop after the update applies');

  // A page outside the cashier/customer apps, open on release 2.
  const other = await open('/login');
  await other.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.equal(await release(other), 'v2');

  // The cashier is mid-flow (restoring a customer's card) when release 3 lands.
  await cashier.getByText('Restore a customer card').click();
  await cashier.locator('details.customer-recovery-tool[open]').waitFor();
  await deploy(cashier, v3);
  await other.waitForFunction(
    async () =>
      navigator.serviceWorker.controller ===
      (await navigator.serviceWorker.getRegistration())?.active,
  );
  await setHidden(cashier, true);
  await setHidden(other, true);
  await settle(cashier);
  assert.equal(loads.get(cashier), 2, 'No reload while the cashier is mid-flow.');
  assert.equal(await release(cashier), 'v2');
  await cashier.locator('details.customer-recovery-tool[open]').waitFor();
  ok('no reload while the cashier is mid-flow');
  assert.equal(loads.get(other), 1, 'Pages outside cashier/customer wait for navigation.');
  ok('hidden non-cashier/customer page does not reload');

  // Cache retention: exactly the replaced release (2) survives next to release 3.
  assert.deepEqual(await cacheNames(other), [v2.cache, v3.cache].sort());
  ok('activate keeps only the previous shell cache and deletes older ones');

  // The next in-app navigation on the other page applies release 3.
  await setHidden(other, false);
  const navigated = other.waitForEvent('load');
  await other.getByRole('button', { name: 'Perks home' }).click();
  await navigated;
  assert.equal(await release(other), 'v3');
  await settle(other);
  await settle(other);
  const settled = loads.get(other);
  await settle(other);
  assert.equal(loads.get(other), settled, 'No reload loop after navigation applies the update.');
  ok('next navigation loads release 3 with no reload loop');

  assert.deepEqual(errors, [], 'No page errors: ' + errors.join('; '));
  console.log('PWA silent update: all checks passed.');
} catch (error) {
  if (errors.length) console.error('Page errors: ' + errors.join(' | '));
  if (process.env.PWA_DEBUG_SHOT)
    for (const [i, page] of [...loads.keys()].entries())
      await page.screenshot({
        path: process.env.PWA_DEBUG_SHOT + '-' + i + '.png',
        fullPage: true,
      });
  throw error;
} finally {
  await browser.close();
  server.close();
  await rm(work, { recursive: true, force: true });
}
