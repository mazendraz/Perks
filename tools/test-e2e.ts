import sharp from 'sharp';
import { chromium, type Page, type BrowserContext, type Locator } from 'playwright';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { readConfig } from '../apps/api/src/config.js';
import { hashPassword } from '../apps/api/src/passwords.js';
import { openMfa } from '../apps/api/src/mfa.js';
import { totp, tokenHash } from '../apps/api/src/crypto.js';
import { runOne } from '../apps/worker/src/runner.js';
import { buildApp } from '../apps/api/src/server.js';

// Uses synthetic, uniquely named tenants in a dedicated local/CI DB.
// No production URLs, remote providers or existing balances are changed.
const c = readConfig();
assert.equal(c.AUTH_PROVIDER, 'local');
const dbUrl = new URL(c.DATABASE_MIGRATOR_URL!);
assert.equal(dbUrl.hostname, '127.0.0.1');
assert.ok(
  (c.APP_ENV === 'development' && dbUrl.pathname === '/nuqta_local') ||
    (c.APP_ENV === 'test' && dbUrl.pathname === '/nuqta_ci'),
  'Browser tests only use the dedicated local development or ephemeral CI database.',
);
const db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
const worker = new pg.Pool({ connectionString: c.WORKER_DATABASE_URL });
const browserName =
  process.env.NUQTA_E2E_BROWSER || (process.platform === 'win32' ? 'msedge' : 'chromium');
assert.ok(['msedge', 'chromium'].includes(browserName));
const browser = await chromium.launch({
  ...(browserName === 'msedge' ? { channel: 'msedge' } : {}),
  headless: true,
});
const checks: string[] = [],
  errors: string[] = [];
const capturePageError = (error: { name: string }) => {
  errors.push(error.name);
};
const stamp = Date.now().toString(36),
  origin = c.PUBLIC_APP_ORIGIN;
