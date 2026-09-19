# Phase 4 Handoff

The new seam is `@gixcopilot/context` (framework-independent) with `@gixcopilot/react`'s
`useCopilotContext`/`useCopilotState` as its React adapter, wired automatically into every
`CopilotProvider` — no new required prop, no opt-in step beyond calling the hooks.

```sh
pnpm install
pnpm build
pnpm --filter @gixcopilot/react-context server   # terminal 1 - deterministic demo backend on :4319
pnpm --filter @gixcopilot/react-context dev       # terminal 2 - Vite dev server on :5175
```

Open <http://127.0.0.1:5175>. Click an application row to select it, change the status
filter, and ask "What application am I looking at?" — no provider key needed; the demo
backend is a deterministic, non-network `ModelProvider` (see
`examples/react-context/src/backend.ts`). Phase 3's existing examples (`:5173`/`:5174`,
shared backend `:4318`) are unchanged and still work exactly as before.

For validation:

```sh
pnpm validate
pnpm --filter @gixcopilot/context test
pnpm --filter @gixcopilot/react test
pnpm --filter @gixcopilot/react-context test
```

All newly exported APIs are documented in [API](Phase_4_API.md); pipeline/lifecycle choices
in [Architecture](Phase_4_Architecture.md) and ADR 0009; test evidence and limits in
[Testing](Phase_4_Testing.md) and [Issues](Phase_4_Issues.md).

## Maintenance constraints

- **Keep `@gixcopilot/context` free of React, Angular, and provider-SDK dependencies** —
  enforced by `@nx/enforce-module-boundaries` (`scope:context` → `protocol, context` only).
  A future Angular adapter should wrap the same package, not reimplement its pipeline.
- **Do not add a protocol/server/core context field** without re-reading ADR 0009's
  "Alternatives Considered" — the current `system`-message placement was chosen specifically
  to avoid that surface area; revisit only with a concrete reason the message-based approach
  can't satisfy (e.g. per-provider context-window-aware placement).
- **Preserve `resolveContextMessage`'s synchronous fast path.** If you touch
  `chat-store.ts`'s `consume()` or `provider.tsx`'s `resolveContextMessage`, re-run
  `provider.spec.tsx` (the unmodified Phase 3 fixture) — it will fail immediately if
  `client.run()` stops dispatching on the same tick for a provider with no registered
  context, per Section 64's backward-compatibility requirement.
- **Deduplication/priority/budget logic lives only in `context-engine.ts`.** Do not
  special-case a scope or reason directly in React — the engine is the single place that
  decides what's included, exactly as the context-engine skill requires.
- **State is never automatically exposed to a model.** Do not change `useCopilotState`'s
  default so that `exposeToModel` becomes implicit — this is a deliberate, documented
  security-adjacent default (ADR 0009).
- **`useCopilotContext`'s default identity is `useId()`.** Passing an explicit `id` is
  required whenever two call sites are meant to share/update the same registration; without
  one, each call site always gets its own item, even with an identical `name`.
- Sensitivity metadata (`ContextSensitivity`) is not authorization. Phase 7 will add real
  enforcement; do not start relying on the default `restricted`-exclusion policy as a
  security boundary in application code.

The repository's existing Phase 1–3 APIs were not changed; every Phase 3 test passes
unmodified. No git commits, package publication, or deployment were performed. Work remains
in the working tree for review.

**Phase 05 — Tools & Agent Actions: LOCKED / NOT STARTED.** No `defineTool`,
`useFrontendTool`, tool registry, tool execution/calling, OpenAPI-to-tool generation, MCP
integration, or any other future-phase feature has been implemented. Starting another phase
requires a new explicit user instruction.
