---
name: protocol-design
description: Principles for the Copilot's own wire protocol - Message, Thread, Run, Event, ToolCall, ToolResult, State, Context, Approval, Usage, Error. Load when designing protocol types, event shapes, or transport-level contracts.
---

# Purpose

Define the design principles for the SDK's own protocol — the contract between client and
server that is transport-independent and versioned, per [[project-architecture]]'s layering.
This skill defines principles only; it does not implement the protocol.

# When to Apply

Designing or reviewing protocol-level types or event contracts: `Message`, `Thread`, `Run`,
`Event`, `ToolCall`, `ToolResult`, `State`, `Context`, `Approval`, `Usage`, `Error`.

# Required Rules

- The protocol is transport-independent: the same message/event shapes must work over
  HTTP+SSE, WebSocket, or in-process, with no transport-specific field leaking into the
  protocol schema itself.
- Every protocol entity carries a stable, explicit `id` and every event carries a
  correlation id linking it back to the `Run`/`Thread`/`ToolCall` it belongs to.
- Events are the primary unit of streaming communication; design them as an append-only,
  ordered log per run, each event immutable once emitted.
- Protocol messages are versioned explicitly (e.g. a `version` field or a versioned schema
  namespace) so old clients and new servers (or vice versa) can detect a mismatch instead
  of silently misinterpreting a payload.
- Idempotency: operations that may be retried (tool result submission, run resumption)
  must be safe to receive twice, keyed by a stable id.
- Cancellation and reconnect are first-class: a client must be able to cancel a `Run` and
  must be able to reconnect to an in-progress stream and resume from a known event
  position without losing or duplicating events.
- Errors are a typed part of the protocol (`Error` as a first-class entity/event), not an
  out-of-band HTTP status code alone — the client must be able to distinguish a protocol
  error, a tool error, and a model-provider error.
- Approval is modeled explicitly in the protocol (see [[hitl]]) as its own entity/state, not
  bolted onto `ToolCall` as an ad hoc flag.
- Usage (tokens, cost, latency) is modeled as first-class protocol data attached to `Run`
  and provider calls, not left to out-of-band logging only.
- Schema changes are additive by default; removing or repurposing a field is a breaking
  protocol change and follows [[backward-compatibility]].

# Architecture / Patterns

Core entities and their relationships:

```text
Thread ── has many ──► Run ── emits ──► Event (ordered, append-only)
Run ── may contain ──► ToolCall ──► ToolResult
Run ── carries ──► State, Context snapshot, Usage
ToolCall (consequential) ── may require ──► Approval
Any layer ── may emit ──► Error (typed, correlated)
```

Events should be designed so a client that only understands a subset of event types can
still safely ignore unknown ones (forward compatibility) rather than crashing.

# Anti-Patterns

- Embedding an HTTP-specific concept (e.g. a status code) as the sole error signal inside
  the protocol schema.
- A `ToolCall` type with an untyped `approved: boolean` bolted on instead of a proper
  `Approval` entity.
- Events that mutate in place after being emitted, breaking replay/audit guarantees.
- Silently renaming or repurposing an existing field instead of versioning the change.
- Designing a reconnect flow that re-delivers the entire event history with no way to
  resume from a position.

# Validation Checklist

- [ ] New protocol types are transport-independent
- [ ] Every event has a stable id and correlation id
- [ ] Cancellation and reconnect/resume are addressed for any new streaming flow
- [ ] Errors are modeled as typed protocol data, not left to transport status codes alone
- [ ] Schema change is additive, or explicitly reviewed as a breaking change
