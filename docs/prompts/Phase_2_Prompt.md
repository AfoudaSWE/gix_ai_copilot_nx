# AI Copilot SDK — Phase 2: LLM Runtime & Streaming

Implement **Phase 2 only** of the AI Copilot SDK.

Current phase:

```text
PHASE 02 — LLM RUNTIME & STREAMING
```

The objective is to transform the framework-independent Phase 1 runtime into a real provider-independent LLM runtime capable of:

```text
Client
  ↓
Server
  ↓
Core Runtime
  ↓
ModelProvider abstraction
  ↓
Provider Adapter
  ↓
LLM
  ↓
Streaming tokens
  ↓
Protocol events
  ↓
SSE
  ↓
Client
```

Do NOT start Phase 3.

---

# 0. Phase Gate

Phase 2 includes:

* LLM runtime abstraction
* provider-independent model contracts
* model provider registry
* first real provider adapter
* streaming model output
* normalized provider errors
* cancellation
* timeout
* retry
* usage metadata
* token usage
* latency metadata
* finish reasons
* provider metadata
* model configuration
* model selection foundation
* resilience foundation
* deterministic mock provider
* integration testing

Phase 2 does NOT include:

* React UI
* Angular UI
* Copilot components
* application context engine
* frontend tools
* backend tools
* tool calling
* Generative UI
* HITL
* AI Action Firewall
* OpenAPI tools
* MCP
* RAG
* vector database
* persistent memory
* agents
* multi-agent orchestration
* workflows
* DevTools UI
* AI evaluation platform
* management platform

Do not implement future functionality simply because a provider SDK exposes it.

Example:

If the provider supports function/tool calling, do NOT implement tool calling during Phase 2.

Tool calling belongs to Phase 5.

---

# 1. Read Skills

Before implementation, read:

```text
.claude/skills/ai-copilot-project/SKILL.md
.claude/skills/phase-gate/SKILL.md
```

Apply at minimum:

```text
project-architecture
typescript-standards
sdk-design
protocol-design
node-backend
ai-runtime
api-design
observability
testing
documentation
git-workflow
code-review
dependency-policy
backward-compatibility
phase-gate
```

Read security guidance where model/provider input or output crosses a trust boundary.

---

# 2. Read Phase 1 Documentation

Before touching code, read:

```text
docs/phases/phase-01/Phase_1_Docs.md
docs/phases/phase-01/Phase_1_Architecture.md
docs/phases/phase-01/Phase_1_Implementation.md
docs/phases/phase-01/Phase_1_Status.md
docs/phases/phase-01/Phase_1_Testing.md
docs/phases/phase-01/Phase_1_Decisions.md
docs/phases/phase-01/Phase_1_API.md
docs/phases/phase-01/Phase_1_Files.md
docs/phases/phase-01/Phase_1_Issues.md
docs/phases/phase-01/Phase_1_Handoff.md
```

Also inspect:

```text
docs/PROJECT_STATUS.md
docs/ARCHITECTURE_OVERVIEW.md
docs/ROADMAP.md
docs/DECISIONS.md
docs/TECHNICAL_DEBT.md
```

Do not assume the original Phase 1 prompt exactly matches repository reality.

The repository is the source of truth.

---

# 3. Verify Phase 1

Before Phase 2 implementation, verify Phase 1 still works.

Run the equivalent of:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also verify the Phase 1 protocol integration test.

Check:

```text
protocol        ✓
core            ✓
client          ✓
server          ✓
SSE             ✓
cancellation    ✓
integration     ✓
```

If Phase 1 has a serious failure that blocks Phase 2:

STOP.

Document the blocker.

Do not build Phase 2 on a broken foundation.

Minor unrelated warnings may be documented and handled according to project rules.

---

# 4. Inspect Repository

Inspect:

```text
packages/
examples/
docs/
tools/
package.json
pnpm-workspace.yaml
nx.json
tsconfig.base.json
```

Understand actual public APIs before designing Phase 2.

Do not unnecessarily redesign stable Phase 1 contracts.

---

# 5. Phase 2 Goal

Phase 1 proved:

