import type { Plugin } from 'vite';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { legacyScriptHashes } from '../packages/domain/src/browser-policy.js';
import { perksIconSvg } from '../packages/domain/src/brand.js';
export async function writePerksIcons(directory: string) {
  await mkdir(directory, { recursive: true });
  const rounded = Buffer.from(perksIconSvg({ rounded: true })),
    square = Buffer.from(perksIconSvg({ rounded: false })),
    maskable = Buffer.from(perksIconSvg({ rounded: false, maskable: true }));
  // iOS masks the apple-touch icon itself, so it gets the full-bleed square.
  await sharp(square).resize(180, 180).png().toFile(resolve(directory, 'perks-180.png'));
  for (const size of [192, 512])
    await sharp(rounded)
      .resize(size, size)
      .png()
      .toFile(resolve(directory, 'perks-' + size + '.png'));
  await sharp(maskable).resize(512, 512).png().toFile(resolve(directory, 'perks-maskable-512.png'));
}
export function webShellPlugin(): Plugin {
  let root: string, out: string;
  return {
    name: 'perks-private-shell',
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
      await writePerksIcons(resolve(out, 'icons'));
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
            path !== '/sw.js' && /\.(?:js|css|html|webmanifest|png|svg|ttf|otf|woff2?)$/.test(path),
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
