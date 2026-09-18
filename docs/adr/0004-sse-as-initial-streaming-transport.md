# 0004 — SSE as the Initial Streaming Transport, Combined with Run Creation

## Status

Accepted (Phase 1).

## Context

Phase 1 needs exactly one working streaming transport end to end (Section 3/22/23 of the
Phase 1 spec). Two related questions had to be settled: (1) which transport, and (2)
whether creating a run and subscribing to its events are one HTTP exchange or two.

## Decision

- **Server-Sent Events (SSE) over HTTP**, not WebSocket. `POST /runs` responds with
  `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`,
  and writes one SSE frame per `CopilotEvent` (`id:`, `event:`, `data:` lines, blank-line
  terminated).
- **Run creation and event streaming are the same request/response**, not a
  create-then-subscribe pair (`POST /runs` → get a `runId` → separately `GET
/runs/:runId/events`). The client's `POST /runs` call _is_ the stream.
- A **separate `POST /runs/:runId/cancel` endpoint** still exists for out-of-band
  cancellation (e.g., a different client, or a supervisory process) — cancellation is not
  folded into the same request in every case, because the entity initiating a cancel isn't
  always the one holding the streaming connection open.
- Client-side cancellation of _your own_ run is just aborting your own HTTP request
  (`AbortController` passed to `fetch`); the server detects this via the **response**
  stream's `close` event (see the note below) and cancels the underlying core run.
- The server tracks in-flight runs in a process-local, in-memory `RunRegistry` so the
  cancel endpoint can find a run created by an earlier, still-streaming request.

## A Bug Found and Fixed During Phase 1 Validation

The first implementation listened for client disconnect on `request.raw` (the incoming
request stream). This was wrong and caused **every** run to be cancelled almost
immediately: Node's `IncomingMessage` emits `close` once the (tiny) request body has been
fully read — which happens before the handler even starts streaming the response — not
only on a genuine client disconnect. The fix was to listen on `reply.raw` (the outgoing
response stream) instead, guarded by `!reply.raw.writableEnded` to distinguish "the
connection died before we finished" from "we already finished and this is just the
connection's own normal teardown." This is recorded here because it's exactly the kind of
transport-layer mistake future phases (WebSocket, reconnect) need to watch for again.

## Consequences

- No reconnect-after-drop support exists yet: if the SSE connection is interrupted, the
  client sees the stream end and must start a new run — it cannot resume the old one using
  `Last-Event-ID` today, even though the protocol's `sequence` field (ADR 0003) is designed
  to make that possible later.
- The `CopilotTransport` interface in `@aicopilot/client` is deliberately not SSE-specific,
  so adding a WebSocket implementation later is additive (a new class implementing the
  same interface), not a rewrite of the client's public API.
- A multi-instance server deployment cannot route a cancel request to whichever instance
  actually holds the run (the registry is process-local) — out of scope for Phase 1, noted
  as a known limitation in `docs/architecture/overview.md`.

## Alternatives Considered

- **WebSocket** for Phase 1. Rejected: the phase spec explicitly defers it ("Do NOT
  implement WebSocket transport. WebSocket is future work"), and SSE is simpler for a
  one-directional (server → client) event stream, which is all Phase 1 needs.
- **Separate create-then-subscribe endpoints.** Considered for symmetry with a future
  reconnect story, but rejected for Phase 1 as unnecessary complexity: it would require a
  buffering/backpressure story for events produced between "create" and "subscribe"
  arriving, which the phase spec explicitly says isn't needed yet ("Phase 1 does not need
  complex distributed reconciliation").
