import type { Plugin } from 'vite';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { legacyScriptHashes } from '../packages/domain/src/browser-policy.js';
export async function writeNuqtaIcons(directory: string) {
  const iconSvg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#2B55CF"/><path d="M160 352V160l192 192V160" fill="none" stroke="#fff" stroke-width="48" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  );
  await mkdir(directory, { recursive: true });
  for (const size of [180, 192, 512])
    await sharp(iconSvg)
      .resize(size, size)
      .png()
      .toFile(resolve(directory, 'nuqta-' + size + '.png'));
  await sharp(iconSvg).png().toFile(resolve(directory, 'nuqta-maskable-512.png'));
}
export function webShellPlugin(): Plugin {
  let root: string, out: string;
  return {
    name: 'nuqta-private-shell',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      out = resolve(root, config.build.outDir);
    },
    async closeBundle() {
      const html = await readFile(resolve(out, 'index.html'), 'utf8');
      for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
        if (/(?:^|\s)src\s*=/.test(match[1]!) || !match[2]!.trim()) continue;
        assert.ok(
          legacyScriptHashes.includes(createHash('sha256').update(match[2]!).digest('base64')),
          'An unapproved inline script would violate CSP.',
        );
      }
      await writeNuqtaIcons(resolve(out, 'icons'));
      const files: string[] = [];
      async function walk(path: string) {
        for (const entry of await readdir(path, { withFileTypes: true })) {
          const child = resolve(path, entry.name);
          if (entry.isDirectory()) await walk(child);
          else files.push('/' + relative(out, child).replaceAll('\\', '/'));
        }
      }
      await walk(out);
      const allowed = files
        .filter(
          (path) =>
            path !== '/sw.js' && /\.(?:js|css|html|webmanifest|png|svg|ttf|woff2?)$/.test(path),
        )
        .sort();
      const shell = allowed.filter(
        (path) =>
          !path.endsWith('.js') ||
          !path.startsWith('/assets/') ||
          /\/(?:index|api|Select|polyfills)-legacy-/.test(path),
      );
      const digest = createHash('sha256');
      for (const path of allowed)
        digest.update(path).update(await readFile(resolve(out, '.' + path)));
      const version = digest.digest('hex').slice(0, 20),
        template = await readFile(resolve(root, 'service-worker.template.js'), 'utf8');
      await writeFile(
        resolve(out, 'sw.js'),
        template
          .replace("'__NUQTA_VERSION__'", JSON.stringify(version))
          .replace('/*__NUQTA_SHELL__*/[]', JSON.stringify(shell))
          .replace('/*__NUQTA_ALLOWED__*/[]', JSON.stringify(allowed)),
      );
      await writeFile(
        resolve(out, 'shell-build.json'),
        JSON.stringify({ version, precache: shell, allowed, apiCached: false }, null, 2),
      );
    },
  };
}
