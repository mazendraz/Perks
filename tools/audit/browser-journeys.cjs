// Evidence runner against disposable browser storage; never uses the owner's browser profile.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const rb = process.env.NUQTA_AUDIT_NODE_MODULES ? createRequire(path.join(process.env.NUQTA_AUDIT_NODE_MODULES, '_audit.cjs')) : require;
const { chromium } = rb('playwright');
process.env.DEMO_PORT = process.env.DEMO_PORT || '4175';
const server = require('../serve-demo.cjs');
const origin = 'http://127.0.0.1:' + process.env.DEMO_PORT;
const out = path.resolve(__dirname, '../../docs/execution/evidence');
const results = [], errors = [];
let browser;
const route = (name, query = '') => origin + '/' + encodeURIComponent('Nuqta - ' + name + '.html') + query;
async function load(page, name, query = '') {
  await page.goto(route(name, query));
  await page.waitForFunction(() => !document.getElementById('__bundler_loading'));
  await page.waitForTimeout(150);
}
async function test(id, kind, fn) {
  try { const evidence = await fn(); results.push({ id, kind, status: kind === 'finding' ? 'REPRODUCED' : 'PASS', evidence }); }
  catch (e) { results.push({ id, kind, status: 'FAIL', error: e.message }); }
  console.log(id, results.at(-1).status);
}
function assert(v, msg) { if (!v) throw new Error(msg); }
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(7000);
  for (const [name, views] of [
    ['Super Admin', ['overview','merchants','provisioning','operations','support','billing','integrations','system','settings']],
    ['Merchant Dashboard', ['home','customers','programs','branches','team','marketing','brand','subscription','settings']]
  ]) for (const view of views) await test(`VIEW:${name}:${view}`, 'render', async () => {
    await load(page, name, '?view=' + view);
    const body = await page.locator('body').innerText();
    assert(body.length > 200 && !body.includes('[bundle]'), 'Missing screen or runtime error');
    return { url: page.url(), textLength: body.length, headings: await page.locator('h1,h2').allTextContents() };
  });
  await test('UI:stamp-lost-response-replay-cross-tab', 'journey', async () => {
    await load(page, 'Cashier Portal'); await page.evaluate(() => { NQ.reset(); NQ.setLang('en'); });
    const customer = await ctx.newPage(); await load(customer, 'Customer Portal', '?m=m_cafe');
    await page.getByRole('button', { name: /^Scan card/ }).click();
    await page.getByRole('button').filter({ hasText: 'Sara M.' }).first().click();
    await page.getByRole('button', { name: 'Add stamp', exact: true }).click();
    await page.locator('input').first().fill('AUDIT-UI-001');
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    await page.evaluate(() => NQ.setSession({ network: 'lost' }));
    await page.getByRole('button', { name: 'Confirm stamp', exact: true }).click();
    await page.getByText('Confirmed: recorded exactly once.', { exact: true }).waitFor();
    await customer.waitForFunction(() => NQ.membership('ms_cafe_c1').balance === 0);
    const before = await page.evaluate(() => NQ.state.transactions.length);
    await page.getByRole('button', { name: 'Demo: send the same request again', exact: true }).click();
    await page.getByText('Duplicate request', { exact: true }).waitFor();
    const after = await page.evaluate(() => NQ.state.transactions.length);
    assert(before === after, 'Replay changed transaction count');
    await page.screenshot({ path: path.join(out, 'journey-stamp-replay.png') });
    const evidence = await page.evaluate(() => ({ balance: NQ.membership('ms_cafe_c1').balance, tx: NQ.state.transactions.find(t => t.receipt === 'AUDIT-UI-001'), available: NQ.rewardsOfMembership('ms_cafe_c1').filter(r => r.status === 'available').length }));
    evidence.customerTabBalance = await customer.evaluate(() => NQ.membership('ms_cafe_c1').balance);
    await customer.close(); return evidence;
  });
  await test('UI:customer-enrollment', 'journey', async () => {
    await load(page, 'Customer Portal', '?m=m_cafe&src=qr&b=b_zam&new=1');
    await page.evaluate(() => NQ.setLang('en'));
    await page.getByRole('button', { name: 'Join now', exact: true }).click();
    await page.locator('input').first().fill('audit.new@example.com');
    await page.getByRole('button', { name: 'Send code', exact: true }).click();
    await page.getByLabel('Enter the code', {exact:true}).fill('123456');
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    await page.getByRole('checkbox').first().click();
    await page.getByRole('button', { name: 'Create my card', exact: true }).click();
    await page.getByRole('button', { name: 'Open card', exact: true }).click();
    await page.getByText('New card!', { exact: false }).waitFor();
    const evidence = await page.evaluate(() => ({ customer: NQ.state.customers.find(c => c.email === 'audit.new@example.com'), membership: NQ.state.memberships.find(m => m.customerId === NQ.state.session.customerId && m.merchantId === 'm_cafe') }));
    await page.reload(); await page.waitForFunction(() => !!window.NQ);
    evidence.persistedAfterReload = await page.evaluate(() => !!NQ.state.customers.find(c => c.email === 'audit.new@example.com'));
    return evidence;
  });
  await test('UI:merchant-nested-screens', 'journey', async () => {
    await load(page, 'Merchant Dashboard', '?m=m_cafe&view=customers');
    await page.evaluate(() => NQ.setLang('en'));
    await page.getByRole('button', { name: 'Sara Mahmoud', exact: true }).first().click();
    const detail = (await page.locator('body').innerText()).slice(0, 350);
    await load(page, 'Merchant Dashboard', '?m=m_cafe&view=programs');
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    assert(await page.locator('input').count() > 0, 'Program editor missing');
    return { customerDetail: detail, programEditorInputs: await page.locator('input').count() };
  });
  await test('UI:provisioning-wizard', 'journey', async () => {
    await load(page, 'Super Admin', '?view=provisioning');
    await page.evaluate(() => NQ.setLang('en'));
    await page.getByRole('button', { name: 'Provision a merchant', exact: true }).first().click();
    const text = await page.locator('body').innerText();
    assert(text.includes('Business & contact'), 'Wizard not open');
    return { steps: ['Business & contact','Logo & identity','Program rules','Branches & team','QR, NFC & wallet','Messaging & plan','Review & activate'].map(s => ({ name:s, present:text.includes(s) })), inputs: await page.locator('input').count() };
  });
  await load(page, 'Cashier Portal');
  const probes = [
    ['MOCK:arithmetic-replay-receipt', false, async () => { NQ.reset(); const p={merchantId:'m_cafe',branchId:'b_zam',staffId:'s_youssef',membershipId:'ms_cafe_c1',qty:2,receipt:'AUDIT-M1',attemptId:'AUDIT-A1'}; const r=await NQ.addStamps(p), replay=await NQ.addStamps(p), duplicate=await NQ.addStamps({...p,attemptId:'AUDIT-A2',source:'request'}); return {balance:r.balance,rewards:r.rewards.length,replay:replay.replay,duplicate:duplicate.code}; }],
    ['MOCK:branch-and-disabled', false, async () => { NQ.reset();const p={merchantId:'m_cafe',branchId:'b_zam',staffId:'s_mai',membershipId:'ms_cafe_c1',qty:1,receipt:'AUDIT-M2',attemptId:'AUDIT-A2'}; return {branch:(await NQ.addStamps(p)).code,disabled:(await NQ.addStamps({...p,staffId:'s_omar'})).code}; }],
    ['MOCK:redeem-once', false, async () => { NQ.reset();await NQ.startRedemption('RW-501','s_youssef','b_zam');NQ.holderConfirm('RW-501');const a=await NQ.completeRedemption('RW-501'),b=await NQ.completeRedemption('RW-501');return {first:a.ok,second:b.code}; }],
    ['MOCK:request-approval', false, async () => { NQ.reset();const r=await NQ.approveRequest('SR-301',{staffId:'s_youssef',qty:1,receipt:'AUDIT-REQUEST',attemptId:'AUDIT-REQUEST-A'});return {ok:r.ok,status:NQ.state.requests.find(x=>x.id==='SR-301').status}; }],
    ['F01:cross-tenant-readable', true, async () => { NQ.reset();NQ.setSession({merchantId:'m_salon'});return {selectedMerchant:NQ.state.session.merchantId,foreignEmail:NQ.customer('c2').email,foreignMembership:NQ.membership('ms_cafe_c2').id}; }],
    ['F02:foreign-owner-awards', true, async () => { NQ.reset();return await NQ.addStamps({merchantId:'m_cafe',branchId:'b_zam',staffId:'s_nadia',membershipId:'ms_cafe_c1',qty:1,receipt:'FOREIGN-OWNER',attemptId:'FOREIGN-OWNER'}); }],
    ['F03:fractional-quantity', true, async () => { NQ.reset();return await NQ.addStamps({merchantId:'m_cafe',branchId:'b_zam',staffId:'s_youssef',membershipId:'ms_cafe_c1',qty:1.5,receipt:'FRACTION',attemptId:'FRACTION'}); }],
    ['F04:unsigned-qr-no-expiry', true, async () => { NQ.reset();return NQ.resolveScan('NQ.ms_cafe_c1','m_cafe'); }],
    ['F05:provisioning-duplicates', true, async () => { NQ.reset();const d=JSON.parse(JSON.stringify(NQ.state.drafts[0]));d.data.programName='Audit';d.data.reward='Tea';const a=await NQ.activateMerchant(d),b=await NQ.activateMerchant(d);return {first:a.merchant.id,second:b.merchant.id,created:NQ.state.merchants.filter(x=>x.name.ar===d.data.name).length}; }],
    ['F06:correction-applied-twice', true, async () => { NQ.reset();const before=NQ.membership('ms_cafe_c3').balance;NQ.decideCorrection('CR-12',true,'s_karim');NQ.decideCorrection('CR-12',true,'s_karim');return {before,after:NQ.membership('ms_cafe_c3').balance,transactions:NQ.state.transactions.filter(x=>x.correctionId==='CR-12').length}; }],
    ['F07:expired-reward-after-holder-confirm', true, async () => { NQ.reset();await NQ.startRedemption('RW-501','s_youssef','b_zam');NQ.holderConfirm('RW-501');NQ.reward('RW-501').expiresAt=Date.now()-1;return await NQ.completeRedemption('RW-501'); }],
    ['F08:request-approval-race', true, async () => { NQ.reset();const r=await Promise.all([NQ.approveRequest('SR-301',{staffId:'s_youssef',qty:1,receipt:'RACE-1',attemptId:'RACE-1'}),NQ.approveRequest('SR-301',{staffId:'s_youssef',qty:1,receipt:'RACE-2',attemptId:'RACE-2'})]);return {results:r.map(x=>x.ok),transactions:NQ.state.transactions.filter(x=>x.requestId==='SR-301').length}; }],
    ['F09:replay-before-authorization', true, async () => { NQ.reset();const p={merchantId:'m_cafe',branchId:'b_zam',staffId:'s_youssef',membershipId:'ms_cafe_c1',qty:1,receipt:'REPLAY-AUTH',attemptId:'REPLAY-AUTH'};await NQ.addStamps(p);NQ.updateStaff('s_youssef',{status:'disabled'});return await NQ.addStamps(p); }],
  ];
  for (const [id, finding, fn] of probes) await test(id, finding ? 'finding' : 'mock', async () => {
    const evidence = await page.evaluate(fn);
    const validation = {
      'MOCK:arithmetic-replay-receipt': e => e.balance===1 && e.rewards===1 && e.replay && e.duplicate==='receipt_used',
      'MOCK:branch-and-disabled': e => e.branch==='branch_unauthorized' && e.disabled==='staff_disabled',
      'MOCK:redeem-once': e => e.first && e.second==='reward_redeemed',
      'MOCK:request-approval': e => e.ok && e.status==='approved',
      'F01:cross-tenant-readable': e => !!e.foreignEmail,
      'F02:foreign-owner-awards': e => e.ok,
      'F03:fractional-quantity': e => e.ok,
      'F04:unsigned-qr-no-expiry': e => e.ok,
      'F05:provisioning-duplicates': e => e.created===2 && e.first!==e.second,
      'F06:correction-applied-twice': e => e.transactions===2,
      'F07:expired-reward-after-holder-confirm': e => e.ok,
      'F08:request-approval-race': e => e.transactions===2,
      'F09:replay-before-authorization': e => e.ok && e.replay,
    }[id];
    assert(validation(evidence), 'Observed result differs from expected evidence'); return evidence;
  });
  for (const name of ['Cashier Portal','Customer Portal','Merchant Dashboard','Super Admin']) for (const lang of ['ar','en']) await test(`LAYOUT:${name}:${lang}`, 'layout', async () => {
    await page.setViewportSize({ width:390, height:844 }); await load(page,name);
    await page.evaluate(l=>{NQ.reset();NQ.setLang(l);},lang); await page.waitForTimeout(100);
    const dims=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,dir:document.documentElement.dir,buttons:document.querySelectorAll('button').length}));
    await page.screenshot({path:path.join(out, name.toLowerCase().replaceAll(' ','-')+'-mobile-'+lang+'.png'),fullPage:true});
    return dims;
  });
  await browser.close();
})().catch(e => { errors.push(e.message); process.exitCode=1; }).finally(async () => {
  fs.writeFileSync(path.join(out,'browser-journeys.json'),JSON.stringify({at:new Date().toISOString(),results,errors},null,2)+'\n');
  console.log(JSON.stringify({counts:results.reduce((s,x)=>(s[x.status]=(s[x.status]||0)+1,s),{}),errors},null,2));
  if(browser) await browser.close();server.close();
});
