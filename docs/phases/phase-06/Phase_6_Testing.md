# Phase 6 Testing

All commands below were actually executed in this session from the repository root; output
was observed, not assumed (per the testing/code-review skills).

## Previous-phase regression gate

Before any Phase 6 change, and again at the end, the full workspace suite (Phase 1–5's own
regression suite — no Phase 1–5 test was modified, skipped, or removed) was run via `pnpm
validate`. Result: **PASS** both times (the pre-change run reported all cached tasks green,
matching Phase 5's own documented 350-test baseline; see "Final full-workspace validation"
below for the final run's exact counts).

## New Phase 6 coverage

### `@gixcopilot/generative-ui` (`packages/generative-ui`)

```text
pnpm --filter @gixcopilot/generative-ui test
```

```text
src/component-registry.spec.ts   (8 tests)
src/generative-ui-tool.spec.ts   (8 tests)
src/progress.spec.ts             (3 tests)
src/state-patch-tool.spec.ts     (5 tests)
src/tool-name-segment.spec.ts    (4 tests)

Test Files  5 passed (5)
Tests       28 passed (28)
```

Covers: component registration/update/dispose/duplicate-handling/filtering/subscription/
multiple-registry-isolation (Section 72); reserved tool-name derivation and its
kebab-case/snake_case/space-separated sanitization (Section 18, the bug in
[Issues](Phase_6_Issues.md)); the generative-UI tool bridge echoing back validated props
(Section 24-25); the state-patch tool bridge returning `applied`/`conflict`/`rejected`
results as normal tool output, never a thrown error (Section 43, 45-46); progress-step
mapping determinism and ordering (Section 50-52).

### `@gixcopilot/context` additions (`packages/context`)

```text
pnpm --filter @gixcopilot/context test
```

```text
Test Files  6 passed (6)
Tests       61 passed (61)   (was 50 before Phase 6; +11 new: state-store.spec.ts)
```

New coverage in `state-store.spec.ts`: revision starts at 0 and increments on `set`/
`update` (3 tests); `modelWritable` defaults to `false` and is refreshed on re-registration;
`applyPatch` — unknown id, not-writable, valid `set`, valid `merge`, `merge` against a
non-object rejected, stale-`baseRevision` conflict leaving the value unchanged,
validator-rejected result leaving the value unchanged, and notify-only-on-actual-application
(8 tests, Section 43, 45-46, 76). All 50 pre-existing Phase 4 tests in this package pass
unmodified.

### `@gixcopilot/react` additions (`packages/react`)

```text
pnpm --filter @gixcopilot/react test
```

```text
src/generative-ui-hooks.spec.tsx   (8 tests)
+ all five pre-existing Phase 3-5 spec files, unmodified

Test Files  6 passed (6)
Tests       35 passed (35)   (was 27 before Phase 6; +8 new)
```

Covers (Section 77, 79-81): `useGenerativeComponent` is StrictMode-safe and advertises the
correct reserved tool in the run's manifest; a registered component renders once its tool
call succeeds, with validated props, through the real `useResolveToolRenderer()` resolution
path; `useGenerativeUIRequests()` projects only generative-UI activity; `useToolRenderer`
takes priority over generic rendering for any status including `requested`/`running`;
`useCopilotState`'s `modelWritable` advertises `state.patch.<id>` and a valid patch updates
the store; no patch tool is registered when `modelWritable` is left off; `useInvokeTool`
calls a registered tool directly with **zero** run/model call created, and rejects invalid
arguments without ever calling `execute()` (Section 33-35).

### `@gixcopilot/ui` additions (`packages/ui`)

```text
pnpm --filter @gixcopilot/ui test
```

```text
src/generative-ui.spec.tsx   (3 tests)
+ tool-activity.spec.tsx, components.spec.tsx (Phase 3/5, unmodified)

Test Files  3 passed (3)
Tests       22 passed (22)   (was 19 before Phase 6; +3 new)
```

Covers (Section 74, 77): a registered component renders automatically inside `CopilotChat`'s
default activity area once its tool call succeeds; a custom `useToolRenderer` overrides the
default row for its tool without a `components.ToolActivity` override; a throwing custom
renderer degrades to the safe "could not be displayed" fallback **for that row only** —
directly regression-testing the bug fixed in [Issues](Phase_6_Issues.md) (this test failed
against the first implementation, as intended, before the `ToolActivityRow` fix).

### `examples/react-generative-ui` (mandatory E2E, Section 74, 79-81)

```text
pnpm --filter @gixcopilot/react-generative-ui test
```

```text
src/integration.spec.tsx (7 tests)

Test Files  1 passed (1)
Tests       7 passed (7)
```

Real React UI → `useGenerativeComponent`/`useToolRenderer`/`useInvokeTool`/`useCopilotState`
→ a real `@gixcopilot/client` over real HTTP/SSE → a real (in-process) `@gixcopilot/server`
→ the model runtime → a deterministic, non-network `generative-ui-aware` `ModelProvider`
whose requested tool calls are real `ui.render.*`/`state.patch.*`/`applications.getStatus`
calls dispatched through the real `ToolRuntime`. Covers, end to end:

- A single generative UI request renders the registered `ApplicationCard` with correct
  props (Section 65-66, 79's mandatory flow).
- Multiple independent generative UI requests in one response render and track
  independently (Section 25).
- An unknown application id safely reports nothing rendered (Section 16, 57).
- The card's own `[Open]` button invokes a registered tool directly — confirmed by
  asserting **no second run/log region was created** by the click (Section 32-35, 80's
  mandatory flow).
- A valid AI-proposed state patch updates the visible table (Section 68, 81).
- **The stale-revision conflict path** (Section 46, 81's mandatory conflict test): the AI's
  first patch succeeds (revision 0→1); the UI then changes the filter independently
  (revision 1→2); the AI's next patch, still based on revision 1, is rejected as a conflict,
  and the UI's own choice is never overwritten.
- A custom tool renderer shows a status badge instead of the generic activity row for an
  ordinary backend tool (Section 26-31).

## Security test (Section 82)

Covered at the unit level rather than through a live model, per the testing skill's
determinism requirement:

- `generative-ui-tool.spec.ts`: `generativeUiToolName('123-bad')` throws — a component name
  that cannot form a valid tool name is rejected at registration time, not silently
  accepted, which is the structural mechanism preventing "arbitrary component" requests (a
  model can only ever select a name that exists in its manifest — there is no free-text
  `component` field to redirect to something like `"../../AdminPanel"` in the first place;
  see [Architecture](Phase_6_Architecture.md)).
- `generative-ui-tool.spec.ts`'s props-schema test confirms a malformed payload
  (`applicationId: 123` where the schema declares `z.string()`) fails `safeParse` — the same
  validation `ToolRuntime` runs before `execute()` for every tool call, generative or not
  (already covered exhaustively in `packages/tools/src/tool-runtime.spec.ts`, Phase 5,
  unmodified and re-run clean this session).
- `generative-ui.spec.tsx`'s renderer-exception test confirms no raw stack trace or
  uncontrolled crash reaches the user — a safe fallback row renders instead.

## Final full-workspace validation

```text
pnpm lint        -> PASS (20 projects)
pnpm typecheck   -> PASS (20 projects)
pnpm test        -> PASS (19 projects with a `test` target)
pnpm build       -> PASS (19 buildable projects)
```

`pnpm test` totals: **407 tests passed, 1 pre-existing optional OpenAI smoke test skipped**
(no `OPENAI_API_KEY` set — the same, unmodified Phase 2 skip condition), **zero failures**,
across (project: tests passed):

```text
protocol 31 · tools 48 · core 33 · provider 42 · client 19 · generative-ui 28 · server 31
context 61 · provider-openai 18 · provider-mock 13 · react 35 · ui 22 · react-custom-ui 1
react-basic 3 · react-generative-ui 7 · model-streaming-demo 3 (+1 skipped) · protocol-demo 4
react-context 3 · react-tools 5
```

(Read directly from each project's own Vitest summary line in this run's output.)

`pnpm build` succeeded for all 19 buildable projects; the pre-existing "use client module
directive may not be preserved when bundling" Rolldown/Vite warnings appear for
`@gixcopilot/react`'s new hook files' example bundles exactly as they did for every prior
hook file — not a new warning class.

## Not run in this session

- **Playwright/Chromium browser suite** (`pnpm test:e2e`) — not re-run; no Phase 6 UI surface
  was added to it (its coverage predates Phase 3's `CopilotChat`/`CopilotPopup`/
  `CopilotSidebar` UI and is unrelated to generative-UI/tool-renderer rendering, which this
  session's own React/UI/example test suites already exercise directly). Its `lint`/
  `typecheck` targets were re-run as part of the full workspace validation above and pass.
- No live/paid LLM provider was used anywhere in Phase 6; the OpenAI smoke test's skip is
  pre-existing Phase 2 behavior, unrelated to this phase.