const testPassword = 'Qa-' + randomBytes(14).toString('hex');
// A controlled proxy-facing replica exercises registration on the actual HTTP
// API with a unique client IP. Persistent 5/hour guards are never reset or
// bypassed merely because this browser suite is run repeatedly.
const { app: registrationApp } = await buildApp({
  APP_ENV: 'test',
  LOG_LEVEL: 'silent',
  TRUSTED_PROXIES: '127.0.0.1/32',
});
const registrationOrigin = await registrationApp.listen({ port: 0, host: '127.0.0.1' });
const email = (role: string) => `${role}-${stamp}@nuqta.test`;
const evidence = 'docs/execution/evidence/implementation';
const ok = (name: string) => {
  checks.push(name);
  console.log('PASS ' + name);
};
async function context() {
  const x = await browser.newContext({ baseURL: origin, viewport: { width: 1365, height: 900 } });
  x.setDefaultTimeout(15000);
  await x.addInitScript(() => localStorage.setItem('nuqta-language', 'en'));
  return x;
}
async function choose(control: Locator, value: string) {
  await control.click();
  const id = await control.getAttribute('aria-controls');
  await control
    .page()
    .locator(
      '[id=' + JSON.stringify(id) + '] [role="option"][data-value=' + JSON.stringify(value) + ']',
    )
    .click();
}
async function merchantTab(page: Page, tab: string) {
  const group: Record<string, string> = {
    Team: 'Business',
    Branches: 'Business',
    Subscription: 'Business',
    Branding: 'Loyalty card',
    Programs: 'Loyalty card',
    'QR and NFC': 'Loyalty card',
    'Customers and segments': 'Customers',
    'WhatsApp contact': 'Customers',
    Support: 'Activity',
    Transactions: 'Activity',
    Overview: 'Overview',
  };
  if (group[tab])
    await page
      .getByRole('navigation', { name: 'Business sections', exact: true })
      .getByRole('button', { name: group[tab], exact: true })
      .click();
  if (tab !== 'Overview') await page.getByRole('button', { name: tab, exact: true }).click();
}
async function navigateTo(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}
async function reloadPage(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
}
async function login(
  page: Page,
  address: string,
  route = '/',
  existing = false,
  passwordValue = testPassword,
) {
  await navigateTo(page, route === '/' ? '/login' : route);
  assert.ok(existing, 'Password login is only for existing team or platform accounts.');
  await page.getByLabel('Email', { exact: true }).fill(address);
  await page.getByLabel('Password', { exact: true }).fill(passwordValue);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
}
async function call(x: BrowserContext, path: string, body?: unknown, key?: string) {
  const s = await (await x.request.get('/api/v1/session')).json();
  return x.request.fetch('/api/v1' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin, 'x-csrf-token': s.csrfToken, ...(key ? { 'idempotency-key': key } : {}) },
    data: body,
  });
}
async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
}
try {
  await mkdir(evidence, { recursive: true });
  await db.connect();
  await db.query(
    "INSERT INTO users(email,display_name,global_role,password_hash,password_version) VALUES($1,'Browser QA admin','platform_admin',$2,1)",
    [email('admin'), await hashPassword(testPassword, c.AUTH_PEPPER)],
  );
  for (const [locale, expected] of [
    ['ar-EG', 'ar'],
    ['en-US', 'en'],
    ['fr-FR', 'en'],
  ] as const) {
    const device = await browser.newContext({ baseURL: origin, locale });
    const page = await device.newPage();
    await navigateTo(page, '/');
    await page.locator('input[type=email]').waitFor();
    assert.equal(await page.locator('.portal-tile').count(), 0);
    assert.equal(
      await page.getByRole('button', { name: /Create.*account|اعمل حساب|حساب عميل جديد/ }).count(),
      0,
    );
    assert.equal(await page.locator('html').getAttribute('lang'), expected);
    await page
      .getByRole('button', { name: expected === 'ar' ? 'English' : 'العربية', exact: true })
      .click();
    await reloadPage(page);
    assert.equal(await page.locator('html').getAttribute('lang'), expected === 'ar' ? 'en' : 'ar');
    await device.close();
  }
  ok(
    'Fresh browsers use their primary device language; an explicit language switch persists after reload',
  );
  const admin = await context(),
    ap = await admin.newPage();
  for (const page of [ap]) page.on('pageerror', (e) => errors.push(e.name));
  await navigateTo(ap, '/platform');
  await ap.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  await ap.locator('.password-control input').fill(testPassword);
  for (const language of ['en', 'ar']) {
    if (language === 'ar') await ap.getByRole('button', { name: 'العربية', exact: true }).click();
    for (const width of [1365, 390]) {
      await ap.setViewportSize({ width, height: 900 });
      const input = ap.locator('.password-control input'),
        eye = ap.locator('.password-reveal'),
        a = await input.boundingBox(),
        e = await eye.boundingBox();
      assert.ok(
        a && e && (e.x + e.width <= a.x + 1 || e.x >= a.x + a.width - 1),
        'Eye has its own space beside the password text',
      );
      await eye.click();
      assert.equal(await input.getAttribute('type'), 'text');
      assert.equal(await input.inputValue(), testPassword);
      await eye.click();
      assert.equal(await input.getAttribute('type'), 'password');
    }
  }
  await ap.getByRole('button', { name: 'English', exact: true }).click();
  await ap.setViewportSize({ width: 1365, height: 900 });
  ok(
    'Password eye control never overlaps the input and preserves its value in Arabic/English at desktop/mobile widths',
  );
  await login(ap, email('admin'), '/platform', true);
  await navigateTo(ap, '/platform');
  await ap.getByRole('button', { name: 'New merchant', exact: true }).click();
  await ap
    .getByRole('textbox', { name: 'Business name', exact: true })
    .fill('Browser Cafe ' + stamp);
  await ap.getByLabel('Enrollment slug', { exact: true }).fill('qa-' + stamp);
  await ap.getByLabel('Contact email', { exact: true }).fill(email('owner'));
  await ap.getByLabel('Owner WhatsApp number (optional)', { exact: true }).fill('+15555550100');
  const ownerPhone = ap.getByLabel('Owner WhatsApp number (optional)', { exact: true });
  assert.equal(await ownerPhone.getAttribute('placeholder'), '01012345678');
  assert.equal(await ownerPhone.getAttribute('dir'), 'ltr');
  assert.equal(await ownerPhone.evaluate((el) => getComputedStyle(el).textAlign), 'left');
  const next = async () => {
    await ap.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await ap.waitForTimeout(150);
    console.log('Wizard:', await ap.locator('h1').innerText());
  };
  // One command is interrupted before commit, then its successful response is
  // dropped. Reloads must reuse the frozen create body and key in both cases.
  await ap.route('**/platform/provisioning-drafts', (route) => route.abort('failed'), { times: 1 });
  await next();
  await reloadPage(ap);
  assert.equal(
    await ap.getByLabel('Business name', { exact: true }).inputValue(),
    'Browser Cafe ' + stamp,
  );
  await ap.route(
    '**/platform/provisioning-drafts',
    async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort('failed');
    },
    { times: 1 },
  );
  await next();
  await reloadPage(ap);
  await next();
  const adminId = (await (await admin.request.get('/api/v1/session')).json()).user.id;
  assert.equal(
    (
      await db.query('SELECT count(*)::int AS n FROM provisioning_drafts WHERE created_by=$1', [
        adminId,
      ])
    ).rows[0].n,
    1,
  );
  ok(
    'Draft creation survives pre-commit interruption and a lost committed response across reloads without duplicates',
  );
  await ap.getByRole('button', { name: 'Save and exit', exact: true }).click();
  await ap.getByRole('button', { name: 'New merchant', exact: true }).waitFor();
  await reloadPage(ap);
  await ap
    .locator('.list-row')
    .filter({ hasText: 'Browser Cafe ' + stamp })
    .getByRole('button', { name: 'Resume', exact: true })
    .click();
  assert.equal(
    await ap.getByRole('textbox', { name: 'Business name', exact: true }).inputValue(),
    'Browser Cafe ' + stamp,
  );
  await ap.route(
    '**/platform/provisioning-drafts/*',
    async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort('failed');
    },
    { times: 1 },
  );
  await next();
  await reloadPage(ap);
  await next();
  ok(
    'A lost draft update response recovers the equal saved content without discarding edits or overwriting another revision',
  );
  ok('Provisioning draft survives save, exit, reload and resume with its revision');
  assert.equal(await ap.locator('.template-choice').count(), 15);
  await ap.getByLabel('Primary color HEX', { exact: true }).fill('204C41');
  await ap.getByLabel('Accent color HEX', { exact: true }).fill('#D4AD68');
  await ap.getByRole('button', { name: 'Primary color picker', exact: true }).click();
  await ap
    .getByRole('group', { name: 'Choose color', exact: true })
    .getByRole('button', { name: '#204C41', exact: true })
    .click();
  assert.equal(await ap.getByLabel('Primary color HEX', { exact: true }).inputValue(), '#204C41');
  await ap.getByRole('button', { name: '#204C41', exact: true }).press('Escape');
  await ap.getByRole('group', { name: 'Choose color', exact: true }).waitFor({ state: 'detached' });
  ok('The branded color picker updates the exact HEX value and closes with Escape');
  const logo = await sharp({
    create: { width: 80, height: 80, channels: 3, background: '#25a46b' },
  })
    .png()
    .toBuffer();
  await ap
    .getByLabel('Business logo', { exact: true })
    .setInputFiles({ name: 'cafe-logo.png', mimeType: 'image/png', buffer: logo });
  await ap.getByRole('button', { name: 'Remove logo', exact: true }).waitFor();
  await ap.locator('.wizard-layout>aside .brand-mark img').waitFor();
  const cardPreview = ap.locator('.wizard-layout>aside .loyalty-card');
  assert.equal(await ap.locator('.logo-style-example img').count(), 2);
  await ap.getByLabel('Logo size', { exact: true }).press('End');
  assert.equal(
    await cardPreview
      .locator('.brand-mark')
      .evaluate((el) => Math.round(el.getBoundingClientRect().width)),
    72,
  );
  ok('Logo options preview the uploaded business image and a live size slider');
  await ap.getByRole('button', { name: 'Framed', exact: true }).click();
  assert.ok((await cardPreview.getAttribute('class'))?.includes('logo-framed'));
  await ap.getByRole('button', { name: 'No background', exact: true }).click();
  const logoPaint = await cardPreview.locator('.brand-mark').evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    border: getComputedStyle(el).borderTopWidth,
  }));
  assert.deepEqual(logoPaint, { background: 'rgba(0, 0, 0, 0)', border: '0px' });
  ok('Logo background can be framed or transparent in the live card preview');
  for (const template of ['minimal', 'bold', 'noir', 'editorial']) {
    await choose(ap.getByLabel('Card template', { exact: true }), template);
    await choose(ap.getByLabel('Stamp shape', { exact: true }), 'hexagon');
    const painted = await cardPreview
      .locator('.stamp-dots>span.filled')
      .first()
      .evaluate((el) => ({
        background: getComputedStyle(el).backgroundColor,
        border: getComputedStyle(el).borderTopWidth,
      }));
    assert.equal(painted.background, 'rgba(0, 0, 0, 0)');
    assert.equal(painted.border, '0px');
  }
  for (const [template, symbol] of [
    ['cafe', 'coffee'],
    ['restaurant', 'utensils'],
    ['barber', 'scissors'],
  ] as const) {
    await choose(ap.getByLabel('Card template', { exact: true }), template);
    assert.equal(await cardPreview.getAttribute('data-stamp-icon'), symbol);
  }
  await ap.getByRole('button', { name: 'Cafe', exact: true }).click();
  assert.equal(await ap.locator('.template-choice').count(), 2);
  await ap.getByRole('button', { name: 'All templates', exact: true }).click();
  await choose(ap.getByLabel('Card template', { exact: true }), 'cafe');
  await ap.getByLabel('Number of stamps', { exact: true }).fill('8');
  assert.equal(await cardPreview.locator('.stamp-dots>span').count(), 8);
  await ap.getByLabel('Number of stamps', { exact: true }).fill('99999');
  assert.equal(await cardPreview.locator('.stamp-dots>span').count(), 50);
  assert.equal(
    await ap
      .getByLabel('Number of stamps', { exact: true })
      .evaluate((input: HTMLInputElement) => input.validity.valid),
    false,
  );
  await ap.getByLabel('Number of stamps', { exact: true }).fill('5');
  await choose(ap.getByLabel('Stamp shape', { exact: true }), 'hexagon');
  await choose(ap.getByLabel('Stamp finish', { exact: true }), 'outline');
  await ap.getByRole('button', { name: 'Star', exact: true }).click();
  assert.equal(await cardPreview.getAttribute('data-stamp-icon'), 'star');
  assert.ok((await cardPreview.getAttribute('class'))?.includes('stamp-shape-hexagon'));
  assert.ok((await cardPreview.getAttribute('class'))?.includes('stamp-style-outline'));
  await screenshot(ap, 'stamp-business-templates-en');
  await ap.setViewportSize({ width: 390, height: 844 });
  await ap.getByRole('button', { name: 'العربية', exact: true }).click();
  assert.ok(await ap.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ap.locator('.mobile-stamp-preview .loyalty-card').waitFor({ state: 'visible' });
  await screenshot(ap, 'stamp-customizer-ar-mobile');
  await ap.getByRole('button', { name: 'English', exact: true }).click();
  await ap.setViewportSize({ width: 1365, height: 900 });
  await choose(ap.getByLabel('Card template', { exact: true }), 'aurora');
  ok(
    'Cafe, restaurant and barber presets suggest stamps; shape, symbol and outline override independently in English and Arabic mobile layouts',
  );
  await screenshot(ap, 'brand-workshop-en');
  ok('Brand workshop accepts a real logo, typed HEX colors and fifteen selectable card editions');
  await db.query(
    "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
    [adminId],
  );
  await next();
  await login(ap, email('admin'), '/platform', true);
  assert.equal(
    await ap.getByLabel('Card template', { exact: true }).getAttribute('data-value'),
    'aurora',
  );
  await next();
  ok(
    'Expired administrator session signs in with email/password and restores the unsaved template and wizard step without MFA',
  );
  await ap.getByLabel('Program name', { exact: true }).fill('Coffee visits');
  await ap.getByLabel('Reward title', { exact: true }).fill('One coffee');
  await next();
  await ap.getByLabel('Branch name', { exact: true }).fill('Main branch');
  await ap.getByRole('button', { name: 'Add branch', exact: true }).click();
  await ap.getByLabel('Branch name', { exact: true }).nth(1).fill('Second branch');
  await ap.getByLabel('Second branch', { exact: true }).first().check();
  await ap.getByLabel('Email', { exact: true }).fill(email('owner'));
  await ap.getByLabel('Account password', { exact: true }).fill(testPassword);
  await ap.getByRole('button', { name: 'Add staff member', exact: true }).click();
  await ap.getByLabel('Email', { exact: true }).nth(1).fill(email('cashier'));
  await ap.getByLabel('Account password', { exact: true }).nth(1).fill(testPassword);
  assert.ok(
    !(await ap.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).includes(
      testPassword,
    ),
  );
  await next();
  await next();
  await next();
  await ap.route(
    '**/provisioning-drafts/*/activate',
    async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort('failed');
    },
    { times: 1 },
  );
  await ap.getByRole('button', { name: 'Activate merchant', exact: true }).click();
  await ap.getByRole('button', { name: 'Check activation', exact: true }).waitFor();
  await reloadPage(ap);
  const activated = ap.waitForResponse(
    (r) => r.url().includes('/activate') && r.request().method() === 'POST',
  );
  await ap.getByRole('button', { name: 'Check activation', exact: true }).click();
  const act = await activated;
  assert.equal(act.status(), 200);
  const provision = await act.json();
  const mid = provision.merchant.id,
    branch = provision.branches[0].id;
  await ap.getByRole('status').filter({ hasText: 'Merchant activated' }).waitFor();
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM merchants WHERE slug=$1', ['qa-' + stamp]))
      .rows[0].n,
    1,
  );
  ok(
    'Seven-step UI activation recovers a lost committed response across reload without duplicating the merchant or invitations',
  );
  const businessRow = ap.locator('tr').filter({ hasText: 'Browser Cafe ' + stamp });
  const statusSwitch = businessRow.getByRole('switch');
  assert.equal(await statusSwitch.getAttribute('aria-checked'), 'true');
  await statusSwitch.click();
  await ap.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await statusSwitch.getAttribute('aria-checked'), 'true');
  await statusSwitch.click();
  await ap
    .getByRole('dialog')
    .getByLabel('Reason for status change', { exact: true })
    .fill('Synthetic pause to test the status switch.');
  await ap.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await ap.getByRole('dialog').waitFor({ state: 'detached' });
  await ap.waitForFunction(
    (name) =>
      Array.from(document.querySelectorAll('tr'))
        .find((r) => r.textContent?.includes(name))
        ?.querySelector('[role=switch]')
        ?.getAttribute('aria-checked') === 'false',
    'Browser Cafe ' + stamp,
  );
  await statusSwitch.click();
  await ap
    .getByRole('dialog')
    .getByLabel('Reason for status change', { exact: true })
    .fill('Restore the synthetic business after the switch test.');
  await ap.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await ap.getByRole('dialog').waitFor({ state: 'detached' });
  ok(
    'The iPhone-style business switch reflects committed state; cancellation preserves it and pause/resume require a reason',
  );
  await ap.getByRole('button', { name: 'Platform team', exact: true }).click();
  await ap.getByRole('heading', { name: 'Platform team', exact: true }).waitFor();
  await ap.getByRole('button', { name: 'Add super admin', exact: true }).click();
  const adminDialog = ap.getByRole('dialog');
  await adminDialog
    .getByLabel('Administrator name', { exact: true })
    .fill('Second platform administrator');
  await adminDialog.getByLabel('Email', { exact: true }).fill(email('second-admin'));
  await adminDialog.getByLabel('New password', { exact: true }).fill(testPassword);
  await adminDialog.getByLabel('Confirm password', { exact: true }).fill(testPassword);
  await adminDialog
    .getByLabel('Reason', { exact: true })
    .fill('Shared administration test ' + stamp);
  await adminDialog.getByRole('checkbox').check();
  await adminDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await adminDialog.waitFor({ state: 'detached' });
  await ap.getByText(email('second-admin'), { exact: true }).waitFor();
  const teammate = await context(),
    teammatePage = await teammate.newPage();
  teammatePage.on('pageerror', (e) => errors.push(e.name));
  await login(teammatePage, email('second-admin'), '/login', true);
  await teammatePage.waitForURL('**/platform');
  await teammatePage
    .locator('.merchant-register tr')
    .filter({ hasText: 'Browser Cafe ' + stamp })
    .waitFor();
  await teammatePage.getByRole('button', { name: 'Platform team', exact: true }).click();
  await teammatePage.getByText(email('second-admin'), { exact: true }).waitFor();
  const teammateSession = await (await teammate.request.get('/api/v1/session')).json();
  const roster = await (await teammate.request.get('/api/v1/platform/admins')).json();
  assert.ok(roster.accounts.some((a: { id: string }) => a.id === teammateSession.user.id));
  assert.ok(
    roster.events.some(
      (e: { actor_email: string; detail: { reason: string } }) =>
        e.actor_email === email('admin') &&
        e.detail.reason === 'Shared administration test ' + stamp,
    ),
  );
  assert.ok(!(await teammatePage.locator('.sidebar nav').innerText()).includes('My cards'));
  await teammatePage.getByRole('button', { name: 'Sign out', exact: true }).click();
  await teammate.close();
  ok(
    'A second super admin created from Platform team signs in through the same login and shares shops, team accounts and attributed activity',
  );
  await ap.getByRole('button', { name: 'Businesses', exact: true }).click();
  await businessRow.getByRole('button', { name: 'Preview', exact: true }).click();
  const businessPreview = ap.getByRole('dialog');
  await businessPreview
    .getByRole('button', { name: 'Card details and edits', exact: true })
    .waitFor();
  await businessPreview
    .locator('img')
    .evaluateAll((nodes) => Promise.all(nodes.map((node) => (node as HTMLImageElement).decode())));
  await screenshot(ap, 'business-preview-en');
  await businessPreview.getByRole('button', { name: 'Close', exact: true }).click();
  await ap.getByRole('button', { name: 'العربية', exact: true }).click();
  await ap.setViewportSize({ width: 390, height: 844 });
  await businessRow.getByRole('button', { name: 'معاينة', exact: true }).click();
  await ap.getByRole('heading', { name: 'Browser Cafe ' + stamp, exact: true }).waitFor();
  assert.ok(await ap.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await screenshot(ap, 'business-preview-ar-mobile');
  await ap.getByRole('dialog').getByRole('button', { name: 'إغلاق', exact: true }).click();
  await ap.getByRole('button', { name: 'English', exact: true }).click();
  await ap.setViewportSize({ width: 1365, height: 900 });
  await businessRow.getByRole('button', { name: 'Preview', exact: true }).click();
  await businessPreview.getByRole('button', { name: 'WhatsApp the owner', exact: true }).click();
  let waDialog = ap
    .getByRole('dialog')
    .filter({ has: ap.getByRole('heading', { name: 'WhatsApp message', exact: true }) });
  await waDialog.getByRole('button', { name: 'Prepare WhatsApp draft', exact: true }).click();
  assert.ok(
    (
      await waDialog
        .getByRole('link', { name: 'Open draft in WhatsApp', exact: true })
        .getAttribute('href')
    )?.startsWith('https://wa.me/15555550100?'),
  );
  await waDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await businessPreview
    .getByRole('button', { name: 'Card details and edits', exact: true })
    .click();
  await ap.getByRole('heading', { name: 'Card and branding', exact: true }).waitFor();
  assert.equal(
    await ap.getByLabel('Card template', { exact: true }).getAttribute('data-value'),
    'aurora',
  );
  await ap.getByRole('button', { name: 'All businesses', exact: true }).click();
  ok(
    'Business Preview shows the real card, setup checklist and owner WhatsApp draft, and opens the card designer directly',
  );
  for (let i = 0; i < 100 && (await runOne(worker, c)); i++) {
    /* Drain committed local jobs only. */
  }
  const owner = await context(),
    op = await owner.newPage(),
    cashier = await context(),
    cp = await cashier.newPage();
  for (const [x, p, role] of [
    [owner, op, 'owner'],
    [cashier, cp, 'cashier'],
  ] as const) {
    p.on('pageerror', (e) => errors.push(e.name));
    await login(p, email(role), role === 'cashier' ? '/cashier/login' : '/merchant/login', true);
    await p.waitForURL(role === 'cashier' ? '**/cashier' : '**/merchant');
    const s = await (await x.request.get('/api/v1/session')).json();
    assert.deepEqual(
      s.grants[0].branches.map((b: { id: string }) => b.id).sort(),
      (role === 'owner' ? provision.branches.map((b: { id: string }) => b.id) : [branch]).sort(),
      'Granted branches match the selected set regardless of database row order',
    );
  }
  ok('Owner and cashier sign in directly with creator-set passwords and branch-scoped roles');
  await businessRow.getByRole('button', { name: 'View owner dashboard', exact: true }).click();
  await ap.getByRole('region', { name: 'Owner preview mode', exact: true }).waitFor();
  await ap.getByRole('heading', { name: 'Merchant dashboard', exact: true }).waitFor();
  await ap.locator('.merchant-metrics').waitFor();
  const actualOwner = (await (await owner.request.get('/api/v1/session')).json()).grants[0];
  const ownerData = await (
    await owner.request.get('/api/v1/merchants/' + mid + '/overview')
  ).json();
  const previewData = await (
    await admin.request.get('/api/v1/merchants/' + mid + '/overview', {
      headers: { 'x-nuqta-owner-preview': mid + ':' + actualOwner.id },
    })
  ).json();
  assert.deepEqual(previewData.metrics, ownerData.metrics);
  const period = ap.getByRole('combobox').first();
  await period.focus();
  await period.press('ArrowDown');
  await ap.getByRole('listbox').waitFor();
  await period.press('Home');
  await period.press('Enter');
  assert.equal(await period.getAttribute('data-value'), '7');
  await choose(period, '30');
  await period.click();
  await period.press('Escape');
  assert.equal(await period.getAttribute('aria-expanded'), 'false');
  ok('Custom dropdowns support keyboard navigation, selection and Escape without the browser menu');
  await merchantTab(ap, 'Team');
  await ap.locator('table').getByText(email('owner'), { exact: true }).waitFor();
  await merchantTab(ap, 'Branding');
  await choose(ap.getByLabel('Card template', { exact: true }), 'barber');
  await ap.getByRole('button', { name: 'Publish branding', exact: true }).click();
  await ap.getByRole('alert').filter({ hasText: 'This is an owner preview.' }).waitFor();
  await reloadPage(ap);
  await ap.getByRole('heading', { name: 'Merchant dashboard', exact: true }).waitFor();
  await merchantTab(ap, 'Branding');
  assert.equal(
    await ap.getByLabel('Card template', { exact: true }).getAttribute('data-value'),
    'aurora',
  );
  await ap.setViewportSize({ width: 390, height: 844 });
  await ap.getByRole('button', { name: 'العربية', exact: true }).click();
  assert.ok(await ap.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const previewPhone = ap.locator('.nq-phone-input');
  assert.equal(await previewPhone.getAttribute('dir'), 'ltr');
  assert.equal(await previewPhone.getAttribute('placeholder'), '01012345678');
  assert.equal(await previewPhone.evaluate((el) => getComputedStyle(el).direction), 'ltr');
  ok(
    'WhatsApp fields keep a numeric placeholder and left-to-right number entry in Arabic mobile layouts',
  );
  await screenshot(ap, 'owner-view-ar-mobile');
  await ap.getByRole('button', { name: 'English', exact: true }).click();
  await ap.setViewportSize({ width: 1365, height: 900 });
  await ap.getByRole('button', { name: 'Edit business in platform', exact: true }).click();
  await ap.getByRole('button', { name: 'All businesses', exact: true }).click();
  assert.equal(
    (await (await admin.request.get('/api/v1/session')).json()).user.role,
    'platform_admin',
  );
  ok(
    'Platform owner view uses the actual owner dashboard and metrics, survives reload and supports Arabic mobile',
  );
  ok(
    'Owner preview cannot publish shop changes and returns to the platform without changing the administrator session',
  );
  await merchantTab(op, 'Team');
  await op.getByRole('button', { name: 'Add staff account', exact: true }).click();
  const accountDialog = op.getByRole('dialog');
  await accountDialog.getByLabel('Email', { exact: true }).fill(email('extra-cashier'));
  await accountDialog.getByLabel('Account password', { exact: true }).fill(testPassword);
  await accountDialog.getByRole('button', { name: 'Create account', exact: true }).click();
  await accountDialog.waitFor({ state: 'detached' });
  await op.getByText(email('extra-cashier'), { exact: true }).waitFor();
  const extraCashier = await context();
  const extraPage = await extraCashier.newPage();
  await login(extraPage, email('extra-cashier'), '/cashier/login', true);
  await extraPage.waitForURL('**/cashier');
  const managedRow = op.locator('tr').filter({ hasText: email('extra-cashier') });
  await managedRow.getByRole('button', { name: 'Set password', exact: true }).click();
  const passwordDialog = op.getByRole('dialog'),
    resetPassword = 'Reset-' + randomBytes(14).toString('hex');
  await passwordDialog.getByLabel('New password', { exact: true }).fill(resetPassword);
  await passwordDialog.getByLabel('Confirm password', { exact: true }).fill(resetPassword);
  await passwordDialog
    .getByLabel('I understand this affects the sign-in account.', { exact: true })
    .check();
  await passwordDialog
    .getByLabel('Reason for change', { exact: true })
    .fill('Synthetic owner credential control');
  await passwordDialog.getByRole('button', { name: 'Save change', exact: true }).click();
  await passwordDialog.waitFor({ state: 'detached' });
  assert.equal((await extraCashier.request.get('/api/v1/session')).status(), 401);
  assert.ok(
    !(await op.evaluate(() => JSON.stringify({ ...sessionStorage, ...localStorage }))).includes(
      resetPassword,
    ),
  );
  await extraCashier.close();
  const resetBrowser = await context(),
    resetPage = await resetBrowser.newPage();
  await login(resetPage, email('extra-cashier'), '/cashier/login', true, resetPassword);
  await resetPage.waitForURL('**/cashier');
  await resetBrowser.close();
  ok(
    'Owner password controls revoke a managed cashier session, keep plaintext out of browser storage, and permit sign-in with the new password',
  );
  ok(
    'The owner creates a cashier with email and password from Team; the new cashier can sign in immediately',
  );
  const customer = await context(),
    up = await customer.newPage();
  up.on('pageerror', (e) => errors.push(e.name));
  const customerPhone = '+2010' + String(randomBytes(4).readUInt32BE()).padStart(10, '0').slice(-8);
  await navigateTo(up, '/join/qa-' + stamp + '?b=' + branch + '&src=qr');
  await up.getByLabel('Your name', { exact: true }).fill('   ');
  await up.getByLabel('Mobile number', { exact: true }).fill(customerPhone);
  await up.getByLabel('I accept the program, reward and privacy terms', { exact: true }).check();
  await up.getByRole('button', { name: 'Open my card', exact: true }).click();
  await up.locator('input[name="displayName"][aria-invalid="true"]').waitFor();
  await up.locator('.field-errors button').first().click();
  await up.waitForFunction(() => document.activeElement?.getAttribute('name') === 'displayName');
  await up.getByLabel('Your name', { exact: true }).fill('Browser Customer');
  await up.route(
    '**/api/v1/customer/register',
    async (route) => {
      const response = await route.fetch({
        url: registrationOrigin + '/api/v1/customer/register',
        headers: {
          ...route.request().headers(),
          'x-forwarded-for':
            '2001:db8:' + randomBytes(12).toString('hex').match(/.{4}/g)!.join(':'),
        },
        postData: JSON.stringify({
          ...route.request().postDataJSON(),
          acceptedPrivacyHash: '0'.repeat(64),
        }),
      });
      assert.equal(response.status(), 409);
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await up.getByRole('button', { name: 'Open my card', exact: true }).click();
  await up
    .getByText(
      'Privacy and terms have changed. Review and accept the current notice before continuing.',
      { exact: true },
    )
    .waitFor();
  assert.equal(
    await up
      .getByLabel('I accept the program, reward and privacy terms', { exact: true })
      .isChecked(),
    false,
  );
  assert.equal(await up.getByLabel('Your name', { exact: true }).inputValue(), 'Browser Customer');
  await up.getByLabel('I accept the program, reward and privacy terms', { exact: true }).check();
  ok(
    'An outdated privacy notice is rejected; the form preserves identity fields, refreshes the notice and requires fresh consent',
  );
  await up.route(
    '**/api/v1/customer/register',
    async (route) => {
      const response = await route.fetch({
        url: registrationOrigin + '/api/v1/customer/register',
        headers: {
          ...route.request().headers(),
          'x-forwarded-for':
            '2001:db8:' + randomBytes(12).toString('hex').match(/.{4}/g)!.join(':'),
        },
      });
      assert.equal(response.status(), 200);
      await route.abort('failed');
    },
    { times: 1 },
  );
  await up.getByRole('button', { name: 'Open my card', exact: true }).click();
  await up.waitForURL('**/customer/*');
  ok(
    'Name/phone/terms registration preserves accessible validation and recovers a lost committed response without a password or duplicate identity',
  );
  const membership = new URL(up.url()).pathname.split('/').at(-1)!;
  await up.getByRole('button', { name: 'Show my code', exact: true }).click();
  await up.locator('.qr-panel code').waitFor();
  let token = (await up.locator('.qr-panel code').textContent())!;
  await up.getByRole('button', { name: 'Close code', exact: true }).click();
  assert.match(token, /^NQP:/);
  ok('Device-bound customer receives a persisted branded card and real QR without email/password');
  const customerSession = await (
    await customer.request.get('/api/v1/session', { headers: { 'x-nuqta-workspace': 'customer' } })
  ).json();
  const shared = await context();
  const sharedPage = await shared.newPage();
  sharedPage.on('pageerror', (e) => errors.push(e.name));
  const portalRoles = [
    ['platform', 'admin'],
    ['merchant', 'owner'],
    ['cashier', 'cashier'],
  ] as const;
  await shared.addCookies(
    (await customer.cookies()).filter((cookie) =>
      /nq_device|nq_session_customer|nq_csrf_customer/.test(cookie.name),
    ),
  );
  for (const [portal, role] of portalRoles) {
    await login(
      sharedPage,
      email(role),
      portal === 'platform' ? '/merchant/login' : '/login',
      true,
    );
    await sharedPage.locator('[data-portal="' + portal + '"]').waitFor();
    assert.equal(await sharedPage.locator('[data-portal]').getAttribute('data-portal'), portal);
    if (portal === 'cashier') assert.equal(await sharedPage.locator('.sidebar').count(), 0);
    if (portal === 'merchant')
      assert.equal(
        await sharedPage
          .getByRole('button', { name: 'Operations and support', exact: true })
          .count(),
        0,
      );
  }
  for (const [portal, role] of portalRoles) {
    const s = await (
      await shared.request.get('/api/v1/session', { headers: { 'x-nuqta-workspace': portal } })
    ).json();
    assert.equal(s.user.email, email(role));
  }
  await navigateTo(sharedPage, '/cashier');
  await sharedPage.getByRole('button', { name: 'Sign out', exact: true }).click();
  await sharedPage.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  assert.equal(
    (
      await shared.request.get('/api/v1/session', { headers: { 'x-nuqta-workspace': 'cashier' } })
    ).status(),
    401,
  );
  for (const [portal, role] of portalRoles.filter(([portal]) => portal !== 'cashier'))
    assert.equal(
      (
        await (
          await shared.request.get('/api/v1/session', { headers: { 'x-nuqta-workspace': portal } })
        ).json()
      ).user.email,
      email(role),
    );
  const sharedCustomer = await (
    await shared.request.get('/api/v1/session', { headers: { 'x-nuqta-workspace': 'customer' } })
  ).json();
  assert.equal(sharedCustomer.user.id, customerSession.user.id);
  assert.equal(sharedCustomer.user.email, null);
  await shared.close();
  ok(
    'One sign-in screen routes the three team/platform roles; their sessions stay separate from the device-bound customer',
  );
  assert.equal(await up.locator('.loyalty-card').getAttribute('data-stamp-icon'), 'star');
  assert.ok((await up.locator('.loyalty-card').getAttribute('class'))?.includes('logo-plain'));
  assert.ok(
    (await up.locator('.loyalty-card').getAttribute('class'))?.includes('stamp-shape-hexagon'),
  );
  await merchantTab(op, 'Branding');
  const assetsBefore = (
    await db.query('SELECT count(*)::int AS n FROM assets WHERE merchant_id=$1', [mid])
  ).rows[0].n;
  await op.route(
    '**/api/v1/merchants/' + mid + '/assets',
    async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort('failed');
    },
    { times: 1 },
  );
  await op
    .getByLabel('Business logo', { exact: true })
    .setInputFiles({ name: 'updated-logo.png', mimeType: 'image/png', buffer: logo });
  await op.getByRole('status').filter({ hasText: 'Logo saved to your card.' }).waitFor();
  const savedLogo = (await (await owner.request.get('/api/v1/merchants/' + mid)).json()).merchant
    .logo_asset_id;
  assert.ok(savedLogo);
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM assets WHERE merchant_id=$1', [mid])).rows[0].n,
    assetsBefore + 1,
  );
  await reloadPage(op);
  await merchantTab(op, 'Branding');
  assert.ok(
    (await op.locator('.logo-style-example img').first().getAttribute('src'))?.includes(savedLogo),
  );
  await op.getByLabel('Logo size', { exact: true }).press('Home');
  ok(
    'Uploading a business logo saves it immediately, recovers a lost response once and survives reload without another publish',
  );
  await choose(op.getByLabel('Card template', { exact: true }), 'barber');
  await choose(op.getByLabel('Stamp shape', { exact: true }), 'seal');
  await op.getByRole('button', { name: 'Scissors', exact: true }).click();
  await op.getByRole('button', { name: 'Framed', exact: true }).click();
  await op.getByRole('button', { name: 'Publish branding', exact: true }).click();
  await op.getByRole('status').filter({ hasText: 'Branding published.' }).waitFor();
  await reloadPage(op);
  await merchantTab(op, 'Branding');
  assert.equal(
    await op.getByLabel('Stamp shape', { exact: true }).getAttribute('data-value'),
    'seal',
  );
  assert.equal(
    await op.getByLabel('Card template', { exact: true }).getAttribute('data-value'),
    'barber',
  );
  assert.equal(
    await op.getByRole('button', { name: 'Framed', exact: true }).getAttribute('aria-pressed'),
    'true',
  );
  await reloadPage(up);
  assert.equal(await up.locator('.loyalty-card').getAttribute('data-stamp-icon'), 'scissors');
  assert.equal(
    await up
      .locator('.loyalty-card .brand-mark')
      .evaluate((el) => Math.round(el.getBoundingClientRect().width)),
    32,
  );
  assert.ok((await up.locator('.loyalty-card').getAttribute('class'))?.includes('logo-framed'));
  assert.ok(
    (await up.locator('.loyalty-card').getAttribute('class'))?.includes('stamp-shape-seal'),
  );
  await op.getByLabel('Number of stamps', { exact: true }).fill('8');
  await op.getByRole('button', { name: 'Review and publish stamp count', exact: true }).click();
  assert.equal(
    await op.getByRole('dialog').getByLabel('Threshold', { exact: true }).inputValue(),
    '8',
  );
  await op
    .getByRole('dialog')
    .getByRole('button', { name: 'Publish version', exact: true })
    .click();
  await op.getByRole('dialog').waitFor({ state: 'detached' });
  const publicProgram = (
    await (await owner.request.get('/api/v1/public/merchants/qa-' + stamp)).json()
  ).programs[0];
  assert.equal(publicProgram.threshold, 8);
  await reloadPage(up);
  assert.equal(
    await up
      .getByRole('progressbar', { name: 'Stamp progress', exact: true })
      .getAttribute('aria-valuemax'),
    '5',
  );
  ok(
    'The card designer previews a custom stamp count and publishes it as a new program version while an existing customer keeps the original count',
  );
  await merchantTab(op, 'Overview');
  ok(
    'Owner-published stamp artwork and business template survive reload and reach the customer card',
  );
  await navigateTo(cp, '/cashier');
  async function scan() {
    await cp.getByRole('button', { name: 'Scan card', exact: true }).click();
    await cp.getByLabel('Or enter the customer card code', { exact: true }).fill(token);
    await cp.getByRole('button', { name: 'Read code', exact: true }).click();
    await cp.getByRole('button', { name: 'Add stamps', exact: true }).waitFor();
  }
  async function prepare(receipt: string, qty: number) {
    await cp.getByRole('button', { name: 'Add stamps', exact: true }).click();
    await cp.getByLabel('Receipt number', { exact: true }).fill(receipt);
    for (let i = 1; i < qty; i++)
      await cp.getByRole('button', { name: 'Increase quantity', exact: true }).click();
    await cp.getByRole('button', { name: 'Review award', exact: true }).click();
  }
  await up.evaluate(() => {
    const events: string[] = [];
    (window as unknown as { motionEvents: string[] }).motionEvents = events;
    new MutationObserver((changes) => {
      for (const change of changes)
        if (change.target instanceof Element && change.target.matches('.loyalty-card'))
          events.push(change.target.getAttribute('data-card-motion') || '');
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-card-motion'],
    });
  });
  await scan();
  await prepare('BROWSER-' + stamp + '-1', 3);
  // Commit on the server, then drop only the response to exercise ambiguous outcomes.
  await cp.route(
    '**/stamp-awards',
    async (route) => {
      const response = await route.fetch();
      if (response.status() !== 200) {
        errors.push('Intercepted commit returned ' + response.status());
        await route.fulfill({ response });
        return;
      }
      await route.abort('failed');
    },
    { times: 1 },
  );
  await cp.getByRole('button', { name: 'Confirm stamps', exact: true }).click();
  await cp.getByRole('button', { name: 'Check the same operation', exact: true }).waitFor();
  await reloadPage(cp);
  await cp.getByRole('button', { name: 'Check the same operation', exact: true }).click();
  await cp.getByText('Saved balance: 3', { exact: true }).waitFor();
  const first = await db.query(
    "SELECT count(*)::int AS n FROM loyalty_transactions WHERE merchant_id=$1 AND type='award'",
    [mid],
  );
  assert.equal(first.rows[0].n, 1);
  await up.bringToFront();
  await up.waitForFunction(
    () => document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === '3',
  );
  await up.waitForFunction(() =>
    (window as unknown as { motionEvents: string[] }).motionEvents?.some((x) =>
      x.includes('stamp-added'),
    ),
  );
  assert.ok(
    (await up.evaluate(() => (window as unknown as { motionEvents: string[] }).motionEvents)).some(
      (x) => x.includes('stamp-added'),
    ),
  );
  ok('Committed stamps animate on the customer card and update the accessible progress');
  ok('Lost response after commit recovers the same operation with exactly one purchase and award');
  await cp.getByRole('button', { name: 'Next customer', exact: true }).click();
  await cp.getByLabel('Or enter the customer card code', { exact: true }).fill(token);
  await cp.getByRole('button', { name: 'Read code', exact: true }).click();
  await prepare('BROWSER-' + stamp + '-2', 2);
  await cp.getByRole('button', { name: 'Confirm stamps', exact: true }).click();
  await cp.getByText('Saved balance: 0', { exact: true }).waitFor();
  await up.getByText('Available', { exact: true }).waitFor();
  await up.waitForFunction(
    () => document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') === '5',
  );
  assert.equal(await up.locator('.stamp-dots .filled').count(), 5);
  await up.waitForFunction(() =>
    (window as unknown as { motionEvents: string[] }).motionEvents?.some((x) =>
      x.includes('reward-earned'),
    ),
  );
  assert.ok(
    (await up.evaluate(() => (window as unknown as { motionEvents: string[] }).motionEvents)).some(
      (x) => x.includes('reward-earned'),
    ),
  );
  ok(
    'The completed card remains full and celebrates the committed reward until cashier redemption',
  );
  await up.getByRole('button', { name: 'Show my code', exact: true }).click();
  token = (await up.locator('.qr-panel code').textContent())!;
  ok(
    'Two purchases award five stamps, conserve the balance and unlock one independent reward across sessions',
  );
  await cp.getByRole('button', { name: 'Next customer', exact: true }).click();
  await cp.getByLabel('Or enter the customer card code', { exact: true }).fill(token);
  await cp.getByRole('button', { name: 'Read code', exact: true }).click();
  await cp.getByRole('button', { name: 'Redeem', exact: true }).click();
  await reloadPage(up);
  await up.evaluate(() => {
    const events: string[] = [];
    (window as unknown as { motionEvents: string[] }).motionEvents = events;
    new MutationObserver((changes) => {
      for (const change of changes)
        if (change.target instanceof Element && change.target.matches('.loyalty-card'))
          events.push(change.target.getAttribute('data-card-motion') || '');
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-card-motion'],
    });
  });
  await up.getByRole('button', { name: 'Yes, I am redeeming', exact: true }).click();
  await cp.getByRole('button', { name: 'Complete redemption', exact: true }).click();
  await cp.getByRole('heading', { name: 'Reward redeemed', exact: true }).waitFor();
  const reference = (await cp.locator('.receipt-result bdi').textContent())!;
  await up.getByText('Redeemed', { exact: true }).waitFor();
  assert.equal(await up.locator('.stamp-dots .filled').count(), 0);
  assert.equal(await up.locator('.card-cycle').innerText(), 'Card 2');
  assert.ok(
    (await up.evaluate(() => (window as unknown as { motionEvents: string[] }).motionEvents)).some(
      (x) => x.includes('cycle-renew'),
    ),
  );
  await up.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(
    await up.locator('.loyalty-card').evaluate((el) => getComputedStyle(el).animationName),
    'none',
  );
  await up.emulateMedia({ reducedMotion: 'no-preference' });
  ok(
    'Cashier redemption starts card two at zero, animates renewal and respects reduced-motion settings',
  );
  ok('Authenticated holder confirmation completes one redemption and updates the customer card');
  await navigateTo(op, '/merchant');
  await op.getByText('Registered customers', { exact: true }).waitFor();
  const overview = await call(owner, '/merchants/' + mid + '/overview');
  assert.equal(overview.status(), 200);
  const metrics = (await overview.json()).metrics;
  assert.equal(metrics.stamps, 5);
  assert.equal(metrics.visits, 2);
  assert.equal(metrics.rewardsRedeemed, 1);
  assert.equal(metrics.registered, 1);
  ok('Merchant KPIs derive five stamps and two confirmed visits from database facts');
  await merchantTab(op, 'Programs');
  await op.getByRole('button', { name: 'New program', exact: true }).click();
  await op.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Bakery extras');
  await op.getByRole('dialog').getByLabel('Reward', { exact: true }).fill('One bakery item');
  await op
    .getByRole('dialog')
    .getByLabel('Terms', { exact: true })
    .fill('One eligible item with verified purchase');
  await op.getByRole('button', { name: 'Publish program', exact: true }).click();
  await op.getByRole('dialog').waitFor({ state: 'detached' });
  const extraProgram = op
    .locator('section.panel')
    .filter({ has: op.getByRole('heading', { name: 'Bakery extras', exact: true }) });
  await extraProgram.getByRole('button', { name: 'Stop earning', exact: true }).click();
  await op
    .getByLabel('Earning status reason', { exact: true })
    .fill('Pause synthetic extra program');
  await op.getByRole('button', { name: 'Confirm earning status', exact: true }).click();
  await op.getByRole('dialog').waitFor({ state: 'detached' });
  await extraProgram.getByRole('button', { name: 'Resume earning', exact: true }).click();
  await op
    .getByLabel('Earning status reason', { exact: true })
    .fill('Resume synthetic extra program');
  await op.getByRole('button', { name: 'Confirm earning status', exact: true }).click();
  await op.getByRole('dialog').waitFor({ state: 'detached' });
  await extraProgram.getByRole('button', { name: 'Stop earning', exact: true }).waitFor();
  ok('Merchant creates a second program and explicitly stops/resumes earning from the UI');

  const trace = await call(admin, '/platform/operations/' + reference);
  assert.equal(trace.status(), 200);
  assert.equal((await trace.json()).transaction.type, 'redeem');
  ok('Platform operation reference traces committed transaction and related audit/jobs');
  const foreign = await context(),
    fp = await foreign.newPage();
  const foreignId = (
    await db.query(
      'INSERT INTO users(email,display_name,password_hash,password_version) VALUES($1,$2,$3,1) RETURNING id',
      [email('foreign'), 'Browser foreign owner', await hashPassword(testPassword, c.AUTH_PEPPER)],
    )
  ).rows[0].id;
  const foreignStaff = (
    await db.query(
      "INSERT INTO staff_memberships(merchant_id,user_id,email,name,role) VALUES('10000000-0000-4000-8000-000000000002',$1,$2,'Browser foreign owner','owner') RETURNING id",
      [foreignId, email('foreign')],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES('10000000-0000-4000-8000-000000000002',$1,'20000000-0000-4000-8000-000000000003')",
    [foreignStaff],
  );
  await login(fp, email('foreign'), '/login', true);
  const denied = await call(foreign, '/merchants/' + mid + '/overview');
  assert.equal(denied.status(), 404);
  ok('Merchant B cannot read merchant A reports');

  await choose(up.getByLabel('Purchase branch'), branch);
  await up.getByRole('button', { name: 'Request stamp', exact: true }).click();
  await up.locator('.match-code').waitFor();
  const requestCode = (await up.locator('.match-code').textContent())!;
  const queueProof = await call(
    cashier,
    '/merchants/' + mid + '/stamp-requests?branchId=' + branch,
  );
  assert.equal(queueProof.status(), 200);
  assert.equal((await queueProof.json()).requests.length, 1);
  await navigateTo(cp, '/cashier');
  assert.equal((await queueProof.json()).requests[0].code, requestCode);
  async function scanRequestCard() {
    if (await up.getByRole('dialog', { name: 'Personal QR', exact: true }).count())
      await up.getByRole('button', { name: 'Close code', exact: true }).click();
    await up.getByRole('button', { name: 'Show my code', exact: true }).click();
    const fresh = (await up.locator('.qr-panel code').textContent())!.trim();
    await cp.getByLabel('Or enter the request customer QR code', { exact: true }).fill(fresh);
    await cp.getByRole('button', { name: 'Read request code', exact: true }).click();
    await cp.getByText('Customer code scanned.', { exact: true }).waitFor();
  }
  await scanRequestCard();
  await cp.getByLabel('Request receipt number', { exact: true }).fill('BROWSER-' + stamp + '-3');
  await cp.getByRole('button', { name: 'More stamps', exact: true }).click();
  let decisionResolved!: () => void, decisionRejected!: (error: Error) => void;
  const committedDecision = new Promise<void>((resolve, reject) => {
    decisionResolved = resolve;
    decisionRejected = reject;
  });
  await cp.route(
    '**/stamp-requests/*/decision',
    async (route) => {
      const response = await route.fetch();
      if (response.status() !== 200) {
        errors.push('Intercepted commit returned ' + response.status());
        await route.fulfill({ response });
        decisionRejected(new Error('Request decision did not commit.'));
        return;
      }
      await route.abort('failed');
      decisionResolved();
    },
    { times: 1 },
  );
  await cp.getByRole('button', { name: 'Stamp request', exact: true }).click();
  await committedDecision;
  await reloadPage(cp);
  await cp.getByRole('button', { name: 'Check the same decision', exact: true }).click();
  await cp.getByRole('status').filter({ hasText: 'Transaction saved:' }).waitFor();
  await reloadPage(up);
  await up.getByRole('status').filter({ hasText: 'Request approved' }).waitFor();
  const afterRequests = (await (await call(owner, '/merchants/' + mid + '/overview')).json())
    .metrics;
  assert.equal(afterRequests.stamps, 7);
  assert.equal(afterRequests.visits, 3);
  ok(
    'Inline branch queue requires a customer QR scan and receipt, approves in one tap without a confirmation dialog, and recovers a lost response once',
  );
  // A second request never reaches the server on the first attempt.
  await up.getByRole('button', { name: 'Request stamp', exact: true }).click();
  await up.locator('.match-code').waitFor();
  await cp.getByRole('button', { name: 'Stamp request', exact: true }).waitFor();
  await scanRequestCard();
  await cp.getByLabel('Request receipt number', { exact: true }).fill('BROWSER-' + stamp + '-4');
  await cp.route('**/stamp-requests/*/decision', (route) => route.abort('failed'), { times: 1 });
  await cp.getByRole('button', { name: 'Stamp request', exact: true }).click();
  await cp
    .getByText('NETWORK UNCERTAIN', { exact: false })
    .first()
    .waitFor()
    .catch(() => {});
  const savedDecision = await cp.evaluate(
    () =>
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith('nuqta-request-decision-'))
        .map((k) => JSON.parse(sessionStorage.getItem(k)!))[0],
  );
  assert.ok(savedDecision?.body?.award);
  assert.equal('code' in savedDecision.body, false);
  assert.equal('presentationContext' in savedDecision.body.award, false);
  assert.equal('code' in savedDecision.request, false);
  await reloadPage(cp);
  await cp.getByRole('button', { name: 'Check the same decision', exact: true }).click();
  await cp.getByRole('button', { name: 'Stamp request', exact: true }).waitFor();
  assert.equal(
    await cp.getByLabel('Request receipt number', { exact: true }).inputValue(),
    'BROWSER-' + stamp + '-4',
  );
  assert.equal(
    await cp.getByRole('button', { name: 'Stamp request', exact: true }).isDisabled(),
    true,
  );
  await scanRequestCard();
  await cp.getByRole('button', { name: 'Stamp request', exact: true }).click();
  await cp.getByRole('status').filter({ hasText: 'Transaction saved:' }).waitFor();
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM loyalty_transactions WHERE merchant_id=$1 AND type='award'",
        [mid],
      )
    ).rows[0].n,
    4,
  );
  ok(
    'Unknown request decision after reload restores its immutable command without stored QR credentials and completes once after a fresh customer scan',
  );
  await merchantTab(op, 'Customers and segments');
  await op.getByRole('button', { name: 'Browser Customer', exact: true }).click();
  await op.getByRole('dialog').waitFor();
  for (let i = 0; i < 8; i++) {
    await op.keyboard.press('Tab');
    assert.equal(
      await op.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')),
      true,
    );
  }
  await op.keyboard.press('Escape');
  await op.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(
    await op
      .getByRole('button', { name: 'Browser Customer', exact: true })
      .evaluate((e) => e === document.activeElement),
    true,
  );
  ok('Customer detail dialog traps keyboard focus, closes on Escape and restores the trigger');
  await op.getByLabel('Save this filter as', { exact: true }).fill('All customers');
  await op.getByRole('button', { name: 'Save segment', exact: true }).click();
  await op.getByRole('button', { name: 'All customers', exact: true }).waitFor();
  await op.getByRole('button', { name: 'Prepare private CSV', exact: true }).click();
  for (let i = 0; i < 100 && (await runOne(worker, c)); i++) {
    /* Drain local committed jobs. */
  }
  await op.getByRole('link', { name: 'Download', exact: true }).waitFor();
  const csvUrl = await op.getByRole('link', { name: 'Download', exact: true }).getAttribute('href');
  const csv = await owner.request.get(csvUrl!);
  assert.equal(csv.status(), 200);
  assert.ok((await csv.text()).includes('Browser Customer'));
  ok('Saved segment and private worker-generated CSV are usable from the merchant UI');
  await up.getByRole('button', { name: 'Preferences', exact: true }).click();
  await up.locator('input[type=tel]').fill('+15555550101');
  await up.getByRole('button', { name: 'Save number', exact: true }).click();
  await up.getByRole('status').filter({ hasText: 'Number saved.' }).waitFor();
  await Promise.all([
    up.waitForResponse(
      (response) =>
        response.url().endsWith('/preferences') && response.request().method() === 'PATCH',
    ),
    up.getByLabel('WhatsApp', { exact: true }).click(),
  ]);
  await up.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('label'))
        .find((label) => label.textContent?.trim() === 'WhatsApp')
        ?.querySelector('input')?.checked === true,
  );
  await up.getByRole('button', { name: 'Card', exact: true }).click();
  await merchantTab(op, 'WhatsApp contact');
  const contactRow = op.locator('tr').filter({ hasText: 'Browser Customer' });
  await contactRow.getByRole('button', { name: 'WhatsApp message', exact: true }).click();
  waDialog = op.getByRole('dialog');
  await waDialog.getByRole('button', { name: 'Prepare WhatsApp draft', exact: true }).click();
  assert.ok(
    (
      await waDialog
        .getByRole('link', { name: 'Open draft in WhatsApp', exact: true })
        .getAttribute('href')
    )?.startsWith('https://wa.me/15555550101?'),
  );
  await waDialog.getByRole('button', { name: 'Close', exact: true }).click();
  ok(
    'A consented customer WhatsApp draft uses the stored number and stays a reviewable draft without sending',
  );
  let contactReadReleased!: () => void;
  const pendingContactRead = new Promise<void>((resolve) => {
    contactReadReleased = resolve;
  });
  await up.route('**/api/v1/me/merchants/*/contact', async (route) => {
    const response = await route.fetch();
    await pendingContactRead;
    await route.fulfill({ response });
  });
  await up.getByRole('button', { name: 'Preferences', exact: true }).click();
  await up.locator('input[type=tel]').waitFor();
  assert.equal(await up.locator('input[type=tel]').isDisabled(), true);
  contactReadReleased();
  await up.locator('input[type=tel]').fill('+15555550102');
  await up.unroute('**/api/v1/me/merchants/*/contact');
  await up.getByRole('button', { name: 'Save number', exact: true }).click();
  await up.getByRole('status').filter({ hasText: 'Number saved.' }).waitFor();
  await up.waitForFunction(() => {
    const label = Array.from(document.querySelectorAll('label')).find(
      (el) => el.textContent?.trim() === 'WhatsApp',
    );
    return (label?.querySelector('input') as HTMLInputElement)?.checked === false;
  });
  await Promise.all([
    op.waitForResponse(
      (r) => r.url().includes('/customer-outreach') && r.request().method() === 'GET',
    ),
    op.getByRole('button', { name: 'Refresh', exact: true }).click(),
  ]);
  await contactRow.locator('button:disabled').waitFor();
  assert.equal(
    await contactRow.getByRole('button', { name: 'WhatsApp message', exact: true }).isDisabled(),
    true,
  );
  await Promise.all([
    up.waitForResponse((r) => r.url().endsWith('/preferences') && r.request().method() === 'PATCH'),
    up.getByLabel('WhatsApp', { exact: true }).click(),
  ]);
  await up.waitForFunction(() => {
    const label = Array.from(document.querySelectorAll('label')).find(
      (el) => el.textContent?.trim() === 'WhatsApp',
    );
    return (label?.querySelector('input') as HTMLInputElement)?.checked === true;
  });
  await op.getByRole('button', { name: 'Refresh', exact: true }).click();
  await contactRow.getByRole('button', { name: 'WhatsApp message', exact: true }).click();
  waDialog = op.getByRole('dialog');
  await waDialog.getByRole('button', { name: 'Prepare WhatsApp draft', exact: true }).click();
  assert.ok(
    (
      await waDialog
        .getByRole('link', { name: 'Open draft in WhatsApp', exact: true })
        .getAttribute('href')
    )?.startsWith('https://wa.me/15555550102?'),
  );
  await waDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await up.getByRole('button', { name: 'Card', exact: true }).click();
  ok(
    'A customer changes their own WhatsApp number, consent is reset, and drafts remain disabled until they explicitly opt in again',
  );

  await merchantTab(op, 'QR and NFC');
  await op.getByRole('button', { name: 'Request a piece', exact: true }).click();
  await op.getByLabel('Piece label', { exact: true }).fill('Browser counter');
  await op.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  const piece = op
    .locator('.subpanel')
    .filter({ has: op.getByRole('heading', { name: 'Browser counter', exact: true }) });
  await piece.getByRole('link', { name: 'Download print QR', exact: true }).waitFor();
  const qrUrl = (await piece.locator('.url-box').getAttribute('href'))!;
  const anonymous = await context(),
    pp = await anonymous.newPage();
  await navigateTo(pp, qrUrl);
  await pp.waitForURL('**/join/**');
  await pp.getByRole('heading', { name: 'Browser Cafe ' + stamp, exact: true }).waitFor();
  await piece.getByRole('button', { name: 'Replace piece', exact: true }).click();
  await op
    .getByLabel('Reason or execution notes', { exact: true })
    .fill('Replace synthetic browser fixture');
  await op.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await op.getByRole('dialog').waitFor({ state: 'detached' });
  assert.equal(
    (
      await anonymous.request.get(
        '/api/v1/public/placements/' + new URL(qrUrl).pathname.split('/').at(-1),
      )
    ).status(),
    410,
  );
  ok('Material UI creates a real branch placement; replacement revokes the old public URL');
  await merchantTab(op, 'Support');
  await op.getByRole('button', { name: 'New support ticket', exact: true }).click();
  await op.getByLabel('Subject', { exact: true }).fill('Browser support ' + stamp);
  await op.getByLabel('Message', { exact: true }).fill('Synthetic browser support request.');
  await op.getByRole('button', { name: 'Save message', exact: true }).click();
  await op.getByRole('heading', { name: 'Browser support ' + stamp, exact: true }).waitFor();
  await businessRow.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await ap.getByRole('button', { name: 'Branches and accounts', exact: true }).click();
  await ap.getByText(email('cashier'), { exact: true }).waitFor();
  await ap.getByRole('button', { name: 'Add email and password account', exact: true }).click();
  const platformAccount = ap.getByRole('dialog');
  await platformAccount.getByLabel('Email', { exact: true }).fill(email('platform-manager'));
  await platformAccount.getByLabel('Account password', { exact: true }).fill(testPassword);
  await choose(platformAccount.getByLabel('Role', { exact: true }), 'manager');
  await platformAccount.getByLabel('Role', { exact: true }).click();
  await platformAccount.getByLabel('Role', { exact: true }).press('Escape');
  assert.equal(await platformAccount.isVisible(), true);
  assert.equal(
    await platformAccount.getByLabel('Role', { exact: true }).getAttribute('aria-expanded'),
    'false',
  );
  await platformAccount.getByRole('button', { name: 'Create account', exact: true }).click();
  await platformAccount.waitFor({ state: 'detached' });
  await ap.getByText(email('platform-manager'), { exact: true }).waitFor();
  ok(
    'The platform creates password accounts for already-activated businesses from their scoped workspace',
  );
  await ap.getByRole('button', { name: 'QR codes', exact: true }).click();
  await ap.locator('.qr-sheet').first().waitFor();
  assert.equal(await ap.locator('.qr-sheet').count(), 3);
  await screenshot(ap, 'business-workspace-qr');
  await ap.getByRole('button', { name: 'Generate branch QR', exact: true }).click();
  await ap.getByRole('button', { name: 'Generate code', exact: true }).click();
  await ap.waitForFunction(() => document.querySelectorAll('.qr-sheet').length === 4);
  const qrPreview = ap.locator('.qr-sheet img').first();
  await qrPreview.evaluate((img: HTMLImageElement) => img.decode());
  assert.equal(
    await qrPreview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
    true,
  );
  await ap.setViewportSize({ width: 390, height: 844 });
  await ap.getByRole('button', { name: 'العربية', exact: true }).click();
  await ap.waitForTimeout(150);
  assert.ok(await ap.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await screenshot(ap, 'business-workspace-qr-ar-mobile');
  await ap.getByRole('button', { name: 'English', exact: true }).click();
  await ap.setViewportSize({ width: 1365, height: 900 });
  ok(
    'Scoped business QR previews load, additional branch QR generation works and the Arabic mobile workspace fits the screen',
  );
  await ap.getByRole('button', { name: 'Support and issues', exact: true }).click();
  await ap.getByRole('button', { name: 'Browser support ' + stamp, exact: true }).click();
  await ap
    .getByLabel('Message', { exact: true })
    .fill('Reviewed the synthetic receipt and ledger.');
  await ap.getByRole('button', { name: 'Save message', exact: true }).click();
  await ap.getByText('Reviewed the synthetic receipt and ledger.', { exact: true }).waitFor();
  ok('Merchant support ticket and platform reply persist across separate authenticated contexts');
  await ap.getByRole('button', { name: 'All businesses', exact: true }).click();
  await ap.getByRole('button', { name: 'العربية', exact: true }).click();
  assert.equal(await businessRow.locator('td').nth(1).innerText(), 'نشط');
  assert.equal(await businessRow.locator('td').nth(4).innerText(), 'نمو');
  assert.equal(await ap.getByText('PLATFORM', { exact: true }).count(), 0);
  await ap.getByText('المنصة', { exact: true }).waitFor();
  await ap.getByRole('button', { name: 'English', exact: true }).click();
  ok(
    'Arabic business list localizes merchant status, plan and workspace label while preserving the business URL identifier',
  );
  await ap.getByRole('button', { name: 'Operations and support', exact: true }).click();
  await ap.getByRole('button', { name: 'Trace operation', exact: true }).click();
  await ap.getByLabel('Transaction or receipt reference', { exact: true }).fill(reference);
  await ap.getByRole('button', { name: 'Find operation', exact: true }).click();
  await ap.locator('.operation-json').waitFor();
  assert.ok((await ap.locator('.operation-json').textContent())!.includes(reference));
  ok('Platform UI searches the committed redemption by reference');
  await merchantTab(op, 'Overview');
  await navigateTo(cp, '/cashier');
  await ap.getByRole('button', { name: 'Health', exact: true }).click();
  for (const [p, name] of [
    [up, 'customer'],
    [cp, 'cashier'],
    [op, 'merchant'],
    [ap, 'platform'],
  ] as const) {
    for (const language of ['en', 'ar']) {
      await p.setViewportSize({ width: 390, height: 844 });
      if (language === 'ar') await p.getByRole('button', { name: 'العربية', exact: true }).click();
      await p.waitForTimeout(250);
      const size = await p.evaluate(() => ({
        width: innerWidth,
        content: document.documentElement.scrollWidth,
        dir: document.documentElement.dir,
      }));
      assert.ok(size.content <= size.width + 1, `${name} ${language} mobile overflow`);
      await screenshot(p, name + '-' + language);
    }
  }
  ok(
    'All four workspaces render at 390px in Arabic RTL and English LTR without horizontal overflow',
  );
  assert.deepEqual(errors, []);
  ok('No uncaught browser page errors');
  await ap.getByRole('button', { name: 'English', exact: true }).click();
  await ap.setViewportSize({ width: 1365, height: 900 });
  await ap.getByRole('button', { name: 'Businesses', exact: true }).click();
  await businessRow.getByRole('button', { name: 'Preview', exact: true }).click();
  await ap
    .getByRole('dialog')
    .getByRole('button', { name: 'Manage accounts and passwords', exact: true })
    .click();
  const ownerRow = ap.locator('tr').filter({ hasText: email('owner') });
  await ownerRow.getByRole('button', { name: 'Set password', exact: true }).click();
  const ownerPasswordDialog = ap.getByRole('dialog'),
    ownerNewPassword = 'Owner-reset-' + randomBytes(14).toString('hex');
  await ownerPasswordDialog.getByLabel('New password', { exact: true }).fill(ownerNewPassword);
  await ownerPasswordDialog.getByLabel('Confirm password', { exact: true }).fill(ownerNewPassword);
  await ownerPasswordDialog
    .getByLabel('I understand this affects the sign-in account.', { exact: true })
    .check();
  await ownerPasswordDialog
    .getByLabel('Reason for change', { exact: true })
    .fill('Synthetic platform owner recovery');
  await ownerPasswordDialog.getByRole('button', { name: 'Save change', exact: true }).click();
  await ownerPasswordDialog.waitFor({ state: 'detached' });
  assert.equal((await owner.request.get('/api/v1/session')).status(), 401);
  const recoveredOwner = await context(),
    recoveredOwnerPage = await recoveredOwner.newPage();
  await login(recoveredOwnerPage, email('owner'), '/merchant/login', true, ownerNewPassword);
  await recoveredOwnerPage.waitForURL('**/merchant');
  await recoveredOwner.close();
  ok(
    'The platform resets the existing owner account from Preview, invalidates the old owner session and restores sign-in with the new password',
  );
  // Exercise the real MFA setup UI without imposing production MFA on the local demo.
  // Only the session response flag is overridden; setup/confirm/recovery hit the real API.
  await ap.route('**/api/v1/session', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body.user) body.user.mfaRequired = true;
    await route.fulfill({ response, json: body });
  });
  await navigateTo(ap, '/platform');
  await ap.getByRole('heading', { name: 'Set up your authenticator', exact: true }).waitFor();
  await screenshot(ap, 'platform-mfa-en');
  await ap.setViewportSize({ width: 390, height: 844 });
  await ap.getByRole('button', { name: 'العربية', exact: true }).click();
  await ap.getByRole('heading', { name: 'جهّز تطبيق التحقق', exact: true }).waitFor();
  assert.ok(await ap.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await screenshot(ap, 'platform-mfa-ar-mobile');
  await ap.getByRole('button', { name: 'English', exact: true }).click();
  await ap.getByLabel('Current password', { exact: true }).fill(testPassword);
  await ap.getByRole('button', { name: 'Show authenticator QR', exact: true }).click();
  const setupQr = ap.getByAltText('Authenticator setup QR', { exact: true });
  await setupQr.evaluate((img: HTMLImageElement) => img.decode());
  assert.ok(await setupQr.evaluate((img: HTMLImageElement) => img.naturalWidth > 0));
  const mfaSecret = (
    await db.query('SELECT secret_encrypted FROM mfa_enrollments WHERE user_id=$1', [adminId])
  ).rows[0].secret_encrypted;
  await ap
    .getByLabel('Authenticator code', { exact: true })
    .fill(totp(openMfa(mfaSecret, c.AUTH_PEPPER), Math.floor(Date.now() / 30000)));
  await ap.getByRole('button', { name: 'Verify identity', exact: true }).click();
  await ap.getByRole('heading', { name: 'Save your recovery codes', exact: true }).waitFor();
  assert.equal(await ap.locator('.mfa-recovery-codes code').count(), 10);
  const recoveryCode = await ap.locator('.mfa-recovery-codes code').first().innerText();
  assert.ok(await ap.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await ap.getByRole('button', { name: 'I saved the codes. Continue', exact: true }).click();
  await ap.getByRole('button', { name: 'New merchant', exact: true }).waitFor();
  await db.query("UPDATE sessions SET mfa_at=now()-interval '16 minutes' WHERE user_id=$1", [
    adminId,
  ]);
  await reloadPage(ap);
  await ap.getByRole('heading', { name: 'Verify your identity', exact: true }).waitFor();
  await ap.getByRole('button', { name: 'Use a recovery code', exact: true }).click();
  await ap.getByLabel('Unused recovery code', { exact: true }).fill(recoveryCode);
  await ap.getByRole('button', { name: 'Verify identity', exact: true }).click();
  await ap.getByRole('button', { name: 'New merchant', exact: true }).waitFor();
  await ap.unroute('**/api/v1/session');
  ok(
    'Platform MFA setup renders in Arabic/English, decodes its real QR, presents ten recovery codes and resumes with a one-use code; no secrets are written to evidence',
  );
  await db.query(
    "UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
    [customerSession.user.id],
  );
  await reloadPage(up);
  await up.getByRole('progressbar', { name: 'Stamp progress', exact: true }).waitFor();
  assert.ok(new URL(up.url()).pathname.startsWith('/customer/'));
  assert.equal(await up.locator('input[type=email],input[type=password]').count(), 0);
  ok(
    'Expired customer sessions resume the same card automatically from the valid device credential',
  );
  if ((await op.locator('html').getAttribute('lang')) === 'ar')
    await op.getByRole('button', { name: 'English', exact: true }).click();
  await login(op, email('owner'), '/login', true, ownerNewPassword);
  await merchantTab(op, 'Customers and segments');
  await op.locator('.customer-recovery-tool summary').click();
  await op.getByLabel('Full customer number', { exact: true }).fill(customerPhone);
  await op.getByRole('button', { name: 'Find the card', exact: true }).click();
  await op
    .locator('.customer-recovery-tool .subpanel strong')
    .filter({ hasText: 'Browser Customer' })
    .waitFor();
  await op.getByLabel('The customer asked to restore their card', { exact: true }).check();
  await op.getByRole('button', { name: 'Prepare WhatsApp recovery', exact: true }).click();
  const recoveryDraft = new URL(
    (await op.getByRole('link', { name: 'Open WhatsApp', exact: true }).getAttribute('href'))!,
  );
  assert.equal(recoveryDraft.pathname, '/' + customerPhone.slice(1));
  const recoveryToken = /\/r\/([a-f0-9]{64})/.exec(recoveryDraft.searchParams.get('text')!)![1]!;
  const beforeRecovery = (
    await db.query(
      'SELECT balance,revision,cycle_number FROM loyalty_accounts WHERE membership_id=$1',
      [membership],
    )
  ).rows[0];
  const recoveredContext = await context(),
    recoveredPage = await recoveredContext.newPage();
  await navigateTo(recoveredPage, '/r/' + recoveryToken);
  await recoveredPage.getByRole('button', { name: 'Open my card', exact: true }).waitFor();
  assert.equal(
    (
      await db.query('SELECT used_at FROM customer_recoveries WHERE token_hash=$1', [
        tokenHash(recoveryToken),
      ])
    ).rows[0].used_at,
    null,
  );
  assert.equal(
    await recoveredPage.getByLabel('Remove access from old devices', { exact: true }).isChecked(),
    true,
  );
  await recoveredPage.getByRole('button', { name: 'Open my card', exact: true }).click();
  await recoveredPage.getByRole('progressbar', { name: 'Stamp progress', exact: true }).waitFor();
  assert.equal(new URL(recoveredPage.url()).pathname, '/customer/' + membership);
  assert.deepEqual(
    (
      await db.query(
        'SELECT balance,revision,cycle_number FROM loyalty_accounts WHERE membership_id=$1',
        [membership],
      )
    ).rows[0],
    beforeRecovery,
  );
  await reloadPage(up);
  await up.getByRole('heading', { name: 'Your card is not on this device', exact: true }).waitFor();
  assert.equal(await up.locator('input[type=email],input[type=password]').count(), 0);
  await navigateTo(recoveredPage, '/r/' + recoveryToken);
  await recoveredPage
    .getByRole('alert')
    .filter({ hasText: 'This link was used or expired.' })
    .waitFor();
  await navigateTo(recoveredPage, '/customer/account');
  await recoveredPage.getByRole('button', { name: 'Review deletion', exact: true }).click();
  await recoveredPage
    .getByLabel('I understand this deletes access to all my cards and rewards', { exact: true })
    .check();
  await recoveredPage.route(
    '**/api/v1/me/privacy/delete',
    async (route) => {
      const saved = await route.fetch();
      assert.equal(saved.status(), 200);
      await route.abort('failed');
    },
    { times: 1 },
  );
  await recoveredPage.getByRole('button', { name: 'Delete customer account', exact: true }).click();
  await recoveredPage
    .getByRole('heading', { name: 'Customer account deleted', exact: true })
    .waitFor();
  assert.deepEqual(
    (
      await db.query(
        'SELECT balance,revision,cycle_number FROM loyalty_accounts WHERE membership_id=$1',
        [membership],
      )
    ).rows[0],
    beforeRecovery,
  );
  assert.equal(
    (await recoveredContext.cookies()).filter((cookie) =>
      /^(?:__Host-)?nq_device$/.test(cookie.name),
    ).length,
    0,
  );
  assert.equal(
    (
      await recoveredContext.request.get('/api/v1/session', {
        headers: { 'x-nuqta-workspace': 'customer' },
      })
    ).status(),
    401,
  );
  ok(
    'Customer deletion recovers a lost committed reply from a verified receipt, clears device access, and preserves the exact stamp balance and cycle',
  );
  await recoveredContext.close();
  ok(
    'Owner prepares a requested manual WhatsApp recovery; GET leaves it unused, a new browser restores the same stamps once, and the old device loses access without a password screen',
  );
  const staffReset = await context(),
    staffResetPage = await staffReset.newPage();
  await navigateTo(staffResetPage, '/login?dev=1');
  if ((await staffResetPage.locator('html').getAttribute('lang')) === 'ar')
    await staffResetPage.getByRole('button', { name: 'English', exact: true }).click();
  await staffResetPage.getByRole('button', { name: 'Forgot password?', exact: true }).click();
  await staffResetPage.getByLabel('Email', { exact: true }).fill(email('owner'));
  await staffResetPage.getByRole('button', { name: 'Send recovery link', exact: true }).click();
  await staffResetPage.getByRole('status').filter({ hasText: 'If the account exists' }).waitFor();
  for (let i = 0; i < 200 && (await runOne(worker, c)); i++) {
    /* Local-only durable mailbox dispatch. */
  }
  await staffResetPage.locator('.local-inbox summary').click();
  await staffResetPage.getByRole('button', { name: 'Open local mailbox', exact: true }).click();
  const resetEmail = staffResetPage.locator('.mailbox > div').filter({ hasText: email('owner') });
  await resetEmail.getByRole('link', { name: 'Choose a new password', exact: true }).click();
  const recoveredPassword = 'Recovered-' + randomBytes(14).toString('hex');
  await staffResetPage.getByLabel('New password', { exact: true }).fill(recoveredPassword);
  await staffResetPage.getByLabel('Confirm password', { exact: true }).fill(recoveredPassword);
  await staffResetPage.getByRole('button', { name: 'Save password', exact: true }).click();
  await staffResetPage.getByRole('status').filter({ hasText: 'Password saved' }).waitFor();
  await staffResetPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await staffResetPage.locator('input[type=email]').waitFor();
  await login(staffResetPage, email('owner'), '/login', true, recoveredPassword);
  await staffResetPage.waitForURL('**/merchant');
  await staffResetPage.locator('[data-portal=merchant]').waitFor();
  ok(
    'Forgot password dispatches through the durable worker mailbox; the real recovery link opens the reset screen and the new password restores the owner workspace',
  );
  await staffReset.close();
  await ap.setViewportSize({ width: 1365, height: 900 });
  await navigateTo(ap, '/platform');
  await businessRow.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await ap.getByRole('button', { name: 'Subscription', exact: true }).click();
  await ap.getByRole('button', { name: 'Record payment', exact: true }).click();
  await ap.getByLabel('Amount in EGP', { exact: true }).fill('٩٥٠٫٥٠');
  const lastDate = new Date(Date.now() + 30 * 86400000),
    last = {
      year: String(lastDate.getFullYear()),
      month: String(lastDate.getMonth() + 1),
      day: String(lastDate.getDate()),
    };
  await choose(
    ap.getByRole('combobox', { name: 'Last covered day · Year', exact: true }),
    last.year,
  );
  await choose(
    ap.getByRole('combobox', { name: 'Last covered day · Month', exact: true }),
    last.month,
  );
  await choose(ap.getByRole('combobox', { name: 'Last covered day · Day', exact: true }), last.day);
  const paymentReference = 'PAY-' + stamp;
  await ap.getByLabel('Payment reference (optional)', { exact: true }).fill(paymentReference);
  await ap.getByLabel('Recording reason', { exact: true }).fill('Synthetic browser manual payment');
  await screenshot(ap, 'subscription-en');
  await ap.setViewportSize({ width: 390, height: 844 });
  await ap.getByRole('button', { name: 'العربية', exact: true }).click();
  assert.ok(await ap.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.ok(
    await ap
      .locator('.date-field .nq-select-trigger > span')
      .evaluateAll((elements) => elements.every((el) => el.scrollWidth <= el.clientWidth + 1)),
    'Date parts, including the four-digit year, must remain fully visible',
  );
  await screenshot(ap, 'subscription-ar-mobile');
  await ap.getByRole('button', { name: 'English', exact: true }).click();
  await ap.setViewportSize({ width: 1365, height: 900 });
  let savedPaymentKey = '';
  await ap.route(
    '**/api/v1/platform/merchants/' + mid + '/subscription/payments',
    async (route) => {
      savedPaymentKey = route.request().headers()['idempotency-key']!;
      assert.equal(route.request().postDataJSON().amountMinor, 95050);
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort('failed');
    },
    { times: 1 },
  );
  await ap.getByRole('button', { name: 'Save payment', exact: true }).click();
  await ap.getByRole('button', { name: 'Retry same change', exact: true }).waitFor();
  await reloadPage(ap);
  await businessRow.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await ap.getByRole('button', { name: 'Subscription', exact: true }).click();
  const replay = ap.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/subscription/payments'),
  );
  await ap.getByRole('button', { name: 'Retry same change', exact: true }).click();
  assert.equal((await replay).headers()['idempotency-key'], savedPaymentKey);
  await ap.getByRole('status').filter({ hasText: 'The subscription change was saved.' }).waitFor();
  assert.equal(
    (
      await db.query('SELECT count(*)::int AS n FROM subscription_payments WHERE merchant_id=$1', [
        mid,
      ])
    ).rows[0].n,
    1,
  );
  const paidRow = ap.locator('tr').filter({ hasText: paymentReference });
  await paidRow.getByRole('button', { name: 'Void payment record', exact: true }).click();
  const voidDialog = ap.getByRole('dialog', { name: 'Void payment record', exact: true });
  await voidDialog
    .getByLabel('Reason for change', { exact: true })
    .fill('Synthetic correction without removing history');
  await voidDialog.getByRole('button', { name: 'Save change', exact: true }).click();
  await voidDialog.waitFor({ state: 'hidden' });
  await paidRow.getByText('Voided', { exact: true }).waitFor();
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM subscription_payment_voids WHERE merchant_id=$1',
        [mid],
      )
    ).rows[0].n,
    1,
  );
  ok(
    'Branded manual subscription dates and exact Arabic money entry survive a lost reply/reload with one payment; voiding keeps the original record',
  );
  const legalContext = await context(),
    legalPage = await legalContext.newPage();
  legalPage.on('pageerror', capturePageError);
  await navigateTo(legalPage, '/privacy?lang=ar');
  await legalPage.getByRole('heading', { name: 'الخصوصية', exact: true }).waitFor();
  assert.equal(await legalPage.locator('html').getAttribute('dir'), 'rtl');
  await screenshot(legalPage, 'privacy-ar');
  await navigateTo(legalPage, '/terms?lang=en');
  await legalPage.getByRole('heading', { name: 'Terms of use', exact: true }).waitFor();
  await legalPage
    .getByText('Local testing draft — legal review required before launch.', { exact: true })
    .waitFor();
  await screenshot(legalPage, 'terms-en');
  await legalContext.close();
  ok(
    'Privacy and terms are public bilingual pages with explicit legal-review status; linked language overrides a different saved preference for that page',
  );
  assert.deepEqual(errors, []);
  await writeFile(
    evidence + '/browser.json',
    JSON.stringify(
      {
        at: new Date().toISOString(),
        browser: browserName,
        browserVersion: browser.version(),
        appEnv: c.APP_ENV,
        checks,
        errors,
        merchantId: mid,
        membershipId: membership,
        metrics,
        afterRequests,
        limits: [
          'Camera hardware was not used; the real token was entered through the supported manual path.',
          'Creator-set email/password accounts and local invitation mail sink; no external email delivery.',
          'Local PostgreSQL and separate browser contexts; no staging or production claim.',
        ],
      },
      null,
      2,
    ),
  );
} catch (e) {
  for (const x of browser.contexts())
    for (const p of x.pages()) {
      const alerts = await p
        .locator('.notice.error,.error-text')
        .allTextContents()
        .catch(() => []);
      if (alerts.length) console.error('UI errors:', alerts.join(' | '));
    }
  console.error(
    'Browser verification failed:',
    e instanceof Error
      ? e.message.replace(
          /\/(invite|reset-password|r|customer\/recoveries)\/[^\s]+/g,
          '/$1/[redacted]',
        )
      : 'Unknown',
  );
  if (e instanceof Error)
    console.error(e.stack?.split('\n').find((line) => line.includes('test-e2e.ts:')) || '');
  process.exitCode = 1;
} finally {
  await registrationApp.close();
  await browser.close();
  await worker.end();
  await db.end();
}
