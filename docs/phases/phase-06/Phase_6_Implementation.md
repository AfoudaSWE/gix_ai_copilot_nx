# Phase 6 Implementation

## `@gixcopilot/generative-ui` (new package)

Framework-independent. Depends on `@gixcopilot/protocol`, `@gixcopilot/tools`, and
`@gixcopilot/context` — never React.

- `component-definition.ts` — `GenerativeComponentDefinition<TProps>` (name, description,
  `propsSchema`, optional `GenerativeComponentMetadata`). Deliberately has no
  `component: ComponentType` field.
- `component-registry.ts` — `createGenerativeComponentRegistry()`: register/get/list/
  unregister/subscribe/clear, plus a `GenerativeComponentRegistration` handle, mirroring
  `@gixcopilot/tools`' `ToolRegistry` conventions (duplicate name rejected by default,
  `{ replace: true }` opts in).
- `tool-name-segment.ts` — `toToolNameSegment()`: sanitizes an arbitrary developer-chosen
  identifier (kebab-case, snake_case, spaces, PascalCase, already-camelCase — anything) into
  a valid `@gixcopilot/tools` name segment. Shared by both bridge modules below; see
  [Issues](Phase_6_Issues.md) for the bug this fixed.
- `generative-ui-tool.ts` — `generativeUiToolName()`/`isGenerativeUiToolName()`/
  `generativeUiComponentNameOfToolName()` and `toGenerativeUiToolDefinition()`: the bridge
  from a `GenerativeComponentDefinition` to a reserved, frontend-executed `ToolDefinition`
  under the `ui.render.` namespace (see [Architecture](Phase_6_Architecture.md)).
- `state-patch-tool.ts` — `statePatchToolName()`/`isStatePatchToolName()` and
  `toStatePatchToolDefinition()`: the bridge from a writable `CopilotStateStore` slot to a
  reserved tool under the `state.patch.` namespace, whose `execute()` calls
  `CopilotStateStore.applyPatch()` and returns its discriminated result as the tool's own
  output.
- `progress.ts` — `toProgressSteps()`: a pure projection of tool-call-shaped activity into
  `ProgressStep[]` (Section 50-52), reusing existing lifecycle statuses.

Every module ships its own `*.spec.ts` (28 tests total) — see [Testing](Phase_6_Testing.md).

## `@gixcopilot/context` (extended in place)

No new package, no new dependency — `state-store.ts` and the new `state-patch.ts` add:

- `StatePatch` (`{ op: 'set' | 'merge', value }`) and `StatePatchResult` (discriminated
  `'applied' | 'conflict' | 'rejected'`) types (`state-patch.ts`).
- `CopilotStateDefinition.modelWritable?: boolean` (default `false`).
- `Slot.revision`, incremented on every successful `set`/`update`/`applyPatch`.
- `CopilotStateStore.getRevision(id)`, `.isModelWritable(id)`, `.applyPatch(id, patch,
  baseRevision)` — the last never throws; every rejection/conflict is a returned
  `StatePatchResult`, matching `CopilotStateStore`'s existing "predictable failure" 
  convention from Phase 4 (`set`/`update` still throw on validator rejection, unchanged).

## `@gixcopilot/react` (extended)

New files:

- `generative-ui-hooks.tsx` — `useGenerativeComponent`, `useToolRenderer`,
  `useResolveToolRenderer`, `useGenerativeUIRequests`, `useInvokeTool`.

Modified files:

- `internals.ts` — added `generativeComponentRegistry` (framework-independent), plus two
  React-only maps: `componentRenderers` (name → `ComponentType`, since a component reference
  cannot live in the framework-independent registry) and `toolRenderers` (tool name →
  render function, backing `useToolRenderer`). Added `ToolRenderState`/`ToolRenderFn` types.
- `provider.tsx` — creates the three new internals per provider instance (same per-provider
  isolation convention as every other internals field since Phase 4/5); disposes the
  component registry on unmount.
- `state-hooks.ts` — `useCopilotState` gained the `modelWritable?: boolean` option; when
  true, an effect registers the reserved `state.patch.<id>` tool via
  `toStatePatchToolDefinition`, disposed on unmount/when it turns false.
- `index.ts` — exports the five new hooks, their option/result types, and re-exports of
  `@gixcopilot/generative-ui`/`@gixcopilot/context` public types a consumer needs.

`chat-store.ts` was **not modified** — generative UI and state patches both surface through
the exact same `tool.*` events and `ToolCallState[]` timeline Phase 5 already built into it.

## `@gixcopilot/ui` (extended)

- `components.tsx` — `ToolActivityProps` gained optional `resolveRenderer`/`onRenderError`.
  `ToolActivity` now renders each item through a new `ToolActivityRow` child component
  wrapped in its own `RenderBoundary` (Section 56 — see [Issues](Phase_6_Issues.md) for why
  this had to be a separate component, not inline JSX). `ChatContent` calls
  `useResolveToolRenderer()` and passes it down; existing text-only behavior is unchanged
  when nothing is registered.
- `package.json` — added `zod` as a devDependency (test-only; the package itself has no new
  runtime dependency).

## `examples/react-generative-ui` (new example)

A self-contained demo app (own dev server on `:4321`, own Vite dev server on `:5177`,
mirroring `examples/react-tools`' structure): an "Applications" page registering a trusted
`ApplicationCard` generative component, a custom tool renderer for the ordinary backend tool
`applications.getStatus`, an interactive `[Open]` action via `useInvokeTool`, and an
AI-writable `applicationFilters` state slot — backed by a deterministic, non-network
`generative-ui-aware` `ModelProvider` (`src/backend.ts`) that requests the same reserved
tool calls a real LLM would once it saw them in its manifest. See
`examples/react-generative-ui/README.md`.

## Dependencies added

None beyond workspace-internal references (`@gixcopilot/generative-ui` as a new dependency
of `@gixcopilot/react` and the new example; `zod` added to `@gixcopilot/ui`'s
devDependencies for its own new test file, same pinned version already used everywhere else
in the workspace). No new third-party npm package was added anywhere.

## Notable implementation tradeoffs

- **Reserved tool names are derived, not developer-specified**, from a component name or
  state id via `toToolNameSegment()` + a fixed namespace prefix. A developer never types
  `ui.render.applicationCard` themselves; they name their component `ApplicationCard` and
  the reserved tool name is computed deterministically.
- **`useGenerativeComponent`/`useCopilotState`'s `modelWritable` registration effect only
  re-runs on identity (registry/name/id) changes**, not on every option change — the same
  documented tradeoff `useFrontendTool` already established in Phase 5, kept consistent
  rather than inventing a different convention for Phase 6's own hooks.
- **A resolved renderer must be invoked inside its own child component**, not called
  directly inside `ToolActivity`'s render body, for `RenderBoundary` to actually isolate a
  throwing custom renderer to one row instead of the whole chat (Section 56) — see
  [Issues](Phase_6_Issues.md).
