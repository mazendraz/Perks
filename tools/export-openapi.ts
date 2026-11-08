import { mkdir, writeFile } from 'node:fs/promises';
import { buildApp } from '../apps/api/src/server.js';
const { app } = await buildApp({ LOG_LEVEL: 'silent' });
try {
  await app.ready();
  await mkdir('docs/execution/evidence/implementation', { recursive: true });
  await writeFile(
    'docs/execution/evidence/implementation/openapi.json',
    JSON.stringify(app.swagger(), null, 2),
  );
  console.log(
    'OpenAPI exported with shared command contracts, errors, authentication and concurrency headers.',
  );
} finally {
  await app.close();
}