```text
Input
 ↓
Client
 ↓
Server
 ↓
Core
 ↓
Deterministic Executor
 ↓
Protocol Events
 ↓
SSE
 ↓
Client
```

Phase 2 should evolve this into:

```text
Input
 ↓
Client
 ↓
Server
 ↓
Core Runtime
 ↓
Model Runtime
 ↓
ModelProvider
 ↓
Provider Adapter
 ↓
LLM
 ↓
Streaming Provider Events
 ↓
Normalized Runtime Events
 ↓
Copilot Protocol
 ↓
SSE
 ↓
Client
```

The rest of the SDK must not care whether the underlying model is:

```text
OpenAI
Anthropic
Gemini
Ollama
or another provider
```

That abstraction is the primary architectural goal of Phase 2.

---

# 6. Package Architecture

Preserve Phase 1 packages:

```text
@aicopilot/protocol
@aicopilot/core
@aicopilot/client
@aicopilot/server
```

Add provider architecture cleanly.

Recommended structure:

```text
packages/
├── protocol/
├── core/
├── client/
├── server/
│
└── providers/
    ├── provider-core/
    ├── openai/
    └── mock/
```

Package naming may be:

```text
@aicopilot/provider
@aicopilot/provider-openai
@aicopilot/provider-mock
```

or another clean naming convention consistent with the repository.

Choose one approach and document it.

Do NOT create packages for every future provider unless implemented.

Do not create empty:

```text
anthropic
gemini
ollama
```

packages just because they are planned.

---

# 7. Critical Dependency Direction

Provider SDKs must remain outside core.

Correct:

```text
                  protocol
                     ↑
                     │
                    core
                     ↑
                     │
               model contract
                     ↑
              ┌──────┴───────┐
              │              │
          OpenAI          Mock Provider
```

More specifically:

```text
OpenAI SDK
    ↓
OpenAI Adapter
    ↓
ModelProvider interface
    ↓
Core Runtime
```

Forbidden:

```text
Core Runtime
    ↓
OpenAI SDK
```

Core must never import provider-specific SDK types.

Public framework-independent APIs must not expose provider SDK types.

---

# 8. ModelProvider Contract

Design the central provider abstraction.

Conceptually:

```ts
interface ModelProvider {
  readonly id: string;

  stream(
    request: ModelRequest,
    options?: ModelExecutionOptions
  ): AsyncIterable<ModelStreamEvent>;
}
```

Exact API design is your responsibility.

It should support the needs of Phase 2 without predicting every future capability.

---

# 9. Model Request

Define provider-neutral input.

Conceptually:

```ts
interface ModelRequest {
  model: string;
  messages: ModelMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
}
```

Evaluate fields carefully.

Do not blindly mirror one provider's API.

Do not include tool definitions yet.

Do not include RAG concepts.

Do not include agent concepts.

---

# 10. Model Messages

Define provider-independent model messages.

At minimum consider:

```text
system
user
assistant
```

Avoid provider-specific role names leaking into core.

Content should be designed with future extensibility in mind, but Phase 2 only needs text unless Phase 1 already established richer content primitives.

Do not implement unnecessary multimodal functionality unless required by existing protocol architecture.

---

# 11. Model Stream Events

Provider adapters should normalize raw provider streams into internal events.

Conceptually:

```text
model.started

content.delta

usage.updated

model.completed

model.failed
```

These do not necessarily need to become public protocol event names.

Separate:

```text
Provider Event
      ↓
Runtime Event
      ↓
Protocol Event
```

Do not tightly couple raw provider events directly to SSE.

---

# 12. Provider Adapter Responsibility

Each provider adapter owns translation between:

```text
AI Copilot model contract
        ↕
Provider API
```

For example:

```text
ModelRequest
     ↓
OpenAI request

OpenAI stream
     ↓
ModelStreamEvent
```

Provider-specific logic belongs inside the adapter.

---

# 13. First Real Provider

Implement ONE real provider first.

Preferred first adapter:

```text
OpenAI
```

unless the repository already establishes another provider as the first implementation.

Keep it isolated:

```text
@aicopilot/provider-openai
```

