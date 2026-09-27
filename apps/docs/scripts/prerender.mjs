#!/usr/bin/env node
// Prerenders every website and documentation route to static HTML (fast first paint, SEO,
// works without JavaScript), then writes sitemap.xml, robots.txt and 404.html.
// Runs after `vite build` (client, web-dist/) and `vite build --ssr` (dist-ssr/).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'web-dist');
const template = readFileSync(join(dist, 'index.html'), 'utf8');
const server = await import(pathToFileURL(join(root, 'dist-ssr', 'entry-server.js')).href);

function page({ html, head }) {
  for (const marker of ['<!--theme-bootstrap-->', '<!--app-head-->', '<!--app-html-->']) {
    if (!template.includes(marker)) throw new Error(`index.html template is missing ${marker}`);
  }
  return template
    .replace('<!--theme-bootstrap-->', `<script>${server.THEME_BOOTSTRAP}</script>`)
    .replace('<!--app-head-->', head)
    .replace('<!--app-html-->', html);
}

function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

const paths = await server.paths();
for (const path of paths) {
  const file = path === '/' ? join(dist, 'index.html') : join(dist, path.slice(1), 'index.html');
  write(file, page(await server.render(path)));
}
write(join(dist, '404.html'), page(await server.render('/404')));

const today = new Date().toISOString().slice(0, 10);
write(
  join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths
    .map((path) => `  <url><loc>${server.siteUrl}${path === '/' ? '/' : path}</loc><lastmod>${today}</lastmod></url>`)
    .join('\n')}\n</urlset>\n`,
);
write(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${server.siteUrl}/sitemap.xml\n`);
console.log(`Prerendered ${paths.length} pages + 404.html, sitemap.xml, robots.txt`);
