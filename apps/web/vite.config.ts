import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy, { cspHashes } from '@vitejs/plugin-legacy';
import { legacyScriptHashes, scriptSources } from '../../packages/domain/src/browser-policy.js';
import assert from 'node:assert/strict';
import { webShellPlugin } from '../../tools/web-shell-plugin.js';
import { readFileSync } from 'node:fs';
assert.deepEqual(
  [...cspHashes].sort(),
  [...legacyScriptHashes].sort(),
  'Review legacy CSP hashes after a plugin update.',
);
assert.ok(
  readFileSync(new URL('../../deploy/Caddyfile', import.meta.url), 'utf8').includes(
    'script-src ' + scriptSources.join(' ') + ';',
  ),
  'Caddy and API script policies must match.',
);
export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ['iOS >= 13', 'Safari >= 13', 'Chrome >= 80', 'Android >= 8', 'Samsung >= 12'],
      renderModernChunks: false,
    }),
    webShellPlugin(),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4100', '/health': 'http://127.0.0.1:4100' },
  },
  build: { outDir: 'dist', sourcemap: false, cssTarget: ['safari13', 'chrome80'] },
});
