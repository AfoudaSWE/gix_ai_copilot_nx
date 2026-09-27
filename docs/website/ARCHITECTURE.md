# Website architecture

```text
docs/**/*.md ─────────────┐            apps/docs/src
docs/reference/api.json ──┤            ├── main.tsx           client entry: load route, hydrate
apps/docs/snippets/*.ts ──┤            ├── entry-server.tsx   render(url) -> HTML + <head> tags
                          │            ├── app.tsx            router, search, error boundary
            vite.config.ts             ├── router.tsx         History API router, <Link>
            ├── link check             ├── routes.ts          URL -> page, SEO metadata, data preload
            ├── virtual:gix-search-index                      ├── page-registry.ts  route code splitting
            └── virtual:gix-api        ├── design/            GIX design system (shared)
                                       ├── site/              website pages, header/footer, demos
                                       └── docs/              docs layout, Markdown, search, API pages
```

## Build pipeline

1. `tsc -b` type-checks the app.
2. `vite build` writes the client to `web-dist/`: a small shell chunk, one chunk per page family,
   one per Markdown file, and lazy chunks for the search index and API data.
3. `vite build --ssr src/entry-server.tsx` writes a Node renderer to `dist-ssr/`.
4. `scripts/prerender.mjs` renders every route (`allPaths()` in `routes.ts`) to
   `web-dist/<route>/index.html`, then writes `404.html`, `sitemap.xml` and `robots.txt`.

## Runtime

- `main.tsx` loads the current route's component chunk and data (`loadPage`), then hydrates the
  prerendered HTML (or renders, in development).
- Client navigation (`<Link>`) preloads the next route before switching, updates
  `document.title`, moves focus to the new `<h1>`, and scrolls to the top or to the `#fragment`
  once content is ready.
- An error boundary around each page keeps a failing demo from blanking the site.

## Data sources

| Data | Source | Loaded |
| --- | --- | --- |
| Guides and reference pages | `docs/**/*.md` through `import.meta.glob` | per page |
| API reference | `docs/reference/api.json` (generated) | API pages only |
| Search index | built from the above at build time | first search |
| Homepage code | `apps/docs/snippets/*` (type-checked) | homepage chunk |
| Examples | `EXAMPLES` in `src/site/pages.tsx` (real `examples/` directories) | examples page |