The OpenAI SDK must not become a dependency of:

```text
protocol
core
client
```

Only the adapter package should require it.

---

# 14. API Key Handling

Never commit keys.

Support environment-based configuration.

Conceptually:

```text
OPENAI_API_KEY
```

Do not expose secrets to:

```text
browser
protocol events
logs
errors
metadata
```

Provider credentials belong server-side.

Document configuration.

---

# 15. Mock Provider

Create a deterministic mock provider.

This is mandatory.

Example:

```ts
createMockProvider({
  chunks: [
    "Hello",
    " from",
    " the",
    " runtime"
  ]
});
```

It should support testing:

* streaming
* delay where controlled
* failures
* cancellation
* usage
* finish reasons

Tests should primarily use the mock provider.

Real provider calls must not be required for CI.

---

# 16. Provider Registry

Create a simple provider registry.

Conceptually:

```ts
registry.register("openai", openAIProvider);
registry.register("mock", mockProvider);

registry.get("openai");
```

Requirements:

* duplicate registration behavior defined
* unknown provider handled clearly
* typed API
* no global mutable singleton requirement
* testable
* dependency-injectable

Do not build a plugin marketplace.

---

# 17. Model Identification

Define a provider-neutral model reference.

Consider something conceptually like:

```text
openai:gpt-...
```

or:

```ts
{
  provider: "openai",
  model: "..."
}
```

Choose a clean representation.

Document the decision.

Avoid assumptions that all providers identify models the same way.

---

# 18. Model Runtime

Implement a model runtime responsible for:

```text
Provider lookup
Request normalization
Execution
Streaming
Cancellation
Timeout
Retry
Usage collection
Latency collection
Error normalization
Completion
```

Conceptually:

```ts
const runtime = createModelRuntime({
  providers
});

const stream = runtime.stream({
  provider: "openai",
  model: "...",
  messages: [...]
});
```

Do not make this an agent runtime.

It is a model execution runtime.

---

# 19. Streaming Pipeline

Implement real streaming.

Expected flow:

```text
Provider
   │
   ├─ token/chunk
   ↓
Provider Adapter
   │
   ├─ content.delta
   ↓
Model Runtime
   │
   ├─ normalized delta
   ↓
Core
   │
   ├─ message.delta
   ↓
Protocol
   ↓
SSE
   ↓
Client
```

Do not buffer the entire response before returning it.

---

# 20. First-Token Streaming

Verify that content reaches the client incrementally.

Bad:

```text
LLM generates entire answer
       ↓
Server waits
       ↓
One giant message.delta
```

Expected:

```text
LLM
 ↓
chunk
 ↓
client

chunk
 ↓
client

chunk
 ↓
client
```

Measure first-token/first-chunk latency where practical.

---

# 21. Backpressure and Resource Handling

Ensure streamed execution does not create obvious resource leaks.

Handle:

* consumer cancellation
* client disconnect
* provider completion
* provider error
* timeout
* aborted request

Do not allow provider streams to continue indefinitely after the consumer has disconnected.

---

# 22. Cancellation

Extend Phase 1 cancellation through the model layer.

Required path:

```text
Client
  ↓
Cancel
  ↓
Server
  ↓
Core
  ↓
Model Runtime
  ↓
AbortSignal
  ↓
Provider Adapter
  ↓
Provider request cancelled
```

Cancellation must remain idempotent.

Expected terminal state:

```text
run.cancelled
```

Do not produce:

```text
run.completed
```

after cancellation.

---

# 23. Timeout

Add configurable model execution timeout.

Conceptually:

```ts
timeoutMs: 30_000
```

Timeout should:

1. abort provider request
2. normalize error
3. clean resources
4. terminate run correctly

Do not confuse:

```text
user cancellation
```

with:

```text
timeout
```

They should remain distinguishable internally.

---

# 24. Retry Strategy

Implement conservative retry support.

Retry only errors that are considered retryable.

Examples may include:

```text
temporary network errors
rate-limit responses where appropriate
selected provider 5xx responses
```

Do not blindly retry:

