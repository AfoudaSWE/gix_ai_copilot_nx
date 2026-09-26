# `@gixcopilot/testing`

Deterministic testing for AI copilot applications. Only the model is scripted. Tools, the
Action Firewall, RAG, memory, approvals, agents and workflows are the real runtime packages.

```ts
import { createCopilotTestHarness, createTestModel, toolThenAnswer, createToolMocks,
  createSecurityFixture, expectToolCalled, expectActionDenied } from '@gixcopilot/testing';

const tools = createToolMocks();
tools.mock('applications.get', { result: { status: 'under_review' }, security: { risk: 'read-only' } });

const harness = createCopilotTestHarness({
  model: createTestModel(toolThenAnswer([{ name: 'applications.get', arguments: { id: 'APP-1024' } }], 'Under review.')),
  tools,
  security: createSecurityFixture({ subject: 'user-1', tenantId: 'tenant-a' }),
});
const run = await harness.run('Status of APP-1024?');
expectToolCalled(tools, 'applications.get', { times: 1, withArguments: { id: 'APP-1024' } });
// run.session is the same DevTools view a developer would inspect.
```

## What is in it

| Area | API |
| --- | --- |
| Model | `createTestModel(rules)` - request-aware rules (`when` sees the last user message, tool results and offered tools); text, streaming, tool calls, structured output, malformed output, `timeout`/`rate-limit`/`server-error`/`network` failures, stream interruption, hang-until-cancelled |
| Tools | `createToolMocks()`, `mockTool()`, `expectToolCalled`, `expectToolNotCalled`, `expectToolOrder` |
| Security | `createSecurityFixture()` (real permission-aware resolver + Action Firewall), `expectActionDenied`, `expectApprovalRequired`, `expectActionAllowed`, `expectToolUnavailable` |
| RAG | `createKnowledgeFixture({ documents })` (real indexing, ACL retrieval; deterministic embeddings), `expectSourceRetrieved`, `expectSourceNotRetrieved`, `expectCitation`, `expectAclApplied` |
| Memory | `createMemoryFixture({ records })`, `expectMemoryRetrieved`, `expectMemoryNotRetrieved`, `expectMemoryWritten`, `expectMemoryNotWritten`, `expectMemoryInaccessible` |
| Approvals | `createApprovalFixture({ clock })` - approve/reject/expire via the real approval store, always with an explicit human approver |
| Agents | `createAgentSimulation({ agents, models, tools, security })` with `run()` and `routeAndRun(router, ...)` |
| Workflows | `createWorkflowSimulation({ workflows, tools, security, clock })` with `restart()` to simulate a process restart; no Redis or Postgres |
| Harness | `createCopilotTestHarness({ model, tools, knowledge, memory, security })` |
| Replay | `createReplay`, `replayAgentRun`, `replayWorkflowRun`, `createRecordedRetriever` |
| Determinism | `createFakeClock()`, `createSequentialIds()` |

Every assertion throws `TestAssertionError`, so the helpers work with any test runner.

## Replay is always simulated

`createReplay(recording)` swaps every tool the original run called for a stub that returns the
recorded result. Replaying a run that deleted a record or refunded a payment deletes and
refunds nothing. Modes: `recorded` (recorded model responses), `mocked` (your test model) and
`live-model` (a real model, for comparing models or prompts). Tools stay simulated in every
mode. A tool runs for real only when it is named in `liveTools.allow`, and then it still passes
the permission-aware resolver and the Action Firewall. A recording made in `metadata-only`
mode has no payloads to replay, so recorded replay refuses it.

## Non-responsibilities

- Not an evaluation framework. Evals measure behavior across datasets; see `@gixcopilot/evals`.
- No stubbed security. Fixtures use the real Phase 7 stack; there is no "allow everything"
  switch.
- Model output never counts as a human approval. The approval fixture always records an
  explicit approver.
- Not for production use. It is a test-time dependency.
