# Phase 5 Issues and Limits

## Found and fixed during implementation

1. **Tool lifecycle events queued just before a thrown error were silently lost.**
   `@gixcopilot/core`'s `runtime.ts` only drained its `pendingToolEvents` queue after a
   *successful* `deltaIterator.next()` resolution; if the wrapped executor's generator
   rejected instead, the drain step was never reached. Surfaced by a real integration test
   (an unresolvable tool name looping to `TOOL_ITERATION_LIMIT_EXCEEDED` with zero
   `tool.requested` events ever visible). **Fixed** by also draining in the `catch` block —
   see [Testing](Phase_5_Testing.md) and ADR 0010's Consequences section for the full account.
2. **A frontend tool round trip deadlocked.** The tool-calling executor announced a frontend
   call's `requested`/`started` phases via `onToolEvent`, then immediately awaited
   `frontendToolBridge.awaitResult()` with no intervening `yield` — so the event the client
   needed to see in order to respond was never flushed to the wire before the executor
   blocked waiting for that same client's response. **Fixed** by having the executor
   `yield ''` (a no-op text delta, now suppressed at the `runtime.ts` level) immediately
   after announcing every call in a batch, forcing a drain before any blocking dispatch.
   Verified by a real-network round-trip test that hung before the fix (5s timeout) and
   passes in under half a second after it.
3. **A test asserting `TOOL_NOT_FOUND` handling assumed the wrong provider behavior.** The
   first version of the "unregistered tool" server test used a fake provider that always
   re-requested the same nonexistent tool regardless of the tool result it received back —
   correctly, but unexpectedly, driving the loop to `TOOL_ITERATION_LIMIT_EXCEEDED` after 8
   rounds rather than stopping after one. Fixed by making the fake provider check whether a
   `tool`-role message already answered the call, matching how a real model would behave.
4. **A `toEqual` assertion using `expect.any(String)`** (server-package `ToolResult` test)
   is typed `any`, which the workspace's `@typescript-eslint/no-unsafe-*` rules reject even
   in test files — the same class of issue Phase 4 hit. Fixed by asserting `typeof
   result.toolCallId === 'string'` separately instead.
5. **Ambiguous `getByText` match in the example's cancellation test.** "Generation stopped"
   appears in both the screen-reader-only status region and the response-actions area once a
   run is stopped, so `screen.getByText('Generation stopped')` threw a multiple-matches
   error. Fixed with `getAllByText(...).length > 0`.

## Mechanical, behavior-preserving fixes required by an additive protocol change

Widening `ContentPart` from a single `{ type: 'text' }` shape to a discriminated union is
backward-compatible for the *wire* (an old client ignoring `tool_call`/`tool_result` parts is
unaffected), but it does make `part.text` a compile error anywhere a consumer accessed it
without narrowing by `type` first, since that property no longer exists on every union
member. Five pre-existing call sites needed a `.filter(part => part.type === 'text')`
helper: `@gixcopilot/ui`'s `UserMessage`/`AssistantMessage`/completion-announcement,
`@gixcopilot/react`'s `chat-store.ts` delta aggregation, and
`examples/react-custom-ui/src/app.tsx`. Each site only ever saw text parts before Phase 5
introduced the other variants, so behavior is unchanged — see [Testing](Phase_5_Testing.md).

## Known limitations (non-blocking, in scope for later phases or explicitly deferred)

- **Concurrency policy is batch-wide, not per-pair.** A batch of tool calls runs fully
  parallel unless *any* call in it declares `serial`/`exclusive`, in which case the *whole*
  batch runs sequentially — there is no dependency graph between individual calls. This
  matches the tool-system skill's explicit guidance against overbuilding a distributed
  scheduler for Phase 5's scale; revisit only if a concrete need for finer-grained ordering
  appears.
- **`FrontendToolBridge` is in-memory and process-local**, exactly like `RunRegistry` since
  Phase 1 (see `docs/TECHNICAL_DEBT.md`) — a multi-instance deployment needs a shared store
  for a frontend tool call to be resolvable regardless of which instance receives the
  client's `POST /runs/:runId/tool-results`. Not a Phase 5 regression; the same limitation
  the run registry has always had, now also applying to this new correlation map.
- **Streamed tool-call argument assembly (`ToolCallAssembler`) is unit-tested against a
  synthetic OpenAI-shaped stream, not a live API call** — consistent with every other
  OpenAI-adapter test in this repository (no network access or API key in this environment).
  The mapping function itself is exercised exactly as OpenAI's own streaming shape requires
  (fragmented `index`/`id`/`function.name`/`function.arguments` deltas).
- **A tool's own timeout races cooperatively, not preemptively.** `ToolRuntime`'s timeout
  reports `TIMEOUT`/`CANCELLED` to the caller as soon as the deadline/abort fires, but a
  tool `execute()` body that ignores its `context.signal` and never resolves/rejects
  continues running in the background (a standard JavaScript limitation, not specific to
  this implementation) — the caller is never blocked by it, but the orphaned work isn't
  forcibly terminated. Tool authors are expected to honor `context.signal` for genuinely
  cancellable work, exactly as the sdk-design skill's cancellation-support requirement
  intends; this is documented rather than silently assumed.
- **`examples/react-tools`' demo `ModelProvider` is not a real LLM.** It decides whether to
  request a tool call by regex-matching the conversation's own text — deterministic and
  credential-free by design (Section 73's explicit "mock model tool calling" requirement),
  not a shortcoming to fix.
- **The Chromium/Playwright `react-e2e` suite was not re-run this session.** No Phase 5 UI
  surface was added to it (its coverage predates Phase 3's UI, unrelated to tool activity
  rendering); its `lint`/`typecheck` targets were re-run and pass. Disclosed, not silently
  skipped.

Generative UI, dynamic model-generated React/JavaScript execution, an Action Firewall,
HITL/approval workflows, OpenAPI-to-tool auto-generation, MCP integration, RAG, persistent
memory, agents, and DevTools UI are deliberately outside this phase — see the phase-gate
skill and `docs/phases/phase-05/Phase_5_Docs.md`'s scope statement, not incomplete Phase 5
features. `metadata.riskClass`/`metadata.sensitivity`/`metadata.custom` exist only as
classification/extension points for those future phases and are never treated as
enforcement anywhere in this codebase.
