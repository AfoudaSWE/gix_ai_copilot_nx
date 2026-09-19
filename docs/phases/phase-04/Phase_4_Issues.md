# Phase 4 Issues and Limits

## Found and fixed during implementation

1. **Context resolution broke Phase 3's synchronous dispatch invariant.** Once
   `chat-store.ts` awaited `resolveContextMessage()` unconditionally before calling
   `client.run()`, `provider.spec.tsx`'s existing fixture (which asserts `client.run()` is
   called within the same synchronous `act()` as `sendMessage()`) started failing — 5 of 7
   Phase 3 tests broke. Root cause: even an async function that never truly suspends still
   introduces a microtask gap once `await`ed. Fixed by allowing `resolveContextMessage` to
   return synchronously (`undefined`) when nothing is registered — see
   [Decisions](Phase_4_Decisions.md) and ADR 0009. All 7 Phase 3 tests pass unchanged again.
2. **A naive budget test deduplicated away the item it meant to test.** An early version of
   the "high priority included, low priority excluded for budget" engine test used the same
   filler value (`'x'.repeat(40)`) for both the `critical` and `high` priority items,
   which the deduplication step correctly collapsed into one, making the exclusion assertion
   fail for the wrong reason. Fixed by using distinct values per item.
3. **Compressing all the way down to a token or two produced a near-empty "included"
   fragment instead of a clean exclusion.** The first `ContextEngine` budgeting
   implementation always tried the compressor once an item didn't fit, even with almost no
   budget left. Added `MIN_COMPRESSIBLE_BUDGET_TOKENS` (16) below which an item is excluded
   outright — see [Decisions](Phase_4_Decisions.md).
4. **Ambiguous `findByText` matches in the example's own integration test.** The assistant's
   answer text (e.g. "APP-1003") was also present in the selected-row button and in the
   screen-reader-only status region, so `screen.findByText(/APP-1003/)` matched multiple
   elements and threw. Fixed by scoping queries to `within(screen.getByRole('log'))` (the
   conversation region only).
5. **Strict lint rules on test assertions.** `expect.any(...)` and `.length` on a
   `JSON.parse()` result are typed `any`, which the workspace's
   `@typescript-eslint/no-unsafe-*` rules reject even in test files. Fixed by capturing real
   registration ids instead of `expect.any(String)`, and by narrowing `JSON.parse()`'s result
   type explicitly before accessing `.length`.

## Known limitations (non-blocking, in scope for later phases or explicitly deferred)

- **The default token estimator is an approximation** (~4 characters per token), not a real
  tokenizer — by design (Section 26); `ContextEngineOptions.estimator` is the escape hatch.
- **Sensitivity/PII policy is a conservative default only** (excludes `restricted`), not
  enforcement. Phase 7 owns real authorization/PII policy — see the security skill.
- **No AI-based context selection.** Resolution is fully deterministic (scope/priority/
  budget); Section 19 explicitly asks for this, not a future capability gap.
- **No whole-context (multi-item) compression/summarization.** `ContextCompressor` operates
  per-item; summarizing across several lower-priority items together (e.g. collapsing a long
  conversation history) is a plausible future pipeline stage, not built here — see ADR 0009.
- **The Playwright browser (Chromium) regression suite for Phase 3's UI (`pnpm test:e2e`)
  was not re-run in this session.** A pre-existing local process (a `react-basic` demo
  server, not started by this session — `node --env-file-if-exists=.env dist/server.js`,
  observed already listening on `127.0.0.1:4318` before any Phase 4 command ran) held the
  port the Playwright config's `webServer` needs, and it was not stopped without asking
  first. Every other regression surface — `pnpm lint`, `pnpm typecheck`, `pnpm test` (all
  Vitest suites, including every Phase 1–3 package and example), and `pnpm build` — was run
  fresh in this session and passed; see [Testing](Phase_4_Testing.md) for exact results. No
  code touched by Phase 4 (`@gixcopilot/context`, `@gixcopilot/react`,
  `examples/react-context`) affects `@gixcopilot/ui`'s DOM/accessibility behavior that the
  Playwright suite exercises, but this is disclosed rather than silently skipped.
- **`examples/react-context`'s demo `ModelProvider` is not a real LLM.** It parses
  `id`/`status`/`applicantName` out of the leading `system` message's JSON text and
  templates a sentence — deterministic and credential-free by design (matching
  `@gixcopilot/provider-mock`'s own non-network approach), not a shortcoming to fix.

Tools, frontend/backend tool calling, OpenAPI/MCP integration, Generative UI, HITL/approval,
the Action Firewall, RAG, persistent memory, agents, and DevTools UI are deliberately outside
this phase — see the phase-gate skill and `docs/phases/phase-04/Phase_4_Docs.md`'s scope
statement, not incomplete Phase 4 features.
