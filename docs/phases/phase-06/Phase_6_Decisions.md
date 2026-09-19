# Phase 6 Decisions

Full reasoning lives in [ADR 0011](../../adr/0011-generative-ui-and-state-patch-architecture.md).
This page summarizes the decisions and the smaller ones that didn't rise to ADR-worthy.

## ADR 0011 summary

1. A "structured UI request" is a call to a reserved, SDK-generated tool
   (`ui.render.<component>`) — not a new protocol content part or a free-text envelope.
2. "Tool Result → UI" (custom tool renderers, `useToolRenderer`) is a second, independent
   mechanism, orthogonal to component registration.
3. Interactive generated-component actions route through a new `useInvokeTool()`, calling
   this provider's own `ToolRuntime` directly — never back through the model.
4. Shared AI-writable state extends `@gixcopilot/context`'s existing `CopilotStateStore` in
   place (`modelWritable`, `revision`, `applyPatch`) rather than a new package.
5. The state-patch contract is `{ op: 'set' | 'merge', value }`, not a full JSON-Patch path
   language.
6. "Read-only state" needed zero new code — it's `exposeToModel` without `modelWritable`.
7. No protocol/core/server/client/provider file was modified anywhere in this phase.

## Smaller decisions

- **A state-patch outcome is returned as the tool's own successful output, never thrown.**
  `ToolRuntime`'s generic error-normalization path collapses any thrown `execute()` error
  into one opaque `TOOL_EXECUTION_ERROR`, discarding the specific `conflict`/`rejected`
  distinction the model needs to react intelligently (e.g. retry with the current value vs.
  give up). Two `CopilotErrorCode`s (`STATE_CONFLICT`/`STATE_PATCH_REJECTED`) were drafted
  and then **removed** during implementation once this became clear — see
  [Issues](Phase_6_Issues.md).
- **Reserved tool names are sanitized, not assumed-valid.** `toToolNameSegment()` converts
  kebab-case/snake_case/space-separated identifiers into camelCase before deriving
  `ui.render.*`/`state.patch.*` names — discovered as a real bug (not a hypothetical) when
  the example app's own `'application-filters'` state id crashed at registration time. See
  [Issues](Phase_6_Issues.md).
- **A resolved custom renderer/generative component must be invoked inside its own child
  React component**, not called directly inside `ToolActivity`'s render body, or a throw
  escapes past the intended `RenderBoundary` and takes down the whole chat instead of one
  row. Fixed by extracting `ToolActivityRow`; see [Issues](Phase_6_Issues.md).
- **One reserved tool per component, not one generic `ui.render(component, props)` tool.**
  A generic tool would reintroduce a free-text `component` field the model could redirect
  (exactly what Section 18 prohibits) and could only validate `props` with a loose,
  runtime-dispatched schema instead of getting each component's own precise schema for free
  from `ToolRuntime`.
- **Progress rendering (`toProgressSteps`) is a pure mapping over existing `ToolCallState`s,
  not a new event family.** Section 52 explicitly asks to reuse existing events; building a
  `progress.*` event family would have duplicated `tool.*` for no new information.
- **"Streaming generative UI"/"partial props" required no active implementation.** The
  architecture already guarantees a tool call never reaches the browser as partial JSON
  (`ToolCallAssembler` assembles it server-side, Phase 5) — there is nothing partial for the
  client to guard against. Documented as a structural consequence, not claimed as "built".
- **No dependency was added to any existing package's runtime dependencies.** `zod` was
  added to `@gixcopilot/ui`'s `devDependencies` only (for its own new test file), same
  pinned version (`4.6.5`) already used everywhere else in the workspace.
