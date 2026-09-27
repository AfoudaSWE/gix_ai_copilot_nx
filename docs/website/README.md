# GIX AI website and documentation

`apps/docs` builds the GIX AI product website (`/`, `/enterprise`, `/examples`) and the
developer documentation (`/docs/...`) as one static site. Design:
[ADR 0022](../adr/0022-website-and-documentation-portal.md).

## Everyday commands

```sh
pnpm --filter @gixcopilot/docs dev        # http://127.0.0.1:5200 (live reload, client-rendered)
pnpm exec nx run docs:build               # typecheck + client build + SSR build + prerender -> apps/docs/web-dist
pnpm --filter @gixcopilot/docs preview    # serve web-dist exactly like production (real 404s)
pnpm exec nx run-many -t lint typecheck test -p docs
pnpm exec playwright test --config tests/browser/website.config.ts   # E2E + axe (needs a build first)
```

## Common tasks

| Task | How |
| --- | --- |
| Add a documentation page | Write `docs/guides/<name>.md`, then add it to `DOC_SECTIONS` in `apps/docs/src/docs/nav.ts` ([Authoring](DOCS_AUTHORING.md)) |
| Add a navigation entry | Same file; the sidebar, previous/next, search index, sitemap and prerender all follow |
| Add a code example | A fenced block in Markdown; for examples that must compile, add a file under `apps/docs/snippets/` and mark the block `<!-- snippet: file.ts -->` |
| Add a callout | `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, `> [!SECURITY]`, `> [!EXPERIMENTAL]` |
| Add a diagram | A `text` fence, or the `Flow` / `GixArchitectureNode` / demo components in `apps/docs/src/site/` |
| Update the API reference | `pnpm build && node tools/api-reference.mjs` (writes `docs/reference/api.md` and `api.json`) |
| Change colors or type | `apps/docs/src/design/tokens.css` only ([Design system](DESIGN_SYSTEM.md)) |
| Deploy | Upload `apps/docs/web-dist/` ([Deployment](DEPLOYMENT.md)) |

## More

[Architecture](ARCHITECTURE.md) · [Design system](DESIGN_SYSTEM.md) ·
[Content structure](CONTENT_STRUCTURE.md) · [Authoring](DOCS_AUTHORING.md) · [Search](SEARCH.md) ·
[SEO](SEO.md) · [Accessibility](ACCESSIBILITY.md) · [Deployment](DEPLOYMENT.md) ·
[Maintenance](MAINTENANCE.md)
