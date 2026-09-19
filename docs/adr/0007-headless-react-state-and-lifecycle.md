# 0007 — Headless React State and Lifecycle

## Status

Accepted (Phase 3).

## Context

React consumers need chat state and actions while the framework-independent client already
owns transport and cancellation. Custom interfaces must work without a visual dependency.
Putting token updates in a broad context would subscribe unrelated components to them.

## Decision

- Add `@gixcopilot/react` above client/protocol. Add `@gixcopilot/ui` above React. Neither
  imports server, Fastify, model runtime or provider adapters. Enforce both with Nx tags.
- A provider-scoped internal presentation store consumes `client.run().events`. A stable
  context supplies it; `useSyncExternalStore` hooks select snapshot, messages, status or
  thread. No Redux/Zustand dependency and no public store object.
- Keep protocol messages structurally compatible; add only a presentation `status` field.
  Forward protocol events and completion metadata through existing public contracts.
- One active run per provider. User submission is optimistic. `sendMessage` returns an
  acceptance boolean; asynchronous failures live in a discriminated snapshot, avoiding
  unhandled promises in event handlers.
- `stopped` is explicit. Stop invokes `ClientRun.cancel()`, invalidates the active token,
  and retains partial output. Events also check thread/run correlation and monotonic
  sequence. An incomplete stream becomes a transport error instead of false completion.
- Retry is explicit replay of the failed turn; regenerate replays a completed/stopped
  turn. Both remove that turn's previous response and reuse the original user message.
- Connection/model/thread configuration changes create a fresh local session. Cleanup
  cancels only this provider's run. Injected clients are never globally disposed.
- React peer range is `^19.0.0`; 19.3.0 is tested. ESM/NodeNext and project references remain.
  Empty initial render is SSR safe; no request starts in render or mount effects.

## Evidence and consequences

StrictMode tests observe one request per accepted send, one assistant message across
multiple deltas, isolated providers, cancellation on unmount/change and stale-event
protection. A 20-delta render-count test observes no extra host/action/status/thread
renders once status is streaming. This is a measured isolation property, not a throughput
benchmark. Message arrays and the active Markdown response still grow with conversation size.

No batching delay, persistent history, concurrent run queue, context engine or future
agent store is added. The internal presentation store can evolve without changing public
hook contracts. See [React's external store contract](https://react.dev/reference/react/useSyncExternalStore).
