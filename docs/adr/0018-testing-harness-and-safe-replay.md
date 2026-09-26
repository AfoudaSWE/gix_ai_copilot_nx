# ADR 0018: Testing Harness Architecture and Replay That Defaults to Simulation

## Status

Accepted (Phase 11).

## Context

AI applications need deterministic tests that still exercise the real security, RAG, memory,
agent and workflow code, plus a way to reproduce a recorded run for debugging. A test rig that
stubs security proves nothing about security, and a replay that repeats a refund is an
incident.

## Decisions

1. **Only the model is scripted.** `@gixcopilot/testing` fixtures build on the real packages:
   the permission-aware resolver and Action Firewall (`createSecurityFixture`), indexing and
   ACL retrieval with deterministic embeddings (`createKnowledgeFixture`), the real memory
   store and service (`createMemoryFixture`), the real approval store (`createApprovalFixture`),
   and the real agent runtime and workflow engine. There is no "allow everything" switch.
2. **Request-aware test models.** `createTestModel(rules)` matches on the real request (last user
   message, tool results already present, offered tools) and streams exactly what providers
   stream. It also simulates timeouts, 429s, 500s, malformed structured output, stream
   interruption and cancellation using the normalized provider error codes.
3. **Tool mocks are real tools.** A mock is a `ToolDefinition`, so it passes validation and the
   firewall. Calls are logged at invocation, so an abandoned (timed-out) call is visible.
   Assertions throw `TestAssertionError` and work with any test runner.
4. **Approvals are never model-made.** The approval fixture records decisions with an explicit
   human approver subject through the real store.
5. **Replay is simulated by default.** `createReplay(recording)` replaces every tool the original
   run called with a stub that returns the recorded result. The modes are `recorded`
   (recorded model responses), `mocked` and `live-model` (to compare models or prompts); tools
   stay simulated in every mode. A tool runs for real only when named in `liveTools.allow`,
   and then it still passes the real resolver and firewall of the supplied security fixture.
   Workflow replay re-applies recorded approval outcomes in a throwaway store; no real approval
   request is created. Replay results are labeled `REPLAY (simulated)`.
6. **Payload-less recordings are not replayable.** Replay refuses a `metadata-only` recording
   instead of calling tools with missing arguments.

## Consequences

- Tests exercise production security code, and they found real bugs this phase (redaction of
  counts, the DevTools resume projection, cross-run id joins).
- Tools written without security metadata are held for approval under the default risk policy.
  Fixtures therefore classify their tools (`risk`), as production code must.
- `@gixcopilot/testing` is a leaf that depends on nearly everything; nothing may depend on it.