```text
authentication failure
invalid request
invalid model
user cancellation
schema validation errors
```

Support configurable:

```text
maxAttempts
baseDelay
maxDelay
```

Use bounded exponential backoff with jitter if appropriate.

Keep tests deterministic by allowing retry timing to be controlled.

---

# 25. Retry Metadata

Track:

```text
attempt
maxAttempts
retryReason
```

Do not expose sensitive provider information unnecessarily.

Observability should make retries visible.

---

# 26. Error Normalization

Expand the Phase 1 error system carefully.

Possible model-related categories:

```text
MODEL_ERROR
PROVIDER_ERROR
AUTHENTICATION_ERROR
RATE_LIMITED
MODEL_NOT_FOUND
CONTEXT_LIMIT_EXCEEDED
TIMEOUT
NETWORK_ERROR
CANCELLED
```

Do not make every provider's exact error code part of the public core contract.

Provider adapters map raw errors into normalized errors.

Preserve provider error information internally where safe/useful.

---

# 27. Retryability

Normalized errors should clearly communicate:

```ts
retryable: boolean
```

The retry system must use normalized error classification rather than brittle string matching where possible.

---

# 28. Finish Reasons

Normalize provider completion reasons.

Consider:

```text
STOP
LENGTH
CONTENT_FILTER
CANCELLED
ERROR
UNKNOWN
```

Do not force provider-specific finish reasons into core.

Retain raw finish reason only in safe provider metadata if useful.

---

# 29. Usage Model

Introduce normalized usage metadata.

Conceptually:

```ts
interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}
```

Not all providers expose identical information.

Therefore fields may need to be optional.

Never fabricate missing token counts.

---

# 30. Usage Integration

At completion, make usage available to the runtime.

Potentially through:

```text
run.completed
```

or associated metadata, depending on the existing protocol.

Do not introduce a breaking Phase 1 protocol change without justification.

If protocol extension is needed:

* maintain compatibility
* update schemas
* update tests
* document the change
* create ADR if architectural

---

# 31. Latency Metadata

Measure runtime-level timings such as:

```text
startedAt
firstChunkAt
completedAt

totalLatencyMs
timeToFirstChunkMs
```

Keep provider-independent.

Do not overbuild a telemetry platform.

Phase 11 owns full observability tooling.

---

# 32. Provider Metadata

Allow safe optional metadata such as:

```text
provider
model
requestId
finishReason
```

Never expose:

* API keys
* authorization headers
* sensitive request internals

---

# 33. Runtime Configuration

Design clean runtime configuration.

Conceptually:

```ts
createModelRuntime({
  providers: [...],
  defaults: {
    timeoutMs: 30_000,
    retry: {
      maxAttempts: 3
    }
  }
});
```

Allow per-request overrides where appropriate.

Avoid giant configuration objects.

---

# 34. Default Provider

Support optional default provider/model configuration if useful.

Example:

```ts
createModelRuntime({
  defaultProvider: "openai",
  defaultModel: "...",
  providers: [...]
});
```

Explicit request configuration should override defaults.

Validate missing configuration early.

---

# 35. Model Selection Foundation

Phase 2 may provide deterministic model selection by explicit configuration.

Example:

```text
provider = openai
model = configured model
```

Do NOT implement intelligent model routing.

Do NOT select models using an LLM.

Do NOT implement cost-aware dynamic routing yet.

Only establish clean abstractions for future routing.

---

# 36. Fallback Foundation

Do NOT build a complex automatic fallback engine.

However, design runtime boundaries so Phase 12 can later support:

```text
Primary Model
     ↓ failure
Fallback Model
```

If a minimal explicitly configured fallback is implemented, keep it simple and well-tested.

Do not let fallback logic significantly expand Phase 2 scope.

---

# 37. Server Integration

Update `@aicopilot/server` so run requests can execute against the model runtime.

Conceptual request:

```json
{
  "threadId": "...",
  "model": {
    "provider": "openai",
    "model": "..."
  },
  "messages": [
    {
      "role": "user",
      "content": "Explain distributed systems."
    }
  ]
}
```

Exact schema should follow established Phase 1 protocol conventions.

