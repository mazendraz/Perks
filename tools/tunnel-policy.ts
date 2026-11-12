import type { Connect, Plugin, PreviewOptions, ServerOptions } from 'vite';
import { resolve } from 'node:path';

export function quickOrigin(value: string) {
  if (!/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(value))
    throw new Error('Expected an exact HTTPS Quick Tunnel origin.');
  return value;
}
export function tunnelServer(origin: string, apiPort: number, webPort: number): ServerOptions {
  const host = new URL(quickOrigin(origin)).hostname;
  return {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    allowedHosts: [host],
    cors: { origin },
    fs: {
      allow: ['apps/web', 'packages/ui/src', 'packages/domain/src', 'node_modules'].map((p) =>
        resolve(p),
      ),
      deny: [
        '**/.env*',
        '**/.local/**',
        '**/.git/**',
        '**/.codex/**',
        '**/.agents/**',
        '**/.aws/**',
        '**/*.{crt,pem,key,sql,csv,log,sqlite,db,bak,dump}',
      ],
    },
    // Quick Tunnels do not support SSE. Force the existing polling fallback;
    // do not let a half-open proxy stream falsely report itself connected.
    proxy: { '/api': 'http://127.0.0.1:' + apiPort, '/health': 'http://127.0.0.1:' + apiPort },
  };
}
// The phone loads one built bundle instead of hundreds of dev modules over the tunnel.
export function tunnelPreview(origin: string, apiPort: number, webPort: number): PreviewOptions {
  const server = tunnelServer(origin, apiPort, webPort);
  return {
    host: server.host,
    port: server.port,
    strictPort: true,
    allowedHosts: server.allowedHosts,
    cors: server.cors,
    proxy: server.proxy,
  };
}
// Same boundary for the dev server and the built preview the phone loads.
const guard: Connect.NextHandleFunction = (req, res, next) => {
  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url || '/', 'http://loopback').pathname).replaceAll(
      '\\',
      '/',
    );
  } catch {
    res.statusCode = 400;
    res.end();
    return;
  }
  const dependencyCache = /(?:^|\/)node_modules\/\.vite\/deps\/[a-z0-9_.-]+\.js$/i.test(path);
  if ((/(^|\/)\.[^/]/.test(path) && !dependencyCache) || /^\/internal(?:\/|$)/.test(path)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  if (/^\/api\/v1\/(?:me|branches\/[^/]+)\/events$/.test(path)) {
    res.statusCode = 503;
    res.setHeader('Cache-Control', 'no-store');
    res.end();
    return;
  }
  next();
};
export const tunnelGuard: Plugin = {
  name: 'synthetic-tunnel-boundary',
  enforce: 'pre',
  configureServer(server) {
    server.middlewares.use(guard);
  },
  configurePreviewServer(server) {
    // The built preview has no source or dev-server paths; answer 404 instead of the app shell.
    server.middlewares.use((req, res, next) => {
      const path = (req.url || '/').split('?')[0]!;
      if (/^\/(?:@|src\/|node_modules\/|%40)/i.test(path)) {
        res.statusCode = 404;
        res.end();
        return;
      }
      guard(req, res, next);
    });
  },
};
