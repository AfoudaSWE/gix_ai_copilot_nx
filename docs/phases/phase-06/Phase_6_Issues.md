# Phase 6 Issues and Limits

## Found and fixed during implementation

1. **A kebab-case state id crashed at registration time.** The example app registered
   `useCopilotState({ id: 'application-filters', modelWritable: true })`; deriving the
   reserved tool name naively lowercased only the first character
   (`state.patch.application-filters`), which fails `@gixcopilot/tools`' tool-name regex
   (hyphens are not a valid character in a name segment) and threw a `CopilotError` at
   effect-mount time — a real crash for an extremely common naming convention, not a
   hypothetical edge case. **Fixed** by adding `tool-name-segment.ts`'s `toToolNameSegment()`,
   a proper kebab-case/snake_case/space-separated → camelCase converter, used by both
   `generativeUiToolName()` and `statePatchToolName()`. Covered by
   `tool-name-segment.spec.ts` (4 tests) and exercised live by the example's own
   `'application-filters'` id.
2. **A throwing custom tool renderer took down the entire chat, not just its own row.** The
   first version of `ToolActivity` called `resolveRenderer(toolCall)` directly inside its
   own render body, with a `RenderBoundary` placed as a child of each `<li>`. Since calling
   a function that throws happens synchronously *during* `ToolActivity`'s own render, the
   exception propagated past every boundary placed underneath it, up to whatever wrapped
   `<ToolActivity>` itself (`CopilotChat`'s own top-level boundary) — unmounting the entire
   header/content/input, not one row. Caught by
   `packages/ui/src/generative-ui.spec.tsx`'s "isolates a throwing custom renderer" test,
   which initially failed with `document.querySelector('.gix-tool-activity')` returning
   `null` (the whole activity list, and the rest of the chat, had unmounted). **Fixed** by
   extracting a `ToolActivityRow` child component so the renderer call happens during *that*
   component's own render, which the `RenderBoundary` wrapped around it (as its parent, not
   itself) correctly isolates.
3. **Two draft protocol error codes were removed before landing.** An early version added
   `STATE_CONFLICT`/`STATE_PATCH_REJECTED` to `CopilotErrorCode`, planning to `throw` them
   from a state-patch tool's `execute()`. Implementing the actual bridge revealed this loses
   information: `ToolRuntime` normalizes *any* thrown `execute()` error into one generic
   `TOOL_EXECUTION_ERROR`, collapsing "conflict" and "rejected" into the same opaque code and
   discarding the current-revision/reason detail the model would need to react correctly.
   **Fixed** by never throwing at all — `execute()` returns the `StatePatchResult`
   discriminated union directly as the tool's own successful output instead, and the two
   draft error codes/factories (and their tests) were reverted before this session's final
   commit-worthy state. See ADR 0011.
4. **A test's `.toEqual()` for the demo's real HTTP round trip needed `Regenerate`-style
   sequencing awareness.** Not a defect exactly, but the interactive-action test initially
   asserted DOM state before the click's own effect (`invoke(...).then(setOpened)`) had
   flushed; wrapped in `waitFor(...)` per this repository's existing convention for async UI
   assertions (see e.g. `examples/react-tools/src/integration.spec.tsx`), it passes
   deterministically.

## Known limitations (non-blocking, in scope for later phases or explicitly deferred)

- **A component-update-in-place request ("UI Request Update", Section 55) is not
  implemented.** Each `ui.render.*` tool call is a one-shot request with its own
  `toolCallId`; there is no mechanism to update a *previously rendered* request's props by
  identity (the model can render the same component again, but as a new, independent
  request). Section 55 explicitly hedges this as "if architecture requires it" — a component
  that needs to show evolving state (e.g. loading → completed) should own that transition
  itself (subscribing to its own data source), rather than relying on protocol-level request
  updates. Revisit only with a concrete requirement.
- **Sensitivity/authorization is still metadata only.** `GenerativeComponentMetadata`,
  `ToolMetadata`, and `ContextSensitivity` remain classification, never enforcement — Phase 7
  owns real authorization. A model-selected component or an approved state patch is not
  itself a security boundary.
- **No AI-based component selection.** The model picks from its own tool manifest
  deterministically, like any other tool call — there is no extra "which component best
  fits this data" inference step (Section 21 does not ask for one).
- **The state-patch contract (`set`/`merge`) does not support array operations or nested
  path targeting.** A patch always operates on the whole state value (replace or shallow
  merge); a slot whose value needs a deep/array-aware patch must be modeled as several
  top-level slots or handled with `'set'` and a fully-computed next value. Deliberately
  minimal per Section 42's "avoid an excessively powerful expression language" — see ADR
  0011.
- **`examples/react-generative-ui`'s demo `ModelProvider` is not a real LLM.** It
  pattern-matches the user's text and requests the matching reserved tool call —
  deterministic and credential-free by design (matching every other Phase 2/5 example's own
  mock-model convention), not a shortcoming to fix.
- **The Chromium/Playwright `react-e2e` suite was not re-run this session.** No Phase 6 UI
  surface was added to it (its coverage predates Phase 3's UI); its `lint`/`typecheck`
  targets were re-run and pass as part of the full workspace validation. Disclosed, not
  silently skipped.

The Action Firewall, RBAC/ABAC, approval/HITL workflows, OpenAPI-to-tool generation, MCP
integration, RAG, persistent memory, and agents are deliberately outside this phase — see
the phase-gate skill and `docs/phases/phase-06/Phase_6_Docs.md`'s scope statement, not
incomplete Phase 6 features.
