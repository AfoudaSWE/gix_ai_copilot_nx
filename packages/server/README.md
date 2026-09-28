# @gixcopilot/server

> **Status:** Stable. See [stability levels](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/VERSIONING.md#stability-levels).

## Purpose

## Install

```bash
npm install @gixcopilot/server
```

Requires Node.js >=22.12.0. ESM only.

Fastify HTTP/SSE transport adapter. Adapts `@gixcopilot/core`'s runtime to an HTTP
boundary — request validation, run creation, streaming, cancellation, and error mapping —
with no AI/business logic of its own.

## Responsibilities

- `createServer({ runtime, modelRuntime? })` — builds (does not start) a Fastify instance
  exposing:
  - `GET  /health`
  - `POST /runs` — validates the body (now `{ threadId?, model?, messages }`). A request
    with no `model` runs against the injected `runtime` (Phase 1 behavior, e.g. the echo
    executor); a request naming a `model` routes through the injected `modelRuntime` (via
    `@gixcopilot/provider`'s `createModelExecutor`) instead — see Phase 2. Streams events
    back as Server-Sent Events on the same response either way.
  - `POST /runs/:runId/cancel` — cancels an in-flight run by id via an in-memory registry.
- Maps validation failures to a `400` with a `PublicCopilotError` body (including a
  model-naming request when no `modelRuntime` is configured); maps an unknown `runId` to a
  `404`; maps any unexpected error to a `500` without leaking internal detail.
- Cancels the underlying run automatically if the client disconnects mid-stream.
- Cancels every in-flight run when the server is closed (graceful shutdown).

## Public API

See `src/index.ts`. No deep imports into `src/` are supported.

## Dependencies

- `@gixcopilot/protocol`, `@gixcopilot/core`, `@gixcopilot/provider` — matching
  `server → core`, `server → protocol`, `server → provider` in
  `docs/architecture/overview.md`. Notably **not** any concrete provider adapter
  (`@gixcopilot/provider-openai`, `@gixcopilot/provider-mock`) — the caller constructing the
  server decides which providers exist; this package only knows the provider-neutral
  `ModelRuntime` contract.
- `fastify` — the HTTP framework.
- `zod` — request validation.

## Non-responsibilities

- **No embedded executor/AI logic, and no embedded provider.** Both the default `Runtime`
  and the optional `ModelRuntime` are always injected by the caller — see the node-backend
  skill's dependency-injection rule. This package has no opinion on what a run actually
  does or which providers exist.
- **No persistence.** The run registry is in-memory and process-local; it does not survive
  a restart and does not coordinate across multiple server instances.
- **No auth/RBAC/ABAC/Action Firewall.** Phase 7 owns enterprise security; this server
  currently trusts any caller that can reach it.
- **No WebSocket transport.** SSE only — see
  `docs/adr/0004-sse-as-initial-streaming-transport.md`.
- **No retry/timeout policy of its own.** Those live in `@gixcopilot/provider`'s
  `ModelRuntime`, configured by whoever constructs it.

## Basic Usage

```ts
import { createServer } from '@gixcopilot/server';
import { createRuntime, createEchoExecutor } from '@gixcopilot/core';
import { createModelRuntime } from '@gixcopilot/provider';
import { createMockProvider } from '@gixcopilot/provider-mock';

const app = createServer({
  runtime: createRuntime({ executor: createEchoExecutor() }),
  modelRuntime: createModelRuntime({ providers: [createMockProvider()] }),
});
await app.listen({ port: 0 });
```

## Documentation

- [node guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/node.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/server)

## License

MIT
