# Phase 1 Testing

Commands run at Phase 1 completion (reconstructed from the session's actual output, not
re-run after the fact — see the note in `Phase_1_Docs.md`):

```sh
npx nx reset
npx nx run-many -t lint,typecheck,test,build
```

Result: **`NX Successfully ran targets lint, typecheck, test, build for 5 projects`**
(`protocol`, `core`, `client`, `server`, `protocol-demo`).

## Per-Project Test Counts (all passing)

| Project         | Tests | Notes                                                                                                                                                    |
| --------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protocol`      | 16    | event parsing/serialization, malformed input, unknown event types, protocol version                                                                      |
| `core`          | 26    | lifecycle transitions (incl. the three explicit examples from the spec), cancellation (before/during/after, idempotent, hung executor), executor failure |
| `server`        | 10    | health, SSE happy path, validation errors, unknown-id cancel                                                                                             |
| `client`        | 13    | streaming, cancellation, external `AbortSignal`, error normalization, SSE frame parsing                                                                  |
| `protocol-demo` | 4     | full round trip, client-side cancel, out-of-band cancel, unknown-id 404                                                                                  |

**Total: 69 tests passing, 0 failing.**

## Mandatory End-to-End Integration Test

`examples/protocol-demo/src/integration.spec.ts` — a real `createCopilotClient`, over real
HTTP (an actual listening Fastify server, not `.inject()`), to a real (in-process)
`@gixcopilot/server`, driving `@gixcopilot/core`'s real runtime with the deterministic echo
executor, streamed back as real Server-Sent Events, parsed back into typed events by the
real client transport. No mocks of the project's own code, no external AI service.

## Manual CLI Verification

```sh
node examples/protocol-demo/dist/main.js
```

Produced:

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

Also run with a custom argv message and with Ctrl+C mid-stream to confirm `run.cancelled`
replaces `run.completed` — both matched expectations.

## Module Boundary Verification (manual)

A deliberate `protocol -> core` import was introduced, confirmed rejected by
`@nx/enforce-module-boundaries` (reported as both a tag-constraint violation and a
circular-dependency violation, since `core` already depends on `protocol`), then reverted
before committing.

## Dependency/Secret Review

- Grepped for hardcoded API-key-shaped strings: none found (Phase 1 has no provider
  credentials to leak in the first place).
- Confirmed no package outside its own boundary imports another package's internals — each
  package's `exports` field exposes only `.`.
