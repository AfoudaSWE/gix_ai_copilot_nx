# ADR 0022: Website and documentation portal

- Status: Accepted
- Date: 2026-09-27

## Context

The project needs a product website and a developer documentation portal with the usability of
leading SDK sites (search, deep links, API reference, interactive examples), GIX branding,
SEO, accessibility and RTL readiness. The existing portal (`apps/docs`) was a small Vite + React
single-page app rendering the repository Markdown under hash URLs.

## Decision

- **One app, two experiences.** `apps/docs` serves the website (`/`, `/enterprise`,
  `/examples`) and the docs (`/docs/...`) from one shared GIX design system
  (`src/design/`): tokens, typography, buttons, badges, cards, tabs, callouts, code windows.
  No separate `website-ui` package: nothing else consumes it yet.
- **Keep the established stack** (Vite, React, react-markdown, remark-gfm). No Next.js/MDX or
  docs framework: every requirement was met with small, tested code.
- **Repository Markdown is the single source of truth.** Pages load `docs/**/*.md` directly;
  `src/docs/nav.ts` maps readable URLs to files. GitHub-style alerts (`> [!SECURITY]`) become
  callouts; fence meta (`title="a.ts" {2-3}`) adds file names and line highlights.
- **Readable URLs + static prerender.** A tiny History-API router; `scripts/prerender.mjs`
  renders every route to static HTML with per-page title, description, canonical, OpenGraph,
  Twitter and JSON-LD, plus `sitemap.xml`, `robots.txt` and `404.html`. Pages work without
  JavaScript and hydrate afterwards.
- **Route-level code splitting.** Page families and each Markdown file are separate chunks; the
  router loads the next route's code and data before switching (no loading flash).
- **Build-time data.** Vite virtual modules generate the search index (pages, headings, API
  symbols, CLI commands) and the API data (`docs/reference/api.json`, produced by
  `tools/api-reference.mjs` from the shipped `.d.ts` files, with signatures). Both are lazy
  chunks: search loads on first use, API data on API pages only.
- **Honest content.** Code samples on the homepage are imported from `apps/docs/snippets/`,
  which CI type-checks against the real packages; demos are labelled as scripted and show
  observable protocol events, never hidden reasoning; only shipped integrations are listed.
- **Self-hosted fonts** (`@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`,
  OFL): brand typography without third-party requests. No analytics, no cookies.

## Consequences

- Deploys as static files to any host that serves `path/index.html` and `404.html`.
- The site is dark by default with light/system themes applied before first paint.
- The official GIX logo is not in the repository; a text wordmark placeholder is used until it is.