Validate every request.

---

# 38. Keep Credentials Server-Side

The client must never send provider credentials.

Correct:

```text
Browser
   ↓
model identifier
   ↓
Server
   ↓
server-side provider configuration
   ↓
Provider
```

Forbidden:

```text
Browser
   ↓
OpenAI API key
```

---

# 39. Client Integration

Preserve the framework-independent Phase 1 client.

Conceptually:

```ts
const run = client.run({
  threadId,
  model: {
    provider: "openai",
    model: "..."
  },
  messages: [...]
});

for await (const event of run.events) {
  switch (event.type) {
    case "message.delta":
      // streamed text
      break;
  }
}
```

Do not add React hooks.

---

# 40. Protocol Evolution

Review whether Phase 1 protocol needs additional fields/events for:

* model information
* usage
* finish reason
* retry information
* timings

Prefer backward-compatible extensions.

Do not expose provider SDK objects.

Document every public protocol change in:

```text
Phase_2_API.md
Phase_2_Implementation.md
Phase_2_Decisions.md
```

---

# 41. Observability Foundation

Add lightweight structured instrumentation.

Capture:

```text
runId
threadId
provider
model
attempt
duration
firstChunkLatency
status
errorCode
```

Never log:

```text
API keys
authorization headers
full secrets
```

Be cautious about logging user prompts/responses by default.

Do not implement the Phase 11 DevTools/observability platform.

---

# 42. Logging

Use structured logs.

Avoid:

```ts
console.log("something");
```

through production runtime code where an existing logging abstraction exists.

If Phase 1 established logging conventions, preserve them.

Allow consumers to supply/integrate their logger rather than forcing a large logging framework into core.

---

# 43. OpenAI Adapter

Implement the first production provider adapter.

Responsibilities:

```text
ModelRequest
     ↓
OpenAI request conversion
     ↓
OpenAI streaming API
     ↓
raw stream events
     ↓
normalized ModelStreamEvent
```

Handle:

* text streaming
* completion
* cancellation
* timeout propagation
* rate limits
* authentication errors
* model errors
* usage when available
* finish reasons

Do not implement:

* tool calls
* function calls
* assistants
* vector stores
* hosted retrieval
* agent orchestration

Those are outside Phase 2.

---

# 44. Provider-Specific Types

Provider SDK types must remain inside:

```text
@aicopilot/provider-openai
```

Do not export OpenAI SDK request/response types through:

```text
@aicopilot/core
@aicopilot/protocol
@aicopilot/client
```

---

# 45. Mock Provider Testing

The mock provider should support scenarios like:

```text
normal stream

slow stream

provider failure before first chunk

provider failure during stream

timeout

cancellation

usage returned

no usage returned

finish reason

retryable failure

non-retryable failure
```

Use it heavily for tests.

---

# 46. Unit Tests — Model Contracts

Test:

* valid requests
* invalid configuration
* provider-neutral message handling
* model references
* finish reasons
* usage
* normalized errors

---

# 47. Unit Tests — Provider Registry

Test:

* register
* resolve
* unknown provider
* duplicate provider behavior
* isolated registry instances

---

# 48. Unit Tests — Model Runtime

Test:

* successful execution
* streaming
* ordering
* completion
* usage
* latency
* cancellation
* timeout
* retry
* non-retryable errors
* provider lookup failure
* executor cleanup

---

# 49. Unit Tests — OpenAI Adapter

Do NOT make real OpenAI calls in normal tests.

Mock the provider SDK/network boundary.

Test:

* request mapping
* streamed deltas
* finish reason mapping
* usage mapping
* cancellation
* rate-limit mapping
* auth failure mapping
* provider errors

---

# 50. Server Tests

Test:

* valid model run
* invalid provider
* invalid model request
* SSE streaming
* usage metadata
* normalized error
* cancellation
* timeout
* client disconnect

---

# 51. Client Tests

Test:

* streamed model output
* model metadata
* usage
* normalized errors
* cancellation
* malformed event
* disconnect

---

# 52. End-to-End Mock Integration Test

Mandatory:

