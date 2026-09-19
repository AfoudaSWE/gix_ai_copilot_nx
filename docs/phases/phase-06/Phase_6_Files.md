# Phase 6 Files

## Created

- `packages/generative-ui/`: package.json, project.json, tsconfig.json, vitest.config.ts,
  README.md; `src/`: `index.ts`, `component-definition.ts`, `component-registry.ts`,
  `component-registry.spec.ts`, `tool-name-segment.ts`, `tool-name-segment.spec.ts`,
  `generative-ui-tool.ts`, `generative-ui-tool.spec.ts`, `state-patch-tool.ts`,
  `state-patch-tool.spec.ts`, `progress.ts`, `progress.spec.ts`.
- `packages/context/src/state-patch.ts`.
- `packages/react/src/generative-ui-hooks.tsx`, `generative-ui-hooks.spec.tsx`.
- `packages/ui/src/generative-ui.spec.tsx`.
- `examples/react-generative-ui/`: package.json, project.json, tsconfig.json,
  vitest.config.ts, vite.config.ts, index.html, README.md; `src/`: `assets.d.ts`,
  `applications.ts`, `app.tsx`, `main.tsx`, `styles.css`, `backend.ts`, `server.ts`,
  `integration.spec.tsx`.
- `docs/adr/0011-generative-ui-and-state-patch-architecture.md`.
- All ten documents in `docs/phases/phase-06/`: Docs, Architecture, Implementation, Status,
  Testing, Decisions, API, Files, Issues, Handoff.

## Modified

- `packages/context/src/`: `state-store.ts` (+`modelWritable` on `CopilotStateDefinition`,
  +`Slot.revision`, +`getRevision`/`isModelWritable`/`applyPatch` on `CopilotStateStore`),
  `state-store.spec.ts` (+revision/modelWritable/applyPatch test coverage), `index.ts`
  (+`state-patch.ts` exports).
- `packages/react/src/`: `internals.ts` (+`generativeComponentRegistry`/
  `componentRenderers`/`toolRenderers`, +`ToolRenderState`/`ToolRenderFn`), `provider.tsx`
  (creates the three new internals fields, disposes the component registry), `state-hooks.ts`
  (+`modelWritable` option, registers the reserved patch tool), `index.ts` (+exports),
  `package.json`/`project.json`/`tsconfig.json` (+`@gixcopilot/generative-ui` dependency/
  reference).
- `packages/ui/src/`: `components.tsx` (+`ToolActivityProps.resolveRenderer`/
  `onRenderError`, +`ToolActivityRow` child component, `ChatContent` wiring),
  `package.json` (+`zod` devDependency).
- `tools/vitest.shared.ts` — added the `@gixcopilot/generative-ui` workspace alias.
- `eslint.config.js` — added the `scope:generative-ui` module-boundary constraint; extended
  `scope:react`/`scope:example` to permit depending on it. Updated the file-header comment.
- `tsconfig.json` (root) — added `packages/generative-ui` and
  `examples/react-generative-ui` references.
- `docs/PROJECT_STATUS.md`, `docs/DECISIONS.md`, `docs/CHANGELOG_PHASES.md`,
  `docs/architecture/overview.md`, `README.md` — Phase 6 status, ADR index entry, changelog
  entry, and the updated dependency-direction diagram.

No file under `packages/protocol`, `packages/core`, `packages/client`, `packages/server`, or
any `packages/providers/*` package was modified — see
[Architecture](Phase_6_Architecture.md) and ADR 0011 for why this was achievable. Generated
`dist/`, `web-dist/`, tsbuildinfo, and coverage output are ignored, as before. No commits
were created by this work; `git status`/`git diff` reflect the actual pending changes.
