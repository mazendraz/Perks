// Native browser runner, kept in plain JS so the same built bundle can be
// measured on Linux from Windows without loading platform-specific build tools.
const assert = require('node:assert/strict');
const { readFile, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');

async function run() {
  const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
  if (config.browserRoot) process.env.PLAYWRIGHT_BROWSERS_PATH = config.browserRoot;
  const { chromium, devices } = require('playwright');
  const app = require('fastify')({ logger: false });
  await app.register(require('@fastify/helmet'), {
    contentSecurityPolicy: {
      directives: { scriptSrc: config.scriptSources, upgradeInsecureRequests: null },
    },
  });
  await app.register(require('@fastify/static'), { root: resolve(config.root) });
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const browser = await chromium.launch({
    headless: true,
    args: process.platform === 'win32' ? ['--enable-gpu'] : [],
  });
  let report;
  try {
    const page = await browser.newPage({ ...devices['Pixel 5'] });
    await page.goto(origin);
    await page.locator('.loyalty-card').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('button', { name: 'Three stamps', exact: true }).click();
    await page.waitForTimeout(1700);
    const reset = async () => {
      await page.getByRole('button', { name: 'Reset two', exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') === '2' &&
          document.querySelectorAll('.nq-stamp-tool').length === 0,
      );
    };
    await reset();
    const session = await page.context().newCDPSession(page);
    const gpuInfo = await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
    await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const idle = await page.evaluate(
      () =>
        new Promise((resolveResult) => {
          const frames = [];
          let previous = 0,
            start = 0;
          const tick = (now) => {
            if (!start) start = previous = now;
            if (now > previous) frames.push(now - previous);
            previous = now;
            if (now - start < 500) requestAnimationFrame(tick);
            else resolveResult(frames);
          };
          requestAnimationFrame(tick);
        }),
    );
    const measure = () =>
      page.evaluate(
        () =>
          new Promise((resolveResult) => {
            const frames = [];
            let previous = 0,
              start = 0,
              maxTools = 0;
            const tick = (now) => {
              if (!start) {
                start = previous = now;
                window.nuqtaMotionFixture.stamp(3);
              }
              maxTools = Math.max(maxTools, document.querySelectorAll('.nq-stamp-tool').length);
              if (now > previous) frames.push(now - previous);
              previous = now;
              if (now - start < 1900) requestAnimationFrame(tick);
              else
                resolveResult({
                  frames,
                  maxTools,
                  balance: Number(
                    document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow'),
                  ),
                });
            };
            requestAnimationFrame(tick);
          }),
      );
    // Both runs retain the same frame budget. The uninstrumented sample makes
    // profiler overhead visible rather than concealing it in a single number.
    const measured = await measure();
    await reset();
    await session.send('Tracing.start', {
      categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame',
      transferMode: 'ReturnAsStream',
    });
    const traced = await measure();
    const complete = new Promise((resolveResult) =>
      session.once('Tracing.tracingComplete', resolveResult),
    );
    await session.send('Tracing.end');
    const { stream } = await complete;
    assert.ok(stream, 'Chrome must return a trace stream');
    let trace = '';
    for (;;) {
      const part = await session.send('IO.read', { handle: stream });
      trace += part.base64Encoded ? Buffer.from(part.data, 'base64').toString('utf8') : part.data;
      assert.ok(trace.length < 30 * 1024 * 1024);
      if (part.eof) break;
    }
    await session.send('IO.close', { handle: stream });
    await writeFile(resolve(config.directory, 'pixel5-cpu4x-trace.json'), trace);
    report = {
      at: new Date().toISOString(),
      runId: config.runId,
      platform: process.platform,
      node: process.version,
      browser: browser.version(),
      cpuThrottle: 4,
      maxFrameMs: Math.max(...measured.frames),
      framesOver32: measured.frames.filter((ms) => ms > 32).length,
      frameMs: measured.frames,
      idleMaxFrameMs: Math.max(...idle),
      maxConcurrentTools: measured.maxTools,
      finalBalance: measured.balance,
      tracedMaxFrameMs: Math.max(...traced.frames),
      tracedFramesOver32: traced.frames.filter((ms) => ms > 32).length,
      tracedMaxConcurrentTools: traced.maxTools,
      tracedFinalBalance: traced.balance,
      gpuCompositing: gpuInfo.gpu.featureStatus?.gpu_compositing,
      gpuDevices: gpuInfo.gpu.devices.map((device) => device.deviceString),
    };
    await writeFile(
      resolve(config.directory, 'pixel5-cpu4x-performance.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    for (const result of [measured, traced]) {
      assert.equal(result.maxTools, 3, 'all three overlapping stamp tools must actually render');
      assert.equal(result.balance, 5, 'all three visible stamps must commit');
      assert.equal(
        result.frames.filter((ms) => ms > 32).length,
        0,
        'all measured and traced frames must stay at or below32ms underCPU4x',
      );
    }
    console.log(
      JSON.stringify({
        status: 'passed',
        platform: report.platform,
        maxFrameMs: report.maxFrameMs,
        tracedMaxFrameMs: report.tracedMaxFrameMs,
      }),
    );
  } finally {
    await browser.close();
    await app.close();
  }
}
run().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
