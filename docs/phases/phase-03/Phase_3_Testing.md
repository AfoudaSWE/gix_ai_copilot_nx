# Phase 3 Testing Evidence

Validation date: 2026-09-19. Windows, Node 22.15.0, pnpm 11.1.2, React 19.3.0,
Vitest 5.0.1, Playwright 1.63.0/Chromium. No provider credentials required.

## Previous-phase gate

Before modifying implementation, ran `pnpm validate` (all nine existing projects restored
from valid Nx cache), then a fresh execution:

```powershell
pnpm exec nx run-many '-t=lint,typecheck,test,build' --skip-nx-cache
```

Result: all nine projects passed all four targets; **131 tests passed, 1 optional OpenAI
smoke test skipped**, zero failures. Protocol, core, client, server, provider registry,
runtime, mock/OpenAI adapter contract tests and both previous integration examples passed.
The skip was the pre-existing credentials-gated test, not new skipped coverage.

## Phase 3 unit/component/integration checks

```powershell
pnpm exec nx run-many '-t=build,typecheck,lint,test' '--projects=react,ui,react-basic,react-custom-ui'
```

Result: all four projects and required dependency builds passed.

| Project         | Tests | Evidence                                                                                                                                                                                                                                                        |
| --------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| react           |     7 | StrictMode; no mount requests; optimistic send; incremental single assistant; full history; sequence dedup; stale/foreign events; stop; retry/regenerate/clear; truncated/synchronous failures; unmount/client change/isolation; URL client; SSR; render counts |
| ui              |    17 | Chat/suggestions; input/IME; safe failure/retry; controlled popup/Escape/focus; RTL sidebar/localization; renderer boundary; axe semantics; 9 malicious/malformed Markdown cases; GFM/code/link/copy                                                            |
| react-basic     |     3 | Real React UI → client → HTTP/SSE → server → core → runtime → Phase 2 mock; first text before completion; regenerate; provider AbortSignal on Stop; mid-stream failure and successful explicit retry                                                            |
| react-custom-ui |     1 | Headless-only example renders initial state on the server                                                                                                                                                                                                       |

All **28 Phase 3 Vitest tests** passed. The cancellation integration test waits for the
provider's actual AbortSignal, not merely a local status update. Streaming integration
uses an explicit gate between chunks to prove incremental rendering without a timing race.

## Browser checks

```powershell
pnpm exec playwright install chromium
pnpm test:e2e
```

The Nx `react-e2e:e2e` target builds both examples and dependencies, then starts three
loopback web servers using Playwright's lifecycle management. **6 tests passed**:

1. Keyboard-open popup, send, observe partial output, complete, regenerate, stop, close/
   reopen with retained history, Escape and focus restoration.
2. Fail-once mock provider, safe error, explicit retry, no duplicate user turn.
3. Mobile 390×844, RTL, dark theme, Tab containment, axe including contrast, reduced-motion
   cursor check. No accessibility violations in the scanned dialog.
4. Long streamed response: scrolling up stays put through completion; jump-to-latest works.
5. Embedded chat and nonmodal sidebar, focus and Escape.
6. Headless application sends/stops/clears without UI package dependency.

Desktop popup, completed Markdown and mobile RTL/dark screenshots were generated under
ignored `test-results/` and visually inspected. jsdom semantic scans disable the color
contrast rule because it needs browser layout; the real browser scan enables it. This is
automated and keyboard/visual evidence, not a claim of a formal WCAG certification or a
manual screen-reader audit across all assistive technology.

## Architecture, SSR and package review

- Nx graph: React depends on client/protocol; UI depends on React; headless example has no
  UI edge. No Phase 1–2 source/package manifests changed.
- Read-only ESLint `lintText` probes intentionally attempted React → server and UI →
  client imports. Both were rejected by `@nx/enforce-module-boundaries`; no probe files
  were needed.
- Node-only import and `renderToString(CopilotProvider + CopilotChat)` passed with no
  `window` global, independently of jsdom.
- `pnpm audit --prod --json`: zero info/low/moderate/high/critical advisories (156 total
  production dependencies including optional entries, as reported by pnpm).
- `pnpm pack` succeeded for React/UI into a temporary directory: JS/declarations/READMEs
  are present, UI CSS is present, compiled specs are absent. Nothing was published.
- New packages keep tests out of their package file lists, CSS is side-effectful, and root
  exports expose no store internals. Public runtime contracts remain framework-neutral.

## Performance evidence

The render-count test establishes a baseline after the first delta, then publishes 20
additional deltas. Host, action-only, status-only and thread-only render counts do not
increase. No delayed batching or unmeasured “faster” claim is made. Historical messages
retain identity for memoized renderers; active-message Markdown is still parsed on updates.

`node tools/measure-react.mjs` builds all exports, minifies and gzips with React and workspace
dependencies external. Initial measured React size: 5,874 bytes / 1,922 gzip. UI before the
Tab-wrap fix: 232,849 bytes / 57,325 gzip. Final measurements are recorded in Status.
The complete example production builds initially measured 488.56 kB / 147.51 gzip (basic)
and 320.34 kB / 97.37 gzip (headless), including React DOM/client/protocol and app code.
These two apps have different functionality, so the difference is not a controlled
performance benchmark. Markdown/GFM is the main additional UI dependency cost.

## Final regression

Fresh `pnpm exec nx run-many '-t=lint,typecheck,test,build' --skip-nx-cache` passed all
available targets across 14 projects: **159 tests passed, 1 existing optional OpenAI smoke
test skipped, 0 failures**. Lint/typecheck cover the browser project too; browser execution
is the separate six-test E2E target. Final package inspection and measurements are recorded
in [Phase_3_Status.md](Phase_3_Status.md).

Known build output: Vite's SPA bundle warns that `use client` directives are not retained.
The actual library artifacts are emitted with `tsc` and retain their directives. Node also
reports a harmless NO_COLOR/FORCE_COLOR conflict from the task runner. Neither is hidden
or treated as a failed build.
