# @gixcopilot/client

> **Status:** Stable. See [stability levels](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/VERSIONING.md#stability-levels).

## Purpose

## Install

```bash
npm install @gixcopilot/client
```

Requires Node.js >=22.12.0. ESM only.

Framework-independent, browser/Node-portable streaming client for the AI Copilot SDK.
No React or Angular dependency — see `react-sdk` / `angular-sdk` skills for how those wrap
this package rather than reimplementing it.

## Responsibilities

- `createCopilotClient({ baseUrl })` — the public entry point. `run()` returns a
  `ClientRun` exposing a single-use `events: AsyncIterable<CopilotEvent>` and a `cancel()`.
- `CopilotTransport` — the seam between the public API and the wire. `createSseTransport`
  is the only implementation in Phase 1.
- `createSseTransport` — POSTs to `<baseUrl>/runs`, parses the SSE response body into
  typed, validated `CopilotEvent`s (via `@gixcopilot/protocol`'s `parseEvent`), and exposes
  `cancel(runId)` for out-of-band cancellation against `POST /runs/:runId/cancel`.

## Public API

See `src/index.ts`. No deep imports into `src/` are supported.

## Dependencies

- `@gixcopilot/protocol` — the only workspace dependency, matching `client → protocol` in
  `docs/architecture/overview.md`. This package does **not** depend on `@gixcopilot/server`.
- Uses the platform's global `fetch` and Web Streams API (`ReadableStream`) — no HTTP
  client library dependency, keeping this package minimal and portable to both Node and
  the browser.

## Non-responsibilities

- **No WebSocket transport.** SSE only for Phase 1 — see
  `docs/adr/0004-sse-as-initial-streaming-transport.md`. `CopilotTransport` is designed so
  a future WebSocket implementation is additive, not a rewrite.
- **No out-of-band cancellation of another client's run by id** is exposed on
  `CopilotClient` itself — `run.cancel()` covers the common case (aborting your own
  in-flight request); call the server's `POST /runs/:runId/cancel` directly (or
  `createSseTransport(...).cancel(runId)`) for the cross-client case.
- **No React/Angular state management.** This client has no framework hooks; see
  `react-sdk` / `angular-sdk`.
- **No retry logic.** A failed request surfaces as a thrown `CopilotError`; retries against
  a flaky model happen server-side in `@gixcopilot/provider`'s `ModelRuntime`.
- **No dependency on `@gixcopilot/provider`.** `RunOptions.model` is a plain, locally-defined
  `{ provider, model }` shape (`ClientModelReference`) passed through opaquely on the wire —
  this client works the same whether or not the server it's talking to has any model
  support configured at all.

## Basic Usage

```ts
import { createCopilotClient } from '@gixcopilot/client';

const client = createCopilotClient({ baseUrl: 'http://localhost:3000' });

// Phase 1 style - runs against the server's default executor:
const run = client.run({
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello protocol' }] }],
});

// Phase 2 style - names a model, routed through the server's ModelRuntime:
const modelRun = client.run({
  model: { provider: 'openai', model: 'gpt-4o-mini' },
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
});

for await (const event of run.events) {
  console.log(event.type);
}
```

## Documentation

- [getting-started guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/client)

## License

MIT
