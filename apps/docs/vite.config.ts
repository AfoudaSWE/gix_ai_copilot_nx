import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Fails the build when a relative Markdown link in the docs points to a missing file. */
function checkLinks(): Plugin {
  return {
    name: 'docs-link-check',
    buildStart() {
      const docs = resolve(import.meta.dirname, '../../docs');
      const dirs = ['guides', 'production', 'reference', 'migrations'].map((dir) => join(docs, dir)).filter(existsSync);
      const files = [...dirs.flatMap((dir) => readdirSync(dir).filter((file) => file.endsWith('.md')).map((file) => join(dir, file))), ...['VERSIONING.md', 'RELEASING.md', 'ARCHITECTURE_OVERVIEW.md', 'ROADMAP.md'].map((file) => join(docs, file)).filter(existsSync)];
      const broken: string[] = [];
      for (const file of files) {
        for (const match of readFileSync(file, 'utf8').matchAll(/\]\(([^)\s]+)\)/g)) {
          const href = match[1] ?? '';
          if (/^[a-z]+:/i.test(href) || href.startsWith('#')) continue;
          const target = resolve(dirname(file), href.split('#')[0] ?? '');
          if (!existsSync(target)) broken.push(`${file.slice(docs.length + 1)} -> ${href}`);
        }
      }
      if (broken.length > 0) this.error(`Broken documentation links:\n  ${broken.join('\n  ')}`);
    },
  };
}

export default defineConfig({
  plugins: [checkLinks()],
  base: './',
  server: { host: '127.0.0.1', port: 5200, strictPort: true, fs: { allow: ['../..'] } },
  build: { outDir: 'web-dist' },
});
