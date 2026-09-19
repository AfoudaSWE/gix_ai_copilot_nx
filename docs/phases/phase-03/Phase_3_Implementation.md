# Phase 3 Implementation

## Packages

- `packages/react`: typed public contracts, private presentation store, provider and six
  hooks. Stable actions, optimistic turns, incremental assistant updates, terminal
  metadata, real cancellation, retry/regenerate replay, local clear, SSR-safe initial
  rendering, StrictMode cleanup, provider isolation and stale-event checks.
- `packages/ui`: embedded chat, popup/sidebar, composable base components, five component
  slots, rendering boundaries, centralized labels, safe Markdown/GFM and code copying,
  light/dark/system CSS tokens, logical RTL layout, reduced motion, keyboard/IME behavior,
  completion announcements and reader-aware auto-scroll.
- `examples/react-basic`: Vite interface lab plus a real loopback Node server using Phase
  2 mock adapters. Streaming/slow/fail-once modes, layout/theme/RTL controls, integration
  tests through the full stack. Browser and server code have separate entry points.
- `examples/react-custom-ui`: independent headless interface with its own CSS and plain
  text rendering, SSR test, no UI package dependency.
- `tests/browser`: typed/linted Nx browser project with Playwright, no external services.
  `tools/dev-react.mjs` starts both examples and backend; `tools/measure-react.mjs` reuses
  Vite for reproducible package-size inspection.

Core, protocol, client, server and providers were **not modified**. Their existing public
APIs supply the full Phase 3 behavior. New manifests preserve ESM/NodeNext project
references and explicit Nx targets. UI CSS is copied to `dist` during build and exported
explicitly; package file lists exclude compiled tests from packing.

## Dependency review

| Dependency                                | Location                                        | Concrete reason / alternative considered                            |
| ----------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| React 19.3.0, peer `^19.0.0`              | React/UI peers; examples runtime                | Requested framework; no React added to core/client                  |
| React DOM 19.3.0                          | Examples runtime, package test dev dependencies | Browser mounting and SSR tests; not used by library implementation  |
| `react-markdown` 10.1.0                   | UI runtime                                      | Maintained safe AST renderer; browser has no Markdown parser        |
| `remark-gfm` 4.0.1                        | UI runtime                                      | Tables and common GFM; no hand-written Markdown parser              |
| `@types/react`, `@types/react-dom` 19.3.0 | Dev only                                        | Strict public types and React DOM test/example typing               |
| `@testing-library/react` 16.3.3           | Dev only                                        | Observable component/hook testing; avoids a custom mounting harness |
| jsdom 30.1.0                              | Dev only                                        | DOM environment for existing Vitest runner                          |
| axe-core 4.13.0                           | UI/root dev only                                | Automated semantic/contrast checks; complements keyboard tests      |
| Vite 8.3.0                                | Examples dev only                               | Browser examples/build; same tool family already used by Vitest     |
| `@playwright/test` 1.63.0                 | Root dev only                                   | Real browser focus, layout, network, keyboard and motion checks     |

Version metadata and official React/remark/Playwright documentation were checked during
implementation. Production audit found zero advisories. Exact resolved versions and
transitive dependencies are in `pnpm-lock.yaml`. No existing unrelated dependency was
deliberately upgraded. No state library, dialog library, Tailwind, highlighter or Storybook
was added. Bundle cost is recorded in Testing and ADR 0008.

Attachments were omitted because existing message contracts carry only text. There is no
upload/ingestion/RAG implementation or inactive control that implies one exists.
