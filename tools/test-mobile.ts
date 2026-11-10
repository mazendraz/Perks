import {
  chromium,
  webkit,
  devices,
  type Page,
  type BrowserContext,
  type Browser,
} from 'playwright';
import assert from 'node:assert/strict';
import { auditMobileBrand } from './mobile-brand-audit.js';
import { auditCustomerLoading } from './customer-load-audit.js';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { createServer, type AddressInfo } from 'node:net';
import fastifyStatic from '@fastify/static';
import { readConfig } from '../apps/api/src/config.js';
import { buildApp } from '../apps/api/src/server.js';
import { hashPassword } from '../apps/api/src/passwords.js';
const c = readConfig(),
  database = new URL(c.DATABASE_MIGRATOR_URL!);
assert.ok(['development', 'test'].includes(c.APP_ENV));
assert.equal(c.AUTH_PROVIDER, 'local');
assert.equal(database.hostname, '127.0.0.1');
assert.ok(['/nuqta_local', '/nuqta_ci'].includes(database.pathname));
for (const value of [c.DATABASE_URL, c.AUTH_DATABASE_URL]) {
  const url = new URL(value);
  assert.equal(url.hostname, database.hostname);
  assert.equal(url.pathname, database.pathname);
}
const reservation = createServer();
await new Promise<void>((ready, reject) => {
  reservation.once('error', reject);
  reservation.listen(0, '127.0.0.1', ready);
});
const port = (reservation.address() as AddressInfo).port;
await new Promise<void>((ready, reject) =>
  reservation.close((error) => (error ? reject(error) : ready())),
);
const origin = 'http://127.0.0.1:' + port,
  stamp = Date.now(),
  password = 'Mobile-' + randomBytes(18).toString('hex');
const db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
const { app } = await buildApp({
  APP_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: port,
  PUBLIC_APP_ORIGIN: origin,
  // Controlled loopback proxy fixture supplies unique documentation-only
  // client IPs, so persistent abuse guards remain real across repeated runs.
  TRUSTED_PROXIES: '127.0.0.1/32',
  LOG_LEVEL: 'silent',
});
const directory = 'docs/execution/evidence/implementation',
  browsers: Browser[] = [];
const report: {
  at: string;
  status: string;
  build?: string;
  indexSha256?: string;
  checks: string[];
  projects: string[];
  installabilityErrors?: unknown[];
  reason?: string;
} = { at: new Date().toISOString(), status: 'running', checks: [], projects: [] };
let phase = 'setup',
  workerGeneration = 0;
