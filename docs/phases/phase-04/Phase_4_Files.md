# Phase 4 Files

## Created

- `packages/context/`: package.json, project.json, tsconfig.json, vitest.config.ts,
  README.md; `src/index.ts`, `context-scope.ts`, `context-priority.ts`,
  `context-sensitivity.ts`, `context-item.ts`, `context-registry.ts`,
  `context-registry.spec.ts`, `context-serializer.ts`, `context-serializer.spec.ts`,
  `token-estimator.ts`, `token-estimator.spec.ts`, `context-compressor.ts`,
  `context-compressor.spec.ts`, `context-format.ts`, `resolved-context.ts`,
  `context-engine.ts`, `context-engine.spec.ts`, `state-store.ts`, `state-store.spec.ts`.
- `packages/react/src/`: `internals.ts`, `context-hooks.ts`, `context-hooks.spec.tsx`,
  `state-hooks.ts`, `state-hooks.spec.tsx`, `context-model-integration.spec.tsx`.
- `examples/react-context/`: package.json, project.json, tsconfig.json, vitest.config.ts,
  vite.config.ts, index.html, README.md; `src/assets.d.ts`, `applications.ts`, `app.tsx`,
  `main.tsx`, `styles.css`, `backend.ts`, `server.ts`, `integration.spec.tsx`.
- `docs/adr/0009-context-and-state-architecture.md`.
- All ten documents in `docs/phases/phase-04/`: Docs, Architecture, Implementation, Status,
  Testing, Decisions, API, Files, Issues, Handoff.

## Modified

- `packages/react/package.json`, `project.json`, `tsconfig.json` — added the
  `@gixcopilot/context` workspace dependency/reference.
- `packages/react/src/types.ts` — added `CopilotContextOptions` and the optional
  `CopilotProviderProps.context` field (additive).
- `packages/react/src/provider.tsx` — creates the per-provider registry/engine/state store,
  provides them via `CopilotInternalsContext`, wires `resolveContextMessage` into
  `createChatStore`.
- `packages/react/src/chat-store.ts` — added the optional `resolveContextMessage` parameter
  and the leading-`system`-message prepend in `consume()`.
- `packages/react/src/index.ts` — exports the two new hooks, their option/result types, and
  re-exports of `@gixcopilot/context` public types.
- `tools/vitest.shared.ts` — added the `@gixcopilot/context` workspace alias.
- `eslint.config.js` — added the `scope:context` module-boundary constraint; extended
  `scope:react`/`scope:example` to permit depending on it. Updated the file-header comment.
- `tsconfig.json` (root) — added `packages/context` and `examples/react-context` references.
- `docs/PROJECT_STATUS.md`, `docs/DECISIONS.md`, `docs/CHANGELOG_PHASES.md` — Phase 4 status,
  ADR index entry, and changelog entry.

No file under `packages/protocol`, `packages/core`, `packages/client`, `packages/server`,
`packages/providers/*`, `packages/ui`, or any Phase 1–3 example was modified. Generated
`dist/`, `web-dist/`, tsbuildinfo, and coverage output are ignored, as before. No commits
were created by this work; `git status`/`git diff` reflect the actual pending changes.
