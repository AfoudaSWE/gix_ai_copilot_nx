import { renderToString } from 'react-dom/server';
import { App } from './app.js';
import { THEME_BOOTSTRAP } from './design/theme.js';
import { normalizePath } from './router.js';
import { loadPage } from './page-registry.js';
import { allPaths, loadApi, metaFor } from './routes.js';
import { SITE } from './site.js';

export { THEME_BOOTSTRAP };

const escape = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Renders one URL to HTML plus its <head> tags (title, description, canonical, social cards). */
export async function render(url: string): Promise<{ html: string; head: string }> {
  const path = normalizePath(url);
  await loadPage(path);
  const html = renderToString(<App initialPath={path} />);
  const meta = metaFor(path);
  const tags = [
    `<title>${escape(meta.title)}</title>`,
    `<meta name="description" content="${escape(meta.description)}" />`,
    `<link rel="canonical" href="${escape(meta.canonical)}" />`,
    meta.noindex ? '<meta name="robots" content="noindex" />' : '',
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:site_name" content="${SITE.name}" />`,
    `<meta property="og:title" content="${escape(meta.title)}" />`,
    `<meta property="og:description" content="${escape(meta.description)}" />`,
    `<meta property="og:url" content="${escape(meta.canonical)}" />`,
    '<meta name="twitter:card" content="summary" />',
    `<meta name="twitter:title" content="${escape(meta.title)}" />`,
    `<meta name="twitter:description" content="${escape(meta.description)}" />`,
    path === '/'
      ? `<script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'SoftwareSourceCode',
          name: SITE.product,
          description: SITE.description,
          codeRepository: SITE.github,
          programmingLanguage: 'TypeScript',
          license: 'https://opensource.org/licenses/MIT',
          author: { '@type': 'Organization', name: SITE.company.name, url: SITE.company.url },
        }).replace(/</g, '\u003c')}</script>`
      : '',
  ].filter(Boolean);
  return { html, head: tags.join('\n    ') };
}

export async function paths(): Promise<string[]> {
  const api = await loadApi();
  return allPaths(api.map((pkg) => pkg.slug));
}

export const siteUrl = SITE.url;
