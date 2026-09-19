# 0011 — Generative UI & State-Patch Architecture

## Status

Accepted (Phase 6).

## Context

Phase 6's mission is to let the model drive UI and propose shared-state changes without ever
generating executable code, while never bypassing the Phase 5 tool-calling security seam
(Section 88 makes this explicitly mandatory: "generated UI action → registered tool → tool
runtime → [Phase 7 firewall insertion point]"). Several architectural questions had to be
settled before writing code: how does "the model selects a UI component" actually reach the
wire without inventing a new provider-specific structured-output mechanism; how does
prop/patch validation avoid duplicating Phase 5's already-built Zod pipeline; and how much of
the brief's illustrative JSON-Patch-flavored state contract is actually worth building.

## Decision

- **A "structured UI request" (Section 15, 66) is implemented as a call to a reserved,
  SDK-generated tool — one per registered component — not as a new protocol content part or
  a free-text `{component, props}` envelope the model fills in itself.** Each
  `useGenerativeComponent({ name, propsSchema, ... })` call auto-registers a matching
  frontend tool named `ui.render.<camelCasedName>` whose `inputSchema` *is* the component's
  own `propsSchema`. Concretely, this means:
  - **"No arbitrary component imports" (Section 18) is structural, not a runtime check.**
    The model can only ever request a *tool name* present in its manifest; the manifest only
    ever contains names `@gixcopilot/generative-ui` derived from real, registered
    components. There is no free-text `component` field to redirect.
  - **Prop validation (Section 17) needed zero new code.** `@gixcopilot/tools`' `ToolRuntime`
    already validates a tool call's arguments against its `inputSchema` before `execute()`
    ever runs — reusing it for props validation is not an analogy, it *is* the same
    validation call.
  - **The Tool Runtime can never be bypassed (Section 35, 88 — mandatory).** Rendering a
    generative component *is* a tool call; there is no separate rendering path to audit.
  - **Tool discovery/manifest-building, cancellation, and lifecycle events (`tool.requested`/
    `started`/`completed`/`failed`) are all inherited for free** from Phase 5's existing
    frontend-tool round trip.
- **"Tool Result → UI" (Section 26-31) is a second, independent mechanism**: `useToolRenderer
  ({ tool, render })` attaches a custom renderer to *any* tool's activity (generative or not)
  by tool name, read by `@gixcopilot/ui`'s `ToolActivity` through a new `resolveRenderer`
  prop the React adapter supplies (`useResolveToolRenderer`). This is intentionally
  orthogonal to component registration — an ordinary Phase 5 backend tool (e.g.
  `applications.getStatus`) gets a rich renderer without becoming a "generative component"
  itself.
- **"Interactive generated components" (Section 32-35, mandatory experience in Section
  105-106) route through a new `useInvokeTool()` hook** that calls this provider's own
  `ToolRuntime.execute()` directly — "Generated Component → Registered Tool → Tool Runtime",
  explicitly *not* "→ AI → Tool". A rendered component's own `onClick` is trusted
  application code calling a registered tool directly; it never asks the model to do it.
- **Shared AI/UI state (Section 36-49) extends `@gixcopilot/context`'s existing
  `CopilotStateStore` in place**, rather than a new package: a `modelWritable` flag on
  `CopilotStateDefinition`, a per-slot monotonic `revision` (bumped by `set`/`update`
  *and* `applyPatch`, so a UI-driven change also invalidates a stale AI-proposed
  `baseRevision`), and `applyPatch(id, patch, baseRevision)` returning a discriminated
  `StatePatchResult` (`'applied' | 'conflict' | 'rejected'`) rather than throwing. A writable
  state slot is bridged the same way a component is: `useCopilotState({ modelWritable: true
  })` auto-registers a reserved `state.patch.<id>` tool whose `execute()` calls
  `applyPatch()` and returns its result directly as the tool's *output* — not a thrown error.
- **The state-patch contract is a two-operation `{ op: 'set' | 'merge', value }`**, not the
  brief's illustrative RFC 6902-flavored `{ op: 'replace', path, value }`. A state slot
  already holds one typed value; "replace one field" only ever needs a shallow merge, not a
  general JSON-Pointer path language (Section 42 explicitly warns against "an excessively
  powerful expression language").
- **"Read-only state" (Section 39) needed zero new code**: it is simply `exposeToModel` set
  without `modelWritable` — the exact Phase 4 mechanism, unchanged.

## Consequences

- **No protocol, core, server, client, or provider change was needed anywhere.** Every
  Phase 1–5 file is untouched; the entire feature is additive at the `@gixcopilot/context`
  (in-place extension) and `@gixcopilot/react`/`@gixcopilot/ui` (new hooks/props) layers,
  plus one new framework-independent package, `@gixcopilot/generative-ui`.
- Because a state-patch outcome is returned as the tool's own successful output (not thrown),
  the model can *read and react to* the specific outcome ("conflict, here's the current
  value" vs. "rejected, not writable") the next time it is called — `ToolRuntime`'s generic
  error-normalization path would otherwise have collapsed every distinct outcome into one
  opaque `TOOL_EXECUTION_ERROR` message, losing exactly the distinction Section 45-46 needs.
- A component/state identifier containing non-alphanumeric characters (kebab-case,
  snake_case — both extremely common conventions) must be sanitized into a valid
  `@gixcopilot/tools` name segment before deriving a reserved tool name; see
  `tool-name-segment.ts` and [Issues](../phases/phase-06/Phase_6_Issues.md) for the bug this
  caught during implementation.
- Because generative UI rendering and state patching both ride the exact same frontend-tool
  transport Phase 5 built, Section 88's Phase 7 compatibility requirement is trivially
  satisfied: whatever Action Firewall middleware Phase 7 adds to `ToolRuntimeMiddleware` will
  apply uniformly to chat tool calls, generated-UI tool calls, and state-patch tool calls,
  with no separate enforcement path to build or forget.
- "Streaming generative UI" / "partial props" (Section 53-55) turned out to be
  **structurally satisfied rather than actively built**: a tool call never reaches the
  browser as partial JSON (`ToolCallAssembler` already assembles fragmented provider deltas
  into one complete call server-side, Phase 5), so there is no partial/invalid payload for
  the client to ever see or guard against.

## Alternatives Considered

- **A new `generative-ui` `ContentPart` variant on assistant messages** (the brief's own
  Section 19 illustrative sample), with the model producing it via a parallel structured-
  output path. Rejected: it would require a protocol version bump, a new client-side
  parsing/ordering concern independent of the tool-call machinery, and — critically — a
  second way for "the model selects something" to reach the client, duplicating validation
  logic `ToolRuntime` already provides for tool calls. Revisit only if a future phase needs
  a generative UI request to be positioned *inline within* an assistant message's own content
  array (this implementation instead tracks it as its own ordered activity list, mirroring
  how Phase 5 already keeps tool activity separate from message content).
- **One generic `ui.render(component, props)` tool** (a single reserved tool accepting a
  free-text `component` field) instead of one reserved tool per component. Rejected: it
  reintroduces exactly the "arbitrary component name supplied by the model" attack surface
  Section 18 prohibits, and its `props` field could only be validated with a loose
  `z.unknown()`/runtime-dispatched schema instead of getting each component's own precise
  schema for free from `ToolRuntime`'s existing per-tool validation.
- **A full RFC 6902 JSON Patch implementation** for state patches. Rejected per Section 42's
  own explicit guidance; `{ op: 'set' | 'merge', value }` covers the demonstrated use cases
  (Section 68, 107) without an arbitrary-path expression language to validate/secure.
- **A separate `@gixcopilot/state` package** for the revision/patch extension, instead of
  extending `@gixcopilot/context` in place. Rejected: Section 36 explicitly frames this as
  "Phase 4 established shared-state primitives; Phase 6 extends them" — a second package
  would split one concept (shared state) across two packages for no architectural benefit,
  and `@gixcopilot/context` already had zero dependents relying on its shape being frozen.
