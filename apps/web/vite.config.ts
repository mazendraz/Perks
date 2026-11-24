import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy, { cspHashes } from '@vitejs/plugin-legacy';
import {
  legacyScriptHashes,
  scriptSources,
  legacyTargets,
} from '../../packages/domain/src/browser-policy.js';
import assert from 'node:assert/strict';
import { webShellPlugin } from '../../tools/web-shell-plugin.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
      targets: legacyTargets,
      renderModernChunks: false,
    }),
    webShellPlugin(),
  ],
  resolve: {
    // Exactly "zod" (not its subpaths, which the shim itself imports): configure it jitless first.
    alias: [
      {
        find: /^zod$/,
        replacement: fileURLToPath(new URL('./src/zod-jitless.ts', import.meta.url)),
      },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4100', '/health': 'http://127.0.0.1:4100' },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    cssTarget: ['safari13', 'chrome80'],
    // The shop-owner landing page is its own entry so it never loads the app bundle.
    rollupOptions: {
      input: {
        // Keep the key "index": the service worker precaches the app entry by its index-legacy name.
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        business: fileURLToPath(new URL('./business/index.html', import.meta.url)),
      },
    },
  },
});
