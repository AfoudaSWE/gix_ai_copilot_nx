# Phase 3 Files

## Created

- `packages/react/`: package.json, project.json, tsconfig.json, vitest.config.ts, README.md;
  `src/index.ts`, `types.ts`, `chat-store.ts`, `provider.tsx`, `provider.spec.tsx`.
- `packages/ui/`: package.json, project.json, tsconfig.json, vitest.config.ts, README.md;
  `src/index.ts`, `labels.ts`, `markdown.tsx`, `components.tsx`, `panels.tsx`, `styles.css`,
  `components.spec.tsx`.
- `examples/react-basic/`: package.json, project.json, tsconfig.json, vitest.config.ts,
  vite.config.ts, index.html, README.md; `src/assets.d.ts`, `app.tsx`, `main.tsx`, `styles.css`,
  `backend.ts`, `server.ts`, `integration.spec.tsx`.
- `examples/react-custom-ui/`: package.json, project.json, tsconfig.json, vitest.config.ts,
  vite.config.ts, index.html, README.md; `src/assets.d.ts`, `app.tsx`, `main.tsx`, `styles.css`,
  `app.spec.tsx`.
- `tests/browser/copilot.spec.ts`, `tests/browser/tsconfig.json`, `tests/browser/project.json`.
- `playwright.config.ts`, `tools/dev-react.mjs`, `tools/measure-react.mjs`.
- `docs/adr/0007-headless-react-state-and-lifecycle.md`,
  `docs/adr/0008-copilot-ui-rendering-and-styling.md`, `docs/CHANGELOG_PHASES.md`.
- All ten documents in this directory: Docs, Architecture, Implementation, Status,
  Testing, Decisions, API, Files, Issues and Handoff.

## Modified

- `package.json`, `pnpm-lock.yaml`: Phase 3 development tools and workspace dependencies,
  demo/E2E scripts; no unrelated framework-independent package changes.
- `tsconfig.json`: references to the new libraries and examples.
- `nx.json`: exclude TSX specs from production inputs consistently with existing TS specs.
- `eslint.config.js`: React/UI tag constraints, permitted example edges, ignored build/test
  artifact directories.
- `tools/vitest.shared.ts`: React/UI source aliases for tests.
- `.gitignore`: Vite/browser output directories.
- `README.md`, `docs/PROJECT_STATUS.md`, `docs/architecture/overview.md`,
  `docs/DECISIONS.md`, `docs/TECHNICAL_DEBT.md`: current capabilities, links and real limits.

No file under protocol/core/client/server/providers or the old examples was modified.
Generated `dist/`, `web-dist/`, tsbuildinfo, screenshots and browser traces are ignored.
No commits were created; `git diff` and `git ls-files --others --exclude-standard` show the
actual pending changes. This inventory describes source/config/docs, not generated output.