const pass = (message: string) => {
  report.checks.push(message);
  console.log('PASS ' + message);
};
const errorStatusCounts: Record<string, number> = {};
app.addHook('onResponse', async (_req, reply) => {
  if (reply.statusCode >= 400)
    errorStatusCounts[String(reply.statusCode)] =
      (errorStatusCounts[String(reply.statusCode)] ?? 0) + 1;
});
app.get('/sw.js', { config: { rateLimit: false } }, async (_req, reply) => {
  let source = await readFile(resolve('apps/web/dist/sw.js'), 'utf8');
  if (workerGeneration)
    source = source.replace(
      /const VERSION = "([^"]+)";/,
      (_match, version: string) =>
        'const VERSION = ' + JSON.stringify(version + '-test-' + workerGeneration) + ';',
    );
  return reply.type('application/javascript').header('Cache-Control', 'no-cache').send(source);
});
// Production serves public files in Caddy, outside the API limiter. Only this
// fixture's explicit static routes opt out; actual API limits stay intact.
await app.register(fastifyStatic, { root: resolve('apps/web/dist'), serve: false });
app.get('/*', { config: { rateLimit: false } }, (req, reply) => {
  const path = new URL(req.url, origin).pathname;
  if (/^\/(api|health|internal)(\/|$)/.test(path))
    return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
  return reply.sendFile(/\.[a-z0-9]+$/i.test(path) ? path.slice(1) : 'index.html');
});
async function checkLayout(page: Page, label: string) {
  await page.evaluate(() => document.fonts.ready);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
    label + ' horizontal overflow',
  );
  const small = await page
    .locator('button:visible:not(:disabled),a.primary:visible,a.secondary:visible')
    .evaluateAll((elements) =>
      elements
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width < 43.5 || r.height < 43.5;
        })
        .map((el) => el.tagName + ':' + el.className),
    );
  assert.deepEqual(small, [], label + ' touch targets');
  const clipped = await page
    .locator('button:visible, [role="option"]:visible')
    .evaluateAll((elements) =>
      elements
        .filter(
          (el) => el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2,
        )
        .map((el) => ({
          text: el.textContent?.trim().slice(0, 90),
          width: el.clientWidth,
          contentWidth: el.scrollWidth,
          height: el.clientHeight,
          contentHeight: el.scrollHeight,
        })),
    );
  assert.deepEqual(clipped, [], label + ' clipped control content');
}
async function login(page: Page, email: string) {
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
async function watch(context: BrowserContext) {
  await context.addInitScript('window.__name = function(value) { return value; }');
  await context.addInitScript(() => {
    const state = window as unknown as {
      policyViolations: string[];
      policyViolationDetails: {
        directive: string;
        blocked: string;
        source: string;
        line: number;
      }[];
    };
    state.policyViolations = [];
    state.policyViolationDetails = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      const resource = (value: string) => {
        if (['inline', 'eval', 'wasm-eval', ''].includes(value)) return value;
        try {
          const name = new URL(value).pathname.split('/').pop() || '';
          return /\.(js|css)$/.test(name) ? name : '[document or resource]';
        } catch {
          return '[resource]';
        }
      };
      state.policyViolations.push(event.effectiveDirective);
      state.policyViolationDetails.push({
        directive: event.effectiveDirective,
        blocked: resource(event.blockedURI),
        source: resource(event.sourceFile),
        line: event.lineNumber,
      });
    });
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'showPopover', {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(window, 'ResizeObserver', { value: undefined, configurable: true });
    Object.defineProperty(Animation.prototype, 'finished', {
      get: () => undefined,
      configurable: true,
    });
  });
}
try {
  await mkdir(directory, { recursive: true });
  await db.connect();
  report.build = JSON.parse(await readFile('apps/web/dist/shell-build.json', 'utf8')).version;
  report.indexSha256 = createHash('sha256')
    .update(await readFile('apps/web/dist/index.html'))
    .digest('hex');
  await app.listen({ port, host: '127.0.0.1' });
  const adminEmail = 'mobile-admin-' + stamp + '@nuqta.test';
  await db.query(
    "INSERT INTO users(email,display_name,global_role,password_hash,password_version) VALUES($1,'Synthetic mobile admin','platform_admin',$2,1)",
    [adminEmail, await hashPassword(password, c.AUTH_PEPPER)],
  );
  const signed = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email: adminEmail, password },
  });
  assert.equal(signed.statusCode, 200);
  const headers = {
    origin,
    cookie: signed.cookies.map((item) => item.name + '=' + item.value).join('; '),
    'x-csrf-token': signed.json().csrfToken,
  };
  const slug = 'mobile-' + stamp,
    ownerEmail = 'mobile-owner-' + stamp + '@nuqta.test',
    cashierEmail = 'mobile-cashier-' + stamp + '@nuqta.test';
  const data = {
    name: 'Mobile QA Coffee',
    slug,
    contactEmail: ownerEmail,
    timezone: 'Africa/Cairo',
    primaryColor: '#204C41',
    accentColor: '#D4AD68',
    surfaceColor: '#F9F5EA',
    template: 'espresso',
    logoStyle: 'plain',
    logoSize: 60,
    stampShape: 'seal',
    stampIcon: 'coffee',
    stampStyle: 'outline',
    terms: 'Synthetic mobile enrollment terms.',
    program: {
      name: 'Visits',
      threshold: 5,
      maxPerTx: 3,
      rewardTitle: 'Free coffee',
      rewardTerms: 'One coffee within thirty days.',
      validityDays: 30,
      endsAt: null,
    },
    branches: [{ name: 'Mobile branch', address: 'Synthetic only' }],
    staff: [
      { email: ownerEmail, role: 'owner', branchIndexes: [0], maxQty: 3, accessMode: 'password' },
      {
        email: cashierEmail,
        role: 'cashier',
        branchIndexes: [0],
        maxQty: 2,
        accessMode: 'password',
      },
    ],
    plan: 'growth',
  };
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/platform/provisioning-drafts',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: { data },
  });
  assert.equal(created.statusCode, 200);
  const draft = created.json().draft,
    base = '/api/v1/platform/provisioning-drafts/' + draft.id;
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: base + '/credentials',
        headers,
        payload: {
          revision: draft.revision,
          accounts: data.staff.map((staff) => ({ email: staff.email, password })),
        },
      })
    ).statusCode,
    200,
  );
  const activated = await app.inject({
    method: 'POST',
    url: base + '/activate',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: { draftRevision: draft.revision },
  });
  assert.equal(activated.statusCode, 200);
  const fixture = activated.json(),
    branch = fixture.branches[0].id;
  const placement = (
    await db.query(
      "SELECT public_code FROM placements WHERE branch_id=$1 AND resolve_placement(public_code)->>'status'='active' ORDER BY created_at LIMIT 1",
      [branch],
    )
  ).rows[0];
  assert.ok(placement, 'provisioned branch must have its generated active QR');
  for (const project of [
    { name: 'chromium-pixel5', type: chromium, device: 'Pixel 5' },
    { name: 'webkit-iphone12', type: webkit, device: 'iPhone 12' },
  ]) {
    phase = project.name;
    report.projects.push(project.name);
    const browser = await project.type.launch({ headless: true });
    browsers.push(browser);
    const customer = await browser.newContext({
      ...devices[project.device],
      locale: 'en-US',
      baseURL: origin,
      extraHTTPHeaders: {
        'x-forwarded-for': '2001:db8:' + randomBytes(12).toString('hex').match(/.{4}/g)!.join(':'),
      },
      // WebKit routes bypass requests controlled by a service worker. Isolate
      // its network-fault fixture; Chromium below exercises the actual SW.
      serviceWorkers: project.type === webkit ? 'block' : 'allow',
    });
    const cashier = await browser.newContext({
      ...devices[project.device],
      locale: 'en-US',
      baseURL: origin,
    });
    await watch(customer);
    await watch(cashier);
    const page = await customer.newPage(),
      cp = await cashier.newPage(),
      errors: string[] = [];
    for (const target of [page, cp])
      target.on('pageerror', (error) => {
        errors.push(error.message);
        console.error(
          'MOBILE_PAGE_ERROR ' +
            JSON.stringify({
              project: project.name,
              screen: new URL(target.url()).pathname,
              message: error.message,
              stack: error.stack,
              at: new Date().toISOString(),
            }),
        );
      });
    const firstVisitStarted = Date.now(),
      customerPhone = '+2010' + String(randomBytes(4).readUInt32BE()).padStart(10, '0').slice(-8);
    await page.goto(origin + '/join/' + slug + '?b=' + branch + '&src=qr', {
      waitUntil: 'domcontentloaded',
    });
    await page.getByLabel('Your name', { exact: true }).waitFor();
    await checkLayout(page, project.name + ' registration English');
    await page.screenshot({
      path: directory + '/mobile-' + project.name + '-register-en.png',
      fullPage: true,
    });
    await page.getByRole('button', { name: 'العربية', exact: true }).click();
    await page.getByLabel('رقم موبايلك', { exact: true }).waitFor();
    await checkLayout(page, project.name + ' registration Arabic');
    await page.screenshot({
      path: directory + '/mobile-' + project.name + '-register-ar.png',
      fullPage: true,
    });
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.getByLabel('Your name', { exact: true }).fill('Mobile QA');
    await page.getByLabel('Mobile number', { exact: true }).fill(customerPhone);
    assert.equal(await page.locator('form input[type=email],form input[type=password]').count(), 0);
    await page
      .getByLabel('I accept the program, reward and privacy terms', { exact: true })
      .check();
    await page.getByRole('button', { name: 'Open my card', exact: true }).click();
    await page.getByRole('progressbar', { name: 'Stamp progress', exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        !document
          .getAnimations()
          .some(
            (animation) => animation.id === 'nuqta-first-card' && animation.playState === 'running',
          ),
    );
    assert.ok(
      Date.now() - firstVisitStarted < 30000,
      'new customer reaches the card in under 30 seconds locally',
    );
    await checkLayout(page, project.name + ' customer');
    await page.screenshot({
      path: directory + '/mobile-' + project.name + '-customer-en.png',
      fullPage: true,
    });
    pass(
      project.name +
        ': name/phone/terms registration survives Arabic/English switching, reaches the card within 30 seconds, and needs no email/password or UUID/Popover/ResizeObserver/Animation.finished',
    );
    const newcomer = await browser.newContext({
      ...devices[project.device],
      locale: 'en-US',
      baseURL: origin,
      extraHTTPHeaders: {
        'x-forwarded-for': '2001:db8:' + randomBytes(12).toString('hex').match(/.{4}/g)!.join(':'),
      },
    });
    await watch(newcomer);
    await newcomer.addInitScript(() => {
      const motions: Animation[] = [];
      (window as unknown as { firstCardMotions: Animation[] }).firstCardMotions = motions;
      const original = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        const result = original.call(this, frames, options);
        motions.push(result);
        return result;
      };
    });
    const firstPage = await newcomer.newPage(),
      firstPhone = '+2011' + String(randomBytes(4).readUInt32BE()).padStart(10, '0').slice(-8),
      firstStarted = Date.now();
    await firstPage.goto(origin + '/p/' + placement.public_code + '?src=nfc', {
      waitUntil: 'domcontentloaded',
    });
    await firstPage.getByLabel('Your name', { exact: true }).fill('First NFC QA');
    assert.equal(await firstPage.locator('form input').count(), 3);
    await firstPage.getByLabel('Mobile number', { exact: true }).fill(firstPhone);
    await firstPage
      .getByLabel('I accept the program, reward and privacy terms', { exact: true })
      .check();
    await firstPage.getByRole('button', { name: 'Open my card', exact: true }).click();
    await firstPage.getByRole('dialog', { name: 'Personal QR', exact: true }).waitFor();
    assert.ok(Date.now() - firstStarted < 30000);
    await firstPage.waitForFunction(() => !new URLSearchParams(location.search).has('auto'));
    const firstMember = new URL(firstPage.url()).pathname.split('/').at(-1)!;
    const placementContext = new URL(firstPage.url()).searchParams;
    assert.equal(placementContext.get('b'), branch);
    assert.equal(placementContext.get('code'), placement.public_code);
    assert.equal(placementContext.get('src'), 'nfc');
    const reveal = await firstPage.evaluate(
      () =>
        (window as unknown as { firstCardMotions: Animation[] }).firstCardMotions
          .find((motion) => motion.id === 'nuqta-first-card')
          ?.effect?.getTiming().duration,
    );
    assert.equal(reveal, 720);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM stamp_requests WHERE membership_id=$1 AND status='pending'",
          [firstMember],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (await db.query('SELECT balance FROM loyalty_accounts WHERE membership_id=$1', [firstMember]))
        .rows[0].balance,
      0,
    );
    await newcomer.close();
    pass(
      project.name +
        ': first NFC scan needs only name/phone/terms/submit, preserves context, reveals the card in 720ms and requests one first stamp without granting it',
    );
    if (project.type === webkit) {
      const guide = page.getByRole('dialog', { name: 'Save your card', exact: true });
      await guide.waitFor();
      assert.equal(await guide.getByRole('img').count(), 2);
      await guide.getByRole('button', { name: 'Got it', exact: true }).click();
    } else {
      await page.evaluate(() => {
        const state = { calls: 0 };
        (window as unknown as { installTest: typeof state }).installTest = state;
        const event = new Event('beforeinstallprompt', { cancelable: true });
        Object.defineProperty(event, 'prompt', {
          value: async () => {
            state.calls++;
          },
        });
        Object.defineProperty(event, 'userChoice', {
          value: Promise.resolve({ outcome: 'dismissed' }),
        });
        window.dispatchEvent(event);
      });
      await page.getByRole('button', { name: 'Save to home screen', exact: true }).click();
      assert.equal(
        await page.evaluate(
          () => (window as unknown as { installTest: { calls: number } }).installTest.calls,
        ),
        1,
      );
    }
    pass(
      project.name +
        ': first home-screen offer uses the native prompt or the two-step Safari illustration',
    );
    const memberId = new URL(page.url()).pathname.split('/').at(-1)!;
    let lostRequest = false,
      expiredDuringRequest = false,
      interruptedBeforeCommit = false;
    const autoKeys: string[] = [];
    const interruptRequest = async (route: import('playwright').Route) => {
      if (route.request().method() === 'POST') {
        autoKeys.push(route.request().headers()['idempotency-key']!);
        if (!interruptedBeforeCommit) {
          interruptedBeforeCommit = true;
          await route.abort('failed');
          return;
        }
        if (!expiredDuringRequest) {
          expiredDuringRequest = true;
          await db.query(
            "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=(SELECT user_id FROM memberships WHERE id=$1)",
            [memberId],
          );
          await route.continue();
          return;
        }
        if (!lostRequest) {
          lostRequest = true;
          const saved = await route.fetch();
          assert.equal(saved.status(), 200);
          await route.abort('failed');
          return;
        }
      }
      await route.continue();
    };
    await page.route('**/api/v1/me/stamp-requests', interruptRequest);
    await page.addInitScript(() => {
      (window as unknown as { placementClicks: number }).placementClicks = 0;
      document.addEventListener('click', () => {
        (window as unknown as { placementClicks: number }).placementClicks++;
      });
    });
    for (let scan = 0; scan < 5; scan++) {
      await page.goto(origin + '/p/' + placement.public_code + '?src=qr', {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForURL('**/customer/' + memberId + '?**');
      if (scan === 0) {
        try {
          await page
            .getByText('You’re offline. We’ll send the request when you reconnect.', {
              exact: true,
            })
            .waitFor({ timeout: 6000 });
        } catch (error) {
          console.log(
            JSON.stringify({
              interruptionDiagnostics: project.name,
              attempts: autoKeys.length,
              beforeCommit: interruptedBeforeCommit,
              afterCommit: lostRequest,
              alerts: await page.getByRole('alert').allTextContents(),
              qrOpen: await page.getByRole('dialog', { name: 'Personal QR', exact: true }).count(),
            }),
          );
          throw error;
        }
      }
      await page.locator('.match-code').waitFor();
      await page.waitForFunction(() => !new URLSearchParams(location.search).has('auto'));
      assert.equal(
        await page.evaluate(
          () => (window as unknown as { placementClicks: number }).placementClicks,
        ),
        0,
      );
    }
    await page.unroute('**/api/v1/me/stamp-requests', interruptRequest);
    assert.equal(lostRequest, true);
    assert.ok(autoKeys.length >= 4);
    assert.equal(autoKeys[0], autoKeys[1]);
    assert.equal(autoKeys[1], autoKeys[2]);
    assert.equal(new Set(autoKeys).size, 1);
    assert.equal(
      (
        await db.query('SELECT count(*)::int AS n FROM stamp_requests WHERE membership_id=$1', [
          memberId,
        ])
      ).rows[0].n,
      1,
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.match-code').waitFor();
    assert.equal(
      (
        await db.query('SELECT count(*)::int AS n FROM stamp_requests WHERE membership_id=$1', [
          memberId,
        ])
      ).rows[0].n,
      1,
    );
    await page.getByRole('button', { name: 'Close code', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel request', exact: true }).click();
    await page.getByRole('button', { name: 'Request stamp', exact: true }).waitFor();
    pass(
      project.name +
        ': five placement scans open the existing card with zero customer taps, create one request, and reload creates none',
    );
    pass(
      project.name +
        ': interruption, session expiry during POST and a lost committed reply restore the device session and retry the same request key without a duplicate',
    );
    let firstToken = '';
    await page.route(
      '**/presentation-tokens',
      async (route) => {
        const response = await route.fetch(),
          value = await response.json();
        firstToken = value.token;
        await route.fulfill({
          response,
          json: { ...value, expiresAt: new Date(Date.now() + 21000).toISOString() },
        });
      },
      { times: 1 },
    );
    await page.getByRole('button', { name: 'Show my code', exact: true }).click();
    await page.locator('.qr-panel code').waitFor();
    assert.notEqual(firstToken, '');
    await page.waitForFunction((old) => {
      const code = document.querySelector('.qr-panel code')?.textContent;
      return !!code && code !== old;
    }, firstToken);
    pass(
      project.name +
        ': a shortened display-expiry fixture refreshes the QR automatically before expiration',
    );
    const token = (await page.locator('.qr-panel code').textContent())!.trim();
    await login(cp, cashierEmail);
    await cp.locator('[data-portal="cashier"]').waitFor();
    await cp.getByRole('button', { name: 'Scan card', exact: true }).click();
    const scanViewport = cp.viewportSize()!;
    for (const language of ['en', 'ar']) {
      if (language === 'ar') await cp.getByRole('button', { name: 'العربية', exact: true }).click();
      for (const width of [320, 390, 430]) {
        await cp.setViewportSize({ width, height: 844 });
        await checkLayout(cp, `${project.name} ${language} ${width}px scan actions`);
        const cameraButton = cp.getByRole('button', {
          name: language === 'ar' ? 'افتح الكاميرا' : 'Open camera',
          exact: true,
        });
        assert.equal(
          await cameraButton.locator('svg[data-icon="camera"][aria-hidden="true"]').count(),
          1,
        );
        if (width === 390)
          await cp.screenshot({
            path: `${directory}/mobile-icons-${project.name}-${language}.png`,
            fullPage: true,
          });
      }
    }
    await cp.getByRole('button', { name: 'English', exact: true }).click();
    await cp.setViewportSize(scanViewport);
    pass(
      project.name +
        ': labeled camera and manual scan actions remain readable with icons at 320/390/430px in both languages',
    );
    await cp.getByLabel('Or enter the customer card code', { exact: true }).fill(token);
    await cp.getByRole('button', { name: 'Read code', exact: true }).click();
    await cp.getByRole('button', { name: 'Add stamps', exact: true }).click();
    await cp
      .getByLabel('Receipt number', { exact: true })
      .fill('MOBILE-' + stamp + '-' + project.name);
    await cp.getByRole('button', { name: 'Review award', exact: true }).click();
    const stampStarted = Date.now();
    await cp.getByRole('button', { name: 'Confirm stamps', exact: true }).click();
    await cp.getByText('Saved balance: 1', { exact: true }).waitFor();
    await page.waitForFunction(
      () => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === '1',
    );
    assert.ok(
      Date.now() - stampStarted < 1000,
      'first committed stamp must be visible in under one second locally',
    );
    await page
      .getByRole('dialog', { name: 'Personal QR', exact: true })
      .waitFor({ state: 'hidden' });
    if (project.type === webkit) {
      const guide = page.getByRole('dialog', { name: 'Save your card', exact: true });
      await guide.waitFor();
      await guide.getByRole('button', { name: 'Got it', exact: true }).click();
    } else await page.getByRole('button', { name: 'Not now', exact: true }).click();
    const angles = await page.locator('.filled .nq-stamp-ink').evaluateAll((elements) =>
      elements.map((el) => ({
        seed: el.getAttribute('data-ink-seed'),
        angle: el.getAttribute('data-ink-angle'),
      })),
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('progressbar', { name: 'Stamp progress', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Not now', exact: true }).count(), 0);
    assert.equal(
      await page.getByRole('dialog', { name: 'Save your card', exact: true }).count(),
      0,
    );
    assert.deepEqual(
      await page.locator('.filled .nq-stamp-ink').evaluateAll((elements) =>
        elements.map((el) => ({
          seed: el.getAttribute('data-ink-seed'),
          angle: el.getAttribute('data-ink-angle'),
        })),
      ),
      angles,
    );
    pass(
      project.name +
        ': QR closes on the committed stamp, ink angles survive reload, and home-screen offers stop after the second dismissal',
    );
    const standalone = await browser.newContext({
      ...devices[project.device],
      locale: 'en-US',
      storageState: { cookies: (await customer.storageState()).cookies, origins: [] },
    });
    await watch(standalone);
    await standalone.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        const result = original(query);
        if (query === '(display-mode: standalone)')
          Object.defineProperty(result, 'matches', { value: true });
        return result;
      };
    });
    const installedPage = await standalone.newPage();
    await installedPage.goto(origin + '/customer/' + memberId);
    await installedPage.getByRole('progressbar', { name: 'Stamp progress', exact: true }).waitFor();
    assert.equal(await installedPage.locator('.install-card-offer,.install-card-guide').count(), 0);
    await standalone.close();
    pass(
      project.name +
        ': a standalone app suppresses installation offers even without stored offer history',
    );
    await checkLayout(cp, project.name + ' cashier');
    await cp.screenshot({
      path: directory + '/mobile-' + project.name + '-cashier-en.png',
      fullPage: true,
    });
    pass(
      project.name +
        ': cashier manual QR input commits one stamp and updates the actual customer balance',
    );
    if (project.type === chromium) {
      await cp.evaluate('window.__name = function(value) { return value; }');
      await cp.evaluate(() => {
        const state = {
          hidden: false,
          deferred: false,
          opened: 0,
          stopped: 0,
          constraints: {} as MediaStreamConstraints,
          resolve: undefined as undefined | (() => void),
        };
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => state.hidden });
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          state.opened++;
          state.constraints = constraints!;
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 64;
          const draw = () => canvas.getContext('2d')!.fillRect(0, 0, 64, 64);
          const timer = window.setInterval(draw, 50);
          draw();
          const stream = canvas.captureStream(10);
          for (const track of stream.getTracks()) {
            const stop = track.stop.bind(track);
            track.stop = () => {
              state.stopped++;
              window.clearInterval(timer);
              stop();
            };
          }
          if (state.deferred)
            await new Promise<void>((resolve) => {
              state.resolve = resolve;
            });
          return stream;
        };
        (window as unknown as { cameraTest: typeof state }).cameraTest = state;
      });
      await cp.getByRole('button', { name: 'Next customer', exact: true }).click();
      await cp.getByRole('button', { name: 'Open camera', exact: true }).click();
      await cp.waitForFunction(() => !!document.querySelector('video')?.srcObject);
      assert.deepEqual(
        await cp.evaluate(
          () =>
            (window as unknown as { cameraTest: { constraints: unknown } }).cameraTest.constraints,
        ),
        { audio: false, video: { facingMode: { ideal: 'environment' } } },
      );
      assert.equal(
        await cp.locator('video').evaluate((v: HTMLVideoElement) => v.muted && v.playsInline),
        true,
      );
      await cp.evaluate(() => {
        (window as unknown as { cameraTest: { hidden: boolean } }).cameraTest.hidden = true;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await cp.waitForFunction(
        () =>
          (window as unknown as { cameraTest: { stopped: number } }).cameraTest.stopped > 0 &&
          !document.querySelector('video'),
      );
      await cp.evaluate(() => {
        const state = (
          window as unknown as {
            cameraTest: { hidden: boolean; deferred: boolean; stopped: number };
          }
        ).cameraTest;
        state.hidden = false;
        state.deferred = true;
        state.stopped = 0;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await cp.getByRole('button', { name: 'Open camera', exact: true }).click();
      await cp.waitForFunction(
        () => (window as unknown as { cameraTest: { opened: number } }).cameraTest.opened === 2,
      );
      await cp.evaluate(() => {
        const state = (
          window as unknown as { cameraTest: { hidden: boolean; resolve: () => void } }
        ).cameraTest;
        state.hidden = true;
        document.dispatchEvent(new Event('visibilitychange'));
        state.resolve();
      });
      await cp.waitForFunction(
        () =>
          (window as unknown as { cameraTest: { stopped: number } }).cameraTest.stopped > 0 &&
          !document.querySelector('video'),
      );
      await cp.evaluate(() => {
        (window as unknown as { cameraTest: { hidden: boolean } }).cameraTest.hidden = false;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      assert.equal(await cp.locator('video').count(), 0);
      pass(
        'Camera synthetic stream: rear-camera constraint, muted/playsInline, tracks stopped on hide and after late permission; no auto-resume',
      );
    }
    await auditCustomerLoading(page, project.name, directory);
    pass(
      project.name +
        ': saved cards and the Wallet panel remain available while redemption confirmations are delayed',
    );
    const owner = await browser.newContext({
      ...devices[project.device],
      locale: 'en-US',
      baseURL: origin,
    });
    await watch(owner);
    const op = await owner.newPage();
    op.on('pageerror', (error) => errors.push(error.message));
    await login(op, ownerEmail);
    await op.locator('[data-portal="merchant"]').waitFor();
    const period = op.getByRole('combobox', { name: 'Period', exact: true });
    await period.click();
    await op.getByRole('option', { name: 'Last 7 days', exact: true }).click();
    assert.equal(await period.getAttribute('data-value'), '7');
    await op
      .getByRole('navigation', { name: 'Business sections', exact: true })
      .getByRole('button', { name: 'Business', exact: true })
      .click();
    await op.getByRole('button', { name: 'Team', exact: true }).click();
    await op.locator('.account-security tbody tr').first().waitFor();
    await op.getByRole('button', { name: 'العربية', exact: true }).click();
    const accounts = op.locator('.account-security');
    const roleCells = accounts.locator('td:nth-child(2)');
    await roleCells.filter({ hasText: /^مالك/ }).waitFor();
    assert.equal(await roleCells.filter({ hasText: /^مالك/ }).count(), 1);
    assert.ok((await accounts.getByText('نشط', { exact: true }).count()) > 0);
    assert.equal(await roleCells.filter({ hasText: /^owner(?:\s|$)/ }).count(), 0);
    assert.equal(await accounts.getByText('active', { exact: true }).count(), 0);
    await checkLayout(op, project.name + ' Arabic team');
    assert.deepEqual(
      await accounts
        .locator('td')
        .evaluateAll((cells) =>
          cells
            .filter((cell) => cell.scrollWidth > cell.clientWidth + 1)
            .map((cell) => cell.getAttribute('data-label')),
        ),
      [],
    );
    await op.getByRole('button', { name: 'English', exact: true }).click();
    await checkLayout(op, project.name + ' English team');
    pass(
      project.name +
        ': staff accounts localize roles/status and fit mobile cards without clipped cells in both languages',
    );
    await op.getByRole('button', { name: 'Add staff account', exact: true }).click();
    const dialog = op.getByRole('dialog', { name: 'Add staff account', exact: true });
    await dialog.waitFor();
    await dialog.getByRole('combobox', { name: 'Role', exact: true }).click();
    await op.getByRole('option', { name: 'Manager', exact: true }).click();
    assert.equal(
      await dialog.getByRole('combobox', { name: 'Role', exact: true }).getAttribute('data-value'),
      'manager',
    );
    await dialog.getByRole('combobox', { name: 'Role', exact: true }).press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    for (const language of ['en', 'ar'] as const) {
      if (language === 'ar') await op.getByRole('button', { name: 'العربية', exact: true }).click();
      for (const section of language === 'ar'
        ? ['المتابعة', 'العملاء']
        : ['Activity', 'Customers']) {
        await op
          .getByRole('navigation', {
            name: language === 'ar' ? 'أقسام المحل' : 'Business sections',
            exact: true,
          })
          .getByRole('button', { name: section, exact: true })
          .click();
        const records = op.locator('.mobile-records');
        await records.waitFor();
        assert.equal(await records.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true);
        assert.deepEqual(
          await records
            .locator('td')
            .evaluateAll((cells) =>
              cells
                .filter(
                  (cell) =>
                    !cell.getAttribute('data-label') || cell.scrollWidth > cell.clientWidth + 1,
                )
                .map((cell) => cell.getAttribute('data-label')),
            ),
          [],
        );
        await checkLayout(op, project.name + ' ' + language + ' ' + section);
        const firstRecord = records.locator('tbody tr').first();
        await firstRecord.scrollIntoViewIfNeeded();
        await op.screenshot({
          path:
            directory +
            '/mobile-records-' +
            project.name +
            '-' +
            language +
            '-' +
            (section === 'المتابعة' || section === 'Activity' ? 'operations' : 'customers') +
            '.png',
        });
      }
    }
    pass(
      project.name +
        ': transaction and customer records have labeled mobile cells with no internal or page horizontal overflow in either language',
    );
    await auditMobileBrand(op, project.name, directory);
    pass(
      project.name +
        ': owner card editor fits 320/360/390/430/768px in Arabic/English, keeps complete template artwork and Arabic initials, and never covers a focused field',
    );
    pass(
      project.name +
        ': fallback portaled select responds to touch and remains usable in a keyboard-managed modal without native Popover or ResizeObserver',
    );
    for (const [label, target] of [
      ['customer', page],
      ['cashier', cp],
      ['owner', op],
    ] as const)
      assert.deepEqual(
        await target.evaluate(
          () => (window as unknown as { policyViolations: string[] }).policyViolations,
        ),
        [],
        label +
          ' CSP diagnostics: ' +
          JSON.stringify(
            await target.evaluate(
              () =>
                (window as unknown as { policyViolationDetails: unknown[] }).policyViolationDetails,
            ),
          ),
      );
    assert.deepEqual(errors, []);
    await owner.close();
    pass(project.name + ': no CSP violations or page errors with production-built scripts');
    for (const target of [page, cp]) {
      await target.getByRole('button', { name: 'العربية', exact: true }).click();
      await checkLayout(target, project.name + ' Arabic');
    }
    await page.screenshot({
      path: directory + '/mobile-' + project.name + '-customer-ar.png',
      fullPage: true,
    });
    await cp.screenshot({
      path: directory + '/mobile-' + project.name + '-cashier-ar.png',
      fullPage: true,
    });
    if (project.type === chromium) {
      await page.getByRole('button', { name: 'English', exact: true }).click();
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      const apiResponse = await page.evaluate(async () => {
        const r = await fetch('/api/v1/me/memberships', {
          headers: { 'x-nuqta-workspace': 'customer' },
        });
        return { status: r.status, cache: r.headers.get('cache-control') };
      });
      assert.equal(apiResponse.status, 200);
      assert.equal(apiResponse.cache, 'no-store');
      const cdp = await customer.newCDPSession(page);
      await cdp.send('Page.enable');
      report.installabilityErrors = (
        await cdp.send('Page.getInstallabilityErrors')
      ).installabilityErrors;
      assert.deepEqual(report.installabilityErrors, []);
      assert.equal(
        await page.locator('meta[name="mobile-web-app-capable"]').getAttribute('content'),
        'yes',
      );
      assert.equal(
        await page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute('content'),
        'yes',
      );
      pass(
        'Chromium: browser installability checks return no errors (current replacement for retired Lighthouse PWA audit)',
      );
      const cached = await page.evaluate(async () => {
        const all: string[] = [];
        for (const key of await caches.keys())
          for (const request of await (await caches.open(key)).keys()) all.push(request.url);
        return all;
      });
      assert.ok(cached.length > 0);
      assert.ok(
        cached.every((url) => {
          const value = new URL(url);
          return !value.search && !/^\/(api|health|internal)(\/|$)/.test(value.pathname);
        }),
      );
      await customer.setOffline(true);
      assert.equal(
        await page.evaluate(() =>
          fetch('/api/v1/me/memberships', { headers: { 'x-nuqta-workspace': 'customer' } }).then(
            () => true,
            () => false,
          ),
        ),
        false,
      );
      await page.reload({ waitUntil: 'domcontentloaded' });
      try {
        await page
          .getByText('You’re offline. Reconnect to continue.', { exact: true })
          .waitFor({ timeout: 10000 });
      } catch (error) {
        console.log(
          'Offline late diagnostics ' +
            JSON.stringify(
              await page.evaluate(() => ({
                online: navigator.onLine,
                ready: document.documentElement.dataset.nuqtaReady,
                rootEmpty: !document.getElementById('root')?.textContent,
                violations: (window as unknown as { policyViolations: string[] }).policyViolations,
              })),
            ) +
            ' errors=' +
            JSON.stringify(errors),
        );
        throw error;
      }
      await customer.setOffline(false);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('progressbar', { name: 'Stamp progress', exact: true }).waitFor();
      pass(
        'PWA: offline shell opens while API responses remain network-only and absent from CacheStorage',
      );
      workerGeneration++;
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.getRegistration())!.update();
      });
      await page.getByRole('button', { name: 'Update now', exact: true }).waitFor();
      await Promise.all([
        page.waitForEvent('load'),
        page.getByRole('button', { name: 'Update now', exact: true }).click(),
      ]);
      await page.getByRole('progressbar', { name: 'Stamp progress', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Update now', exact: true }).count(), 0);
      pass(
        'PWA: a waiting update activates and reloads after the user taps Update now, preserving the authenticated card',
      );
    }
    if (project.type === webkit)
      await page.getByRole('button', { name: 'English', exact: true }).click();
    const placementState = (
      await db.query('SELECT status FROM placements WHERE public_code=$1', [placement.public_code])
    ).rows[0].status;
    try {
      await db.query("UPDATE branches SET status='disabled' WHERE id=$1", [branch]);
      await page.goto(origin + '/p/' + placement.public_code + '?src=nfc');
      await page.getByRole('alert').filter({ hasText: 'This shop code is unavailable.' }).waitFor();
      assert.ok(
        !/[A-Z]{3,}_|[a-f0-9]{8}-[a-f0-9]{4}-/.test(await page.getByRole('alert').innerText()),
      );
      await db.query("UPDATE branches SET status='active' WHERE id=$1", [branch]);
      await db.query("UPDATE placements SET status='revoked' WHERE public_code=$1", [
        placement.public_code,
      ]);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('alert').filter({ hasText: 'This shop code was replaced.' }).waitFor();
      assert.ok(
        !/[A-Z]{3,}_|[a-f0-9]{8}-[a-f0-9]{4}-/.test(await page.getByRole('alert').innerText()),
      );
      assert.equal(await page.locator('.match-code').count(), 0);
    } finally {
      await db.query("UPDATE branches SET status='active' WHERE id=$1", [branch]);
      await db.query('UPDATE placements SET status=$2 WHERE public_code=$1', [
        placement.public_code,
        placementState,
      ]);
    }
    pass(
      project.name +
        ': paused branches and revoked NFC placements show plain guidance without technical codes or creating a request',
    );
    await customer.close();
    await cashier.close();
  }
  const browser = browsers[0]!;
  for (const name of ['iPhone SE', 'Pixel 5', 'Galaxy S8']) {
    phase = 'layout-' + name;
    const engine = name === 'iPhone SE' ? browsers[1]! : browser;
    const context = await engine.newContext({
      ...devices[name],
      locale: 'en-US',
      baseURL: origin,
      // Playwright's historical SE/S8 descriptors ship unsupported iOS10/Android7 UAs.
      // Keep their small viewports, with supported OS UAs; this is layout emulation.
      userAgent:
        name === 'iPhone SE'
          ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1'
          : name === 'Galaxy S8'
            ? 'Mozilla/5.0 (Linux; Android 8.0.0; SM-G950F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/12.0 Chrome/80.0.3987.162 Mobile Safari/537.36'
            : devices[name]!.userAgent,
    });
    const page = await context.newPage();
    await page.goto(origin + '/login');
    for (const lang of ['en', 'ar']) {
      if (lang === 'ar') await page.getByRole('button', { name: 'العربية', exact: true }).click();
      await page
        .getByLabel(lang === 'ar' ? 'البريد الإلكتروني' : 'Email', { exact: true })
        .waitFor();
      await checkLayout(page, name + ' ' + lang);
      await page.screenshot({
        path:
          directory +
          '/mobile-' +
          name.toLowerCase().replaceAll(' ', '-') +
          '-login-' +
          lang +
          '.png',
        fullPage: true,
      });
    }
    await context.close();
    pass(
      name + ': Arabic/English responsive login, no horizontal overflow and 44px button targets',
    );
  }
  phase = 'unsupported';
  const unsupported = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 12_5 like Mac OS X) AppleWebKit/605.1.15 Version/12.0 Mobile/15E148 Safari/604.1',
      locale: 'ar-EG',
    }),
    old = await unsupported.newPage();
  await old.goto(origin + '/login');
  await old.getByText('حدّث المتصفح أو افتح من Chrome.', { exact: true }).waitFor();
  assert.equal(await old.locator('input[type=email]').count(), 0);
  await unsupported.close();
  pass('Unsupported iOS UA receives the Arabic update-browser screen without opening the app');
  phase = 'inline-csp';
  const unsafe = await browser.newContext(),
    up = await unsafe.newPage();
  await up.goto(origin + '/login');
  await up.locator('input[type=email]').waitFor();
  const blocked = await up.evaluate(
    () =>
      new Promise<boolean>((resolveResult) => {
        document.addEventListener(
          'securitypolicyviolation',
          () => resolveResult(!(window as unknown as { untrustedRan?: boolean }).untrustedRan),
          { once: true },
        );
        const s = document.createElement('script');
        s.textContent = 'window.untrustedRan=true';
        document.body.appendChild(s);
      }),
  );
  assert.equal(blocked, true);
  await unsafe.close();
  pass('CSP still rejects an unapproved inline script');
  assert.equal(errorStatusCounts['429'] ?? 0, 0, 'mobile journeys must not hit rate limits');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.reason =
    phase +
    ': ' +
    String(error)
      .replaceAll(password, '[credential]')
      .replace(/NQP:[a-f0-9]+/g, '[presentation]');
  console.error('HTTP error counts ' + JSON.stringify(errorStatusCounts));
  console.error(report.reason);
  process.exitCode = 1;
} finally {
  await Promise.allSettled(browsers.map((browser) => browser.close()));
  await app.close();
  await db.end();
  await writeFile(directory + '/mobile.json', JSON.stringify(report, null, 2) + '\n');
}
