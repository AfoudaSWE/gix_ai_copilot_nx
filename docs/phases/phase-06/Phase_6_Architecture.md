# Phase 6 Architecture

## Dependency direction

```text
                 Protocol
                /        \
            Client       Core  <-  Model Runtime  <-  Provider adapters
              ^          ^  ^
              |          |  Server (+ tools, unchanged)
     @gixcopilot/react ->|
        ^   ^   ^   ^
        |   |   |   |
        |   |   |   @gixcopilot/tools (unchanged)
        |   |   @gixcopilot/context (extended in place: state patches/revision)
        |   @gixcopilot/generative-ui (NEW - protocol + tools + context only, no React)
        @gixcopilot/react (adapter over all of the above)
```

`@gixcopilot/generative-ui` depends on `@gixcopilot/protocol`, `@gixcopilot/tools`, and
`@gixcopilot/context` — it has **no** React, Fastify, or provider-SDK dependency, enforced by
`@nx/enforce-module-boundaries` (`scope:generative-ui` → `protocol, tools, context,
generative-ui` only). `@gixcopilot/react` gained one new workspace dependency on it.
**No file under `protocol`, `core`, `client`, `server`, or any provider package was
modified** — this is the phase's most consequential architectural outcome (see
[Decisions](Phase_6_Decisions.md) and ADR 0011): rendering a component and patching state
both ride the exact same frontend-tool round trip Phase 5 already built.

## The core decision: a structured UI request is a reserved tool call

```text
useGenerativeComponent({ name: 'ApplicationCard', propsSchema, component, ... })
        |
        v
@gixcopilot/generative-ui's toGenerativeUiToolDefinition(definition)
        |  name: `ui.render.applicationCard` (camelCased, sanitized - see tool-name-segment.ts)
        |  inputSchema: definition.propsSchema   <- the component's OWN schema, reused verbatim
        |  metadata: { source: 'frontend', executionLocation: 'client', ... }
        v
Registered into THIS PROVIDER'S frontend ToolRegistry (the exact one useFrontendTool uses)
        |
        v
Advertised in the run's tool manifest, exactly like any other frontend tool (Phase 5,
unmodified) - the model can select it, and only it, by name
        |
        v
Model requests `ui.render.applicationCard` with arguments  ──►  tool.requested (source: 'frontend')
        |
        v
Browser's ToolRuntime.execute() - Zod-validates `arguments` against propsSchema BEFORE
`execute()` ever runs (Section 17's pipeline, reused verbatim - zero new validation code)
        |
        v
execute() returns { component: 'ApplicationCard', props: <validated> } as the tool's own
successful output - client.submitToolResult() reports it back so the model's turn completes
        |
        v
tool.completed  ──►  chat-store's existing ToolCallState timeline (Phase 5, unmodified)
        |
        v
useResolveToolRenderer() recognizes the reserved name, looks up the registered React
component by name, and renders it with the validated props (@gixcopilot/react)
```

Every step above except the last two is **identical code Phase 5 already shipped** - no
protocol/server/core change, no new validation logic, no new event type. See ADR 0011 for
the full rationale and alternatives considered (a new `ContentPart` variant; one generic
`ui.render(component, props)` tool).

## Component registry (`@gixcopilot/generative-ui`)

```text
GenerativeComponentDefinition<TProps>   { name, description, propsSchema, metadata? }
        |  register() / get() / list() / unregister() / subscribe() / clear()
        v
GenerativeComponentRegistry             (framework-independent; no `component: ComponentType`
                                          field here - a React reference is not framework-
                                          neutral, so it lives only in @gixcopilot/react)
```

Identity is by `name`; a duplicate registration is rejected by default (`{ replace: true }`
opts in), mirroring `@gixcopilot/tools`' `ToolRegistry` convention exactly.

## Tool-result rendering (`useToolRenderer`) — a second, independent mechanism

```text
useToolRenderer({ tool: 'applications.getStatus', render({ status, result }) { ... } })
        |
        v
Registered into this provider's toolRenderers map (@gixcopilot/react internals)
        |
        v
useResolveToolRenderer(): for each ToolCallState, a registered custom renderer for its exact
tool name takes priority over both the generic activity row AND generative-component
rendering - works for *any* tool, generative or not (Section 26-31)
```