```text
Client
  ↓
Server
  ↓
Core
  ↓
Model Runtime
  ↓
Mock Provider
  ↓
Streaming
  ↓
Core protocol events
  ↓
SSE
  ↓
Client
```

Verify exact event ordering.

---

# 53. Optional Real Provider Smoke Test

Create an optional smoke-test/example that runs only when the required environment variable exists.

Example:

```text
OPENAI_API_KEY
```

If missing:

```text
SKIPPED
```

not:

```text
FAILED
```

This smoke test must not be part of deterministic CI requirements unless CI explicitly provides credentials.

Never fake a successful provider test.

---

# 54. Example Application

Extend or add an example demonstrating real model streaming.

Recommended:

```text
examples/model-streaming/
```

Support:

```text
mock provider
```

by default.

Optionally support:

```text
OpenAI
```

when configured.

Example output:

```text
Provider: mock
Model: mock-model

> Explain event-driven architecture

Event
-driven
 architecture
 allows
...

Finish reason: STOP

Input tokens: ...
Output tokens: ...
Total latency: ...
```

Do not build React UI.

---

# 55. Documentation

Create/populate:

```text
docs/phases/phase-02/
```

Required:

```text
Phase_2_Docs.md
Phase_2_Architecture.md
Phase_2_Implementation.md
Phase_2_Status.md
Phase_2_Testing.md
Phase_2_Decisions.md
Phase_2_API.md
Phase_2_Files.md
Phase_2_Issues.md
Phase_2_Handoff.md
```

Do not leave them as generic placeholders after implementation.

---

# 56. Phase 2 Architecture Documentation

`Phase_2_Architecture.md` must show at least:

```text
Client
  ↓
Server
  ↓
Core
  ↓
Model Runtime
  ↓
Provider Registry
  ↓
ModelProvider
  ↓
Provider Adapter
  ↓
LLM
```

Also document streaming:

```text
LLM
 ↓
Raw Provider Chunk
 ↓
Provider Adapter
 ↓
ModelStreamEvent
 ↓
Core
 ↓
CopilotEvent
 ↓
SSE
 ↓
Client
```

Document dependency direction.

---

# 57. ADRs

Create ADRs for meaningful decisions.

Likely examples:

```text
Provider abstraction design
Provider package isolation
Model identification strategy
Retry policy
Timeout/cancellation model
Usage normalization
```

Do not create meaningless ADRs merely to increase document count.

Update:

```text
docs/DECISIONS.md
```

---

# 58. Project Status

At Phase 2 start:

```text
Phase 01
COMPLETE

Phase 02
IN PROGRESS

Phase 03
NOT STARTED
```

Only mark Phase 1 COMPLETE if repository evidence confirms that.

At Phase 2 completion:

```text
Phase 02
COMPLETE
```

only if acceptance criteria pass.

Phase 3 remains:

```text
NOT STARTED
LOCKED
```

---

# 59. Technical Debt

Update:

```text
docs/TECHNICAL_DEBT.md
```

only for real technical debt.

Examples:

```text
provider feature intentionally deferred to later phase
```

is generally a future feature, not automatically debt.

---

# 60. Git Commit Plan

Use focused commits.

Recommended boundaries:

```text
feat(runtime): define provider-independent model contracts

feat(runtime): add model provider registry

feat(runtime): implement streaming model execution

feat(runtime): add cancellation timeout and retries

feat(provider): add deterministic mock model provider

feat(provider-openai): add openai streaming adapter

feat(server): connect model runtime to sse runs

feat(client): support model execution metadata

test(runtime): cover streaming and resilience

test(integration): verify end-to-end model streaming

docs(phase-02): document llm runtime architecture
```

Adjust to actual repository state.

Never invent commit hashes.

---

# 61. Implementation Order

Follow this order unless repository reality justifies a documented change.

