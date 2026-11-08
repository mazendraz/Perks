import { buildApp } from './server.js';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const { app, config } = await buildApp();
const assets = resolve('apps/web/dist');
if (existsSync(assets)) {
  await app.register(fastifyStatic, { root: assets, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/health/'))
      return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    return reply.sendFile('index.html');
  });
}
await app.listen({ host: config.HOST, port: config.PORT });
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
