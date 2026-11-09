import { buildApp } from './server.js';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { operationalLog } from '../../../packages/domain/src/operational-log.js';
async function main() {
  const { app, config } = await buildApp();
  const assets = resolve('apps/web/dist');
  if (existsSync(assets)) {
    await app.register(fastifyStatic, { root: assets });
    app.setNotFoundHandler((req, reply) => {
      if (
        req.url.startsWith('/api/') ||
        req.url.startsWith('/health/') ||
        req.url === '/internal' ||
        req.url.startsWith('/internal/') ||
        req.url.startsWith('/assets/') ||
        /[.](?:js|css|png|svg|webmanifest|ttf|woff2?)(?:\?|$)/.test(req.url)
      )
        return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
      return reply.sendFile('index.html');
    });
  }
  try {
    await app.listen({ host: config.HOST, port: config.PORT });
    operationalLog('api', 'info', 'service.started');
  } catch {
    await app.close();
    throw new Error('Service start failed');
  }
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.once(signal, async () => {
      try {
        await app.close();
        operationalLog('api', 'info', 'service.stopped');
        process.exitCode = 0;
      } catch {
        operationalLog('api', 'error', 'service.start_failed');
        process.exitCode = 1;
      }
    });
}
void main().catch(() => {
  operationalLog('api', 'error', 'service.start_failed');
  process.exitCode = 1;
});
