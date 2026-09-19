# Phase 6 Handoff

The new seam is `@gixcopilot/generative-ui` (framework-independent) with
`@gixcopilot/react`'s `useGenerativeComponent`/`useToolRenderer`/`useInvokeTool` and
`useCopilotState`'s `modelWritable` option as its React adapter, wired automatically into
every `CopilotProvider` — no new required prop, no opt-in step beyond registering a
component/renderer or setting `modelWritable: true`.

```sh
pnpm install
pnpm build
pnpm --filter @gixcopilot/react-generative-ui server   # terminal 1 - demo backend on :4321
pnpm --filter @gixcopilot/react-generative-ui dev       # terminal 2 - Vite dev server on :5177
```

Open <http://127.0.0.1:5177>. Try "Show APP-1024", "Show all applications as cards", "What
is the status of APP-2048?", click **Open** on a rendered card, or "Filter to approved" — no
provider key needed; the demo backend is a deterministic, non-network `ModelProvider` (see
`examples/react-generative-ui/src/backend.ts`). Every prior example (`:5173`–`:5176`, their
own backends on `:4317`–`:4320`) is unchanged and still works exactly as before.

For validation:

```sh
pnpm validate
pnpm --filter @gixcopilot/generative-ui test
pnpm --filter @gixcopilot/context test
pnpm --filter @gixcopilot/react test
pnpm --filter @gixcopilot/ui test
pnpm --filter @gixcopilot/react-generative-ui test
```

All newly exported APIs are documented in [API](Phase_6_API.md); pipeline/lifecycle choices
in [Architecture](Phase_6_Architecture.md) and ADR 0011; test evidence and limits in
[Testing](Phase_6_Testing.md) and [Issues](Phase_6_Issues.md).

## Maintenance constraints

- **Keep `@gixcopilot/generative-ui` free of React, Fastify, and provider-SDK
  dependencies** — enforced by `@nx/enforce-module-boundaries` (`scope:generative-ui` →
  `protocol, tools, context, generative-ui` only). A React component reference
  (`ComponentType`) must never be added to `GenerativeComponentDefinition` — it belongs only
  in `@gixcopilot/react`'s own `componentRenderers` map.
- **Never invent a free-text `component` field the model fills in.** The security property
  "the model can only ever select a real, registered component" depends entirely on
  component selection being a *tool name*, resolved from the run's own manifest — not a
  string parameter validated after the fact. If a future phase needs the model to select
  among components dynamically without a manifest round trip, re-read ADR 0011's
  "Alternatives Considered" before changing this.
- **A state-patch outcome must stay a returned value, never a thrown error, from the
  reserved tool's `execute()`.** `ToolRuntime` normalizes any thrown error into one opaque
  `TOOL_EXECUTION_ERROR`, discarding the conflict/rejection distinction the model needs —
  see [Issues](Phase_6_Issues.md) for the bug this fix corrected.
- **If you add a new place that derives a reserved tool name from a developer-chosen
  identifier, run it through `toToolNameSegment()` first.** A raw kebab-case/snake_case id
  will crash `assertValidToolName()` — this is a real bug this phase found and fixed, not a
  theoretical concern.
- **If you touch `ToolActivity`'s rendering, keep the resolved renderer's invocation inside
  its own child component (`ToolActivityRow`), never inline in `ToolActivity`'s own render
  body.** A throw from a resolver call outside a child component escapes past the intended
  `RenderBoundary`, unmounting the whole chat instead of one row — re-run
  `packages/ui/src/generative-ui.spec.tsx`'s "isolates a throwing custom renderer" test
  after any change here.
- **`useInvokeTool()` is the only sanctioned way for trusted application code (including a
  rendered generative component's own event handlers) to call a registered tool without a
  model round trip.** Never call a tool's `execute()` directly from anywhere else — always
  go through a provider's `ToolRuntime` (via `useInvokeTool` or the model).
- **`GenerativeComponentMetadata`/`ToolMetadata` fields are not authorization.** Phase 7 will
  add real enforcement; do not start relying on any of these as a security boundary.

The repository's existing Phase 1–5 APIs were not changed; every Phase 1–5 test passes
unmodified, and no protocol/core/client/server/provider file was touched. No git commits,
package publication, or deployment were performed. Work remains in the working tree for
review.

**Phase 07 — Enterprise Security & HITL: LOCKED / NOT STARTED.** No Action Firewall, identity
propagation, RBAC/ABAC, permission-aware tool/component discovery, PII controls, approval
workflows, interrupt/resume, dry-run, or audit trail has been implemented. Every
consequential action introduced in this phase (component rendering, direct tool invocation,
state patching) already flows through the same `ToolRuntimeMiddleware` pipeline Phase 5
built — the exact insertion point Phase 7 needs, confirmed still intact. Starting another
phase requires a new explicit user instruction.