```text
STEP 01
Read skills

STEP 02
Read Phase 1 documentation

STEP 03
Verify Phase 1

STEP 04
Inspect repository

STEP 05
Mark Phase 2 IN PROGRESS

STEP 06
Design provider-neutral model contracts

STEP 07
Implement model request/message types

STEP 08
Implement stream event types

STEP 09
Implement normalized errors

STEP 10
Implement provider registry

STEP 11
Implement model runtime

STEP 12
Implement streaming

STEP 13
Implement cancellation

STEP 14
Implement timeout

STEP 15
Implement retry policy

STEP 16
Implement finish reasons

STEP 17
Implement usage metadata

STEP 18
Implement latency metadata

STEP 19
Implement mock provider

STEP 20
Write runtime/mock tests

STEP 21
Implement OpenAI adapter

STEP 22
Write OpenAI adapter tests

STEP 23
Integrate server

STEP 24
Integrate client

STEP 25
Write server/client tests

STEP 26
Create end-to-end integration test

STEP 27
Create model streaming example

STEP 28
Run optional real-provider smoke test if configured

STEP 29
Review dependency boundaries

STEP 30
Review public APIs

STEP 31
Update Phase 2 documentation

STEP 32
Update global documentation

STEP 33
Run full validation

STEP 34
Self-review

STEP 35
Produce completion report

STEP 36
STOP
```

---

# 62. Phase 2 Acceptance Criteria

Phase 2 is COMPLETE only when all mandatory applicable requirements pass.

## Architecture

* [ ] Core has no provider SDK dependency.
* [ ] Provider-neutral model contract exists.
* [ ] Provider adapters are isolated.
* [ ] Provider registry exists.
* [ ] Runtime can resolve providers.
* [ ] Public core APIs do not expose provider SDK types.

## Streaming

* [ ] Model output streams incrementally.
* [ ] Streaming flows through existing protocol.
* [ ] First chunk reaches client before full completion.
* [ ] Stream errors are handled.
* [ ] disconnect cleans resources.

## Runtime

* [ ] cancellation works end-to-end.
* [ ] timeout works.
* [ ] retry works for retryable errors.
* [ ] non-retryable errors are not retried.
* [ ] terminal state is correct.
* [ ] invalid provider is handled.

## Metadata

* [ ] provider captured.
* [ ] model captured.
* [ ] finish reason normalized.
* [ ] usage normalized when available.
* [ ] missing usage is not fabricated.
* [ ] latency captured.
* [ ] retry attempts observable.

## Providers

* [ ] deterministic mock provider works.
* [ ] first real provider adapter works.
* [ ] real provider is not required for normal CI.
* [ ] provider credentials stay server-side.

## Testing

* [ ] model contract tests pass.
* [ ] provider registry tests pass.
* [ ] runtime tests pass.
* [ ] mock provider tests pass.
* [ ] OpenAI adapter tests pass.
* [ ] server tests pass.
* [ ] client tests pass.
* [ ] end-to-end streaming integration test passes.

## Quality

* [ ] lint passes.
* [ ] typecheck passes.
* [ ] tests pass.
* [ ] build passes.
* [ ] no secrets committed.
* [ ] dependency review complete.
* [ ] public API review complete.

## Documentation

* [ ] Phase_2_Docs updated.
* [ ] Phase_2_Architecture updated.
* [ ] Phase_2_Implementation updated.
* [ ] Phase_2_Status updated.
* [ ] Phase_2_Testing updated.
* [ ] Phase_2_Decisions updated.
* [ ] Phase_2_API updated.
* [ ] Phase_2_Files updated.
* [ ] Phase_2_Issues updated.
* [ ] Phase_2_Handoff updated.
* [ ] PROJECT_STATUS updated.
* [ ] ARCHITECTURE_OVERVIEW updated if required.
* [ ] CHANGELOG_PHASES updated.
* [ ] DECISIONS updated.
* [ ] TECHNICAL_DEBT updated if required.

## Phase Gate

* [ ] No React Copilot UI implemented.
* [ ] No tools implemented.
* [ ] No Generative UI implemented.
* [ ] No RAG implemented.
* [ ] No agents implemented.
* [ ] No Phase 3+ implementation.

---

# 63. Full Validation

Run the repository equivalents of:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run Phase 1 regression tests.

Run Phase 2 integration tests.

Run the mock streaming example.

