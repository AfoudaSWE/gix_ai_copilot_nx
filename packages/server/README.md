# @aicopilot/server

## Purpose

Fastify HTTP/SSE transport adapter. Adapts `@aicopilot/core`'s runtime to an HTTP
boundary — request validation, run creation, streaming, cancellation, and error mapping —
with no AI/business logic of its own.

## Responsibilities

- `createServer({ runtime })` — builds (does not start) a Fastify instance exposing:
  - `GET  /health`
  - `POST /runs` — validates the body, creates a run via the injected `Runtime`, and
    streams its events back as Server-Sent Events on the same response.
  - `POST /runs/:runId/cancel` — cancels an in-flight run by id via an in-memory registry.
- Maps validation failures to a `400` with a `PublicCopilotError` body; maps an unknown
  `runId` to a `404`; maps any unexpected error to a `500` without leaking internal detail.
- Cancels the underlying run automatically if the client disconnects mid-stream.
- Cancels every in-flight run when the server is closed (graceful shutdown).

## Public API

See `src/index.ts`. No deep imports into `src/` are supported.

## Dependencies

- `@aicopilot/protocol`, `@aicopilot/core` — the only workspace dependencies, matching
  `server → core`, `server → protocol` in `docs/architecture/overview.md`.
- `fastify` — the HTTP framework.
- `zod` — request validation.

## Non-responsibilities

- **No embedded executor/AI logic.** The `Runtime` (and therefore the `Executor` backing
  it) is always injected by the caller — see the node-backend skill's dependency-injection
  rule. This package has no opinion on what a run actually does.
- **No persistence.** The run registry is in-memory and process-local; it does not survive
  a restart and does not coordinate across multiple server instances. A production
  deployment needing that is out of scope for Phase 1.
- **No auth/RBAC/ABAC/Action Firewall.** Phase 7 owns enterprise security; this server
  currently trusts any caller that can reach it.
- **No WebSocket transport.** SSE only for Phase 1 — see
  `docs/adr/0004-sse-as-initial-streaming-transport.md`.

## Basic Usage

```ts
import { createServer } from '@aicopilot/server';
import { createRuntime, createEchoExecutor } from '@aicopilot/core';

const app = createServer({ runtime: createRuntime({ executor: createEchoExecutor() }) });
await app.listen({ port: 0 });
```
