# Testing

`@gixcopilot/testing` makes AI features deterministic to test, with no paid API:

- `createTestModel([...])` / `toolThenAnswer()`: scripted, request-aware model responses
  (text, tool calls, structured output, malformed output, 429/500/timeouts, interruption).
- `createToolMocks`, `mockTool`, `expectToolCalled`, `expectToolNotCalled`, `expectToolOrder`.
- `createSecurityFixture`, `expectActionDenied`, `expectApprovalRequired` (assert on the
  firewall's decision, not on the model's wording).
- Knowledge, memory and approval fixtures (`expectAclApplied`, `expectMemoryInaccessible`, …).
- `createAgentSimulation`, `createWorkflowSimulation`, fake clock, sequential ids.
- `createCopilotTestHarness` for end-to-end behavior; `createReplay` replays recorded runs
  without repeating side effects.

`npx aicopilot test` runs your test script with `AICOPILOT_ENV=test`. The repository's own
suites: Vitest (unit, integration), Testcontainers (PostgreSQL, pgvector, Redis, BullMQ),
Playwright (browser and accessibility), packed-tarball consumer projects, and a container
smoke test. ADR [0018](../adr/0018-testing-harness-and-safe-replay.md).
