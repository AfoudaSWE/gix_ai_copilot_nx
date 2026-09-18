# 0003 — Event-Driven Protocol

## Status

Accepted (Phase 1).

## Context

The protocol needs to support streaming, be transport-independent (HTTP+SSE today,
possibly WebSocket later), and stay forward-compatible as later phases add new event
types (tool calls, approvals, generative UI) — see the `protocol-design` skill. Phase 1
must decide the concrete shape now, since every other package depends on it.

## Decision

- The protocol is a **discriminated union of events** (`CopilotEvent`), not a request/
  response RPC shape. Every event shares a `CopilotEventBase` (`id`, `runId`, `threadId`,
  `sequence`, `timestamp`, `protocolVersion`) plus a `type` discriminator.
- **Naming convention** (see `packages/protocol/src/events.ts`): TypeScript interface names
  are PascalCase matching the Phase 1 spec's required list exactly (`RunStartedEvent`,
  `MessageStartEvent`, `MessageEndEvent`, `ErrorEvent`, ...); the wire-level `type` field is
  a lowercase `noun.verb` string (`run.started`, `message.end`, `error`). These two naming
  layers are allowed to differ (interface name vs. wire string) since they serve different
  audiences (TypeScript authors vs. wire consumers in any language).
- **Ordering**: `@aicopilot/core`'s `EventSequencer` assigns a 1-based, strictly increasing
  `sequence` number per run; consumers never assign their own. This is sufficient for
  Phase 1 (single in-process producer per run); a distributed producer/reconciliation
  scheme is explicitly out of scope.
- **Versioning**: `PROTOCOL_VERSION` (currently `"1"`) is centralized in one file
  (`version.ts`) and is validated as a required, exact-match literal (`z.literal`) on every
  event's base envelope. A mismatched version is treated as an **invalid** event (a real,
  actionable error), not silently ignored — Phase 1 has no version-negotiation scheme, so a
  version mismatch means "this client/server pair genuinely cannot talk to each other,"
  which should surface clearly rather than being masked.
- **Unknown event types** (a `type` string the running build doesn't recognize) are
  distinguished from **invalid events** (a broken/malformed payload): `parseEvent` returns
  a three-way discriminated `ParsedEvent` (`known` / `unknown` / `invalid`). An `unknown`
  event still has its base envelope validated and is safe to ignore — this is how a future
  server can add new event types without breaking an older client. An event whose `type` is
  recognized but whose type-specific payload fails validation is always `invalid`, never
  silently downgraded to `unknown`.
- **Errors** are a first-class part of the protocol via `PublicCopilotError` (embedded in
  `run.failed` and `error` events), not just an HTTP status code — see ADR 0004 for how
  this interacts with the transport.

## Consequences

- Adding a new event type in a later phase (e.g. `tool.called` in Phase 5) is additive:
  older clients treat it as `unknown` and ignore it safely, per this ADR's forward-
  compatibility rule — no coordinated upgrade is required.
- Any future breaking change to an _existing_ event's shape (removing/renaming a required
  field) is a `PROTOCOL_VERSION` bump, per the backward-compatibility skill, and this
  repository has deliberately not built a negotiation mechanism to soften that — a version
  bump is meant to be a real, visible event, not something papered over silently.
- Reconnect/resume support (using `sequence` to detect gaps after a dropped SSE connection)
  is possible with this design but is not implemented in Phase 1; the current server/client
  pair does not attempt to reconnect a torn-down stream.

## Alternatives Considered

- **Request/response RPC per operation** (e.g. a single `POST /messages` returning one
  JSON body). Rejected: cannot represent incremental streaming, which is a hard
  requirement (see Phase 1 objective).
- **A single flat event type with an `any`-typed payload field**, dispatched by a separate
  `kind` enum read out of the payload. Rejected: defeats TypeScript's discriminated-union
  exhaustiveness checking (`typescript-standards` skill) and pushes validation into every
  consumer instead of centralizing it in `parseEvent`.
- **Silently coercing an unrecognized event to a no-op with no distinction from a malformed
  one.** Rejected: conflates "this is fine, just newer than me" with "this is broken,"
  which would hide real bugs.