`@gixcopilot/ui`'s `ToolActivity` calls `resolveRenderer(toolCall)` **inside its own child
component** (`ToolActivityRow`), not inline in `ToolActivity`'s own render body - a custom
renderer that throws *while being called* (not just while its returned JSX renders) would
otherwise escape past a `RenderBoundary` placed as a sibling/child, taking down the whole
chat instead of just that one row (see [Issues](Phase_6_Issues.md) for the bug this caught).

## Interactive actions: `useInvokeTool` (Section 32-35, 105-106)

```text
ApplicationCard's own [Open] button (trusted, developer-authored onClick)
        |
        v
useInvokeTool()('navigation.openApplication', { applicationId })
        |
        v
This provider's own ToolRuntime.execute() directly - SAME validate/execute/normalize
pipeline a model-initiated call uses (Section 35: never bypass the Tool Runtime)
        |
        v
Application code runs; NO model turn, NO run, NO tool.* event was ever created
```

## Shared, AI-writable state (extends `@gixcopilot/context` in place)

```text
useCopilotState({ id, initialValue, exposeToModel?, modelWritable? })
        |
        +-- exposeToModel (Phase 4, unchanged) --> read-only context exposure
        |
        +-- modelWritable: true (Phase 6, NEW) -->
                |
                v
        toStatePatchToolDefinition(stateStore, id, ...) from @gixcopilot/generative-ui
                |  name: `state.patch.<camelCasedId>`
                |  inputSchema: { op: 'set'|'merge', value: unknown, baseRevision: number }
                v
        Registered into the frontend ToolRegistry (same mechanism as generative components)
                |
                v
        Model calls it  ──►  execute(input) calls CopilotStateStore.applyPatch(id, patch,
                              input.baseRevision) and returns the StatePatchResult AS THE
                              TOOL'S OWN OUTPUT (never thrown - see ADR 0011)
                |
                v
        { status: 'applied', revision, value }
          | { status: 'conflict', currentRevision }
          | { status: 'rejected', reason, detail? }
```

`CopilotStateStore.applyPatch()` (in `@gixcopilot/context`, `state-store.ts`):

```text
resolve slot by id
  -> unknown id?            reject('unknown-state')
  -> not modelWritable?     reject('not-writable')
  -> revision !== baseRevision?   conflict(currentRevision)      <- Section 45-46
  -> op 'merge' on non-object?    reject('invalid-patch')
  -> registered validator rejects the result?   reject('invalid-value')
  -> otherwise: write, revision += 1, notify subscribers, return applied(revision, value)
```

`revision` increments on **every** successful `set`/`update`/`applyPatch` for a slot, not
just patches — so a UI-driven change (the dropdown, `setFilters(...)`) also invalidates a
stale AI-proposed `baseRevision`, which is exactly what Section 46's conflict scenario
requires and what `examples/react-generative-ui`'s conflict test exercises end to end.

## Progress (Section 50-52) — reused, not reinvented

```text
ToolCallState[]  (Phase 5, unmodified)
        |  toProgressSteps() - a pure mapping, @gixcopilot/generative-ui
        v
ProgressStep[]  { id, label, status: 'pending'|'running'|'completed'|'failed' }
```

No new event family; Section 52 explicitly asks to reuse existing events. `@gixcopilot/ui`'s
default `ToolActivity` row already renders exactly this status vocabulary (Phase 5); this
mapping exists for a *custom* headless UI that wants a `ProgressStep`-shaped view instead of
raw `ToolCallState`s.

## Why "streaming generative UI" / "partial props" needed no active work

A tool call never reaches the browser as partial JSON: `ToolCallAssembler` (Phase 5) already
assembles fragmented provider deltas into one complete `ModelToolCall` server-side before a
`tool.requested` event is ever emitted. There is structurally no partial/invalid payload for
the client to guard against — Section 53-55 is satisfied by the existing architecture, not by
new code written for Phase 6.

## Default UI integration (`@gixcopilot/ui`)

```text
CopilotChat's ChatContent
        |  useResolveToolRenderer()   <- new, from @gixcopilot/react
        v
<Activity toolCalls={...} labels={...} resolveRenderer={...} onRenderError={...} />
        |
        v
ToolActivity  (unchanged default rendering when resolveRenderer returns undefined)
  each <li> wraps a <ToolActivityRow> in its own <RenderBoundary> (Section 56)
```

Existing text-only chat behavior (Section 59) is unchanged: a provider with no registered
generative components/tool renderers/writable state renders byte-identically to Phase 5.
