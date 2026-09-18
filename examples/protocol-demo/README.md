# protocol-demo

The Phase 1 end-to-end demonstration of the AI Copilot SDK's foundation:

```text
Client -> HTTP request -> Server -> Core -> Typed protocol events -> SSE stream -> Client
```

**No LLM is involved.** The server is wired to `@aicopilot/core`'s deterministic
`createEchoExecutor()`, which exists solely to prove the architecture — it echoes its input
back as a sequence of word/whitespace chunks.

## Run it

```sh
pnpm --filter @aicopilot/protocol-demo run demo
# or, from the repo root:
pnpm demo
```

Optionally pass a custom message:

```sh
pnpm --filter @aicopilot/protocol-demo run demo -- "Some other input"
```

Expected output (timestamps/ids vary):

```text
AI Copilot SDK - Phase 1 protocol demo
Server listening at http://127.0.0.1:5xxxx
Sending: "Hello protocol"

[1] run.started
[2] message.started (assistant)
[3] message.delta "Hello"
[4] message.delta " "
[5] message.delta "protocol"
[6] message.end -> "Hello protocol"
[7] run.completed (usage: {"inputTokens":0,"outputTokens":0,"totalTokens":0})
```

Press Ctrl+C while it's streaming to see cancellation (`run.cancelled` instead of
`run.completed`).

## What this proves

- The protocol (`@aicopilot/protocol`) is transport-independent and validates on both ends.
- The core runtime (`@aicopilot/core`) drives a real run lifecycle and event sequencing
  without any AI provider.
- The server (`@aicopilot/server`) correctly adapts that runtime to HTTP + SSE.
- The client (`@aicopilot/client`) correctly parses the SSE stream back into typed,
  validated events.
- `src/integration.spec.ts` runs this same round trip (plus cancellation, both
  client-initiated and out-of-band via the server's cancel endpoint) as an automated test
  against a real, in-process listening server — no mocks, no external AI service.

## Non-responsibilities

This example is a proof of the Phase 1 architecture only — it is not the Phase 3 React
Copilot UI, and its "AI" is a fixed, deterministic word-echo, not a language model.
