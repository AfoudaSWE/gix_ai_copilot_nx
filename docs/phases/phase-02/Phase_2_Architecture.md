# Phase 2 Architecture

See `docs/architecture/overview.md` for the full, current (Phase 1 + 2) architecture
document, including the request flow, package responsibility table, and dependency
diagram. This file reproduces the two diagrams Phase 2's Section 56 specifically requires.

## Layer Diagram

```text
Client
  |
Server
  |
Core
  |
Model Runtime            <- @aicopilot/provider's createModelRuntime
  |
Provider Registry        <- @aicopilot/provider's createModelProviderRegistry
  |
ModelProvider             <- the interface; @aicopilot/provider-mock / @aicopilot/provider-openai implement it
  |
Provider Adapter         <- the concrete implementation (mock, OpenAI)
  |
LLM                      <- only for the OpenAI adapter; the mock adapter has none
```

Dependency direction runs the _opposite_ way from this call-flow diagram: `Provider Adapter
-> ModelProvider (interface, defined in @aicopilot/provider) -> @aicopilot/provider ->
@aicopilot/core -> @aicopilot/protocol`. Core never depends downward into the model layer —
see `docs/adr/0006-model-provider-abstraction.md`.

## Streaming Pipeline

```text
LLM
 |
 |  raw provider chunk (e.g. an OpenAI ChatCompletionChunk)
 v
Provider Adapter
 |
 |  normalizes to ModelStreamEvent: content.delta / usage.updated / model.completed / model.failed
 v
Model Runtime
 |
 |  passes content.delta/usage.updated through; classifies model.failed for retry;
 |  turns a terminal model.completed/model.failed into the attempt's final event
 v
createModelExecutor (the Executor bridge)
 |
 |  content.delta -> plain string yield; model.completed -> ExecutorCompletion (usage, finishReason)
 v
Core (@aicopilot/core's createRuntime)
 |
 |  translates into CopilotEvent: message.delta*, run.completed { usage, finishReason }
 v
Server
 |
 |  serializes each CopilotEvent as one SSE frame
 v
Client
 |
 |  parses the SSE stream back into typed, validated CopilotEvents (unchanged from Phase 1)
```

No stage buffers the entire response before forwarding it — a `content.delta` reaches the
client as soon as the provider adapter produces it (see the mock provider's per-chunk
`delayMsPerChunk` and the OpenAI adapter's chunk-by-chunk `for await` loop, neither of which
accumulate output before yielding).

## Dependency Direction (restated from `docs/architecture/overview.md`)

```text
                         @aicopilot/protocol
                         ^   ^    ^      ^
   @aicopilot/client ----+   |    |      +---- @aicopilot/provider
                             |    |                ^        ^
                     @aicopilot/core                |        |
                             ^                       |        |
                       @aicopilot/server -------------+        |
                                                                 |
                                        @aicopilot/provider-mock, @aicopilot/provider-openai
```