If credentials exist, optionally run the real provider smoke test.

Record exact results in:

```text
Phase_2_Testing.md
```

Never claim PASS for a command that was not run successfully.

---

# 64. Self-Review

Before completion ask:

## Architecture

Did OpenAI leak into core?

Did provider-specific types leak into public contracts?

Can another provider be added without modifying core?

## Runtime

Can streams leak after cancellation?

Can events appear after terminal state?

Are timeouts actually aborting provider requests?

Are retries bounded?

Can cancellation accidentally trigger retries?

## Errors

Are raw provider errors safely normalized?

Are secrets excluded?

Are retryable classifications correct?

## Usage

Are missing token counts represented as missing rather than invented?

## Testing

Do tests cover mid-stream failure?

Cancellation?

Timeout?

Retry?

Non-retryable failure?

## Phase Gate

Did we accidentally implement tools because the provider supports them?

Did we add React?

Did we add agent logic?

Fix violations before reporting completion.

---

# 65. Required Completion Report

Produce:

```text
AI COPILOT SDK
PHASE 02 — LLM RUNTIME & STREAMING

STATUS
COMPLETE / INCOMPLETE

PHASE 1 REGRESSION

Lint:
PASS / FAIL

Typecheck:
PASS / FAIL

Tests:
PASS / FAIL

Build:
PASS / FAIL

IMPLEMENTED

Model Contracts:
- ...

Model Runtime:
- ...

Provider Registry:
- ...

Streaming:
- ...

Cancellation:
- ...

Timeout:
- ...

Retry:
- ...

Errors:
- ...

Usage:
- ...

Latency:
- ...

Mock Provider:
- ...

Real Provider:
- ...

Server Integration:
- ...

Client Integration:
- ...

Examples:
- ...

TEST RESULTS

Lint:
PASS / FAIL / NOT RUN

Typecheck:
PASS / FAIL / NOT RUN

Unit Tests:
PASS / FAIL / NOT RUN

Integration Tests:
PASS / FAIL / NOT RUN

Build:
PASS / FAIL / NOT RUN

Mock Provider Demo:
PASS / FAIL / NOT RUN

Real Provider Smoke Test:
PASS / FAIL / SKIPPED / NOT RUN

ARCHITECTURE VALIDATION

Provider-independent core:
PASS / FAIL

Provider SDK isolation:
PASS / FAIL

Streaming:
PASS / FAIL

Cancellation:
PASS / FAIL

Timeout:
PASS / FAIL

Retry:
PASS / FAIL

Error normalization:
PASS / FAIL

Usage normalization:
PASS / FAIL

No Phase 3+ implementation:
PASS / FAIL

DEPENDENCIES ADDED

- dependency:
  package:
  reason:

PUBLIC APIs ADDED

- ...

PROTOCOL CHANGES

- ...

ARCHITECTURE DECISIONS

- ...

FILES CREATED

- ...

FILES MODIFIED

- ...

COMMITS

- ...

ISSUES

- ...

TECHNICAL DEBT

- ...

DOCUMENTATION

Phase_2_Docs:
PASS / FAIL

Phase_2_Architecture:
PASS / FAIL

Phase_2_Implementation:
PASS / FAIL

Phase_2_Status:
PASS / FAIL

Phase_2_Testing:
PASS / FAIL

Phase_2_Decisions:
PASS / FAIL

Phase_2_API:
PASS / FAIL

Phase_2_Files:
PASS / FAIL

Phase_2_Issues:
PASS / FAIL

Phase_2_Handoff:
PASS / FAIL

REMAINING PHASE 2 WORK

None

or

- ...

NEXT PHASE

Phase 03 — React Copilot UI

STATUS
LOCKED / NOT STARTED

Waiting for explicit user instruction.
```

---

# 66. Final Stop Rule

After Phase 2 is implemented, tested, documented and the completion report has been produced:

STOP.

Do not start:

```text
Phase 03 — React Copilot UI
```

Do not create React SDK packages in preparation.

Do not create Copilot components.

Do not implement hooks.

Do not modify the roadmap to introduce another phase.

Wait for explicit user authorization.
