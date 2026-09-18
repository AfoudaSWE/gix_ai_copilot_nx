---
name: api-design
description: API conventions - REST resource naming, versioning, request IDs, error shapes, validation, pagination, idempotency, OpenAPI, streaming endpoints, and status codes. Load when designing any HTTP API surface.
---

# Purpose

Define consistent conventions for the SDK's own HTTP API surface, distinct from the
Copilot protocol's internal event model ([[protocol-design]]) but consistent with it at the
transport boundary.

# When to Apply

Designing or reviewing a REST endpoint, request/response shape, streaming endpoint, or
API versioning change.

# Required Rules

- Resources are named as plural nouns (`/threads`, `/runs`, `/tools`); actions that don't
  map cleanly to CRUD are modeled as a sub-resource or explicit verb endpoint
  (`/runs/:id/cancel`), not overloaded onto an existing verb.
- The API is versioned explicitly (e.g. a path or header version) from the start; a
  breaking response-shape change requires a new version, per [[backward-compatibility]].
- Every request is assigned or accepts a request id, propagated into logs/traces per
  [[observability]] for correlation.
- Error responses use one consistent shape across all endpoints (e.g. `{ error: { code,
  message, details } }`) — never a mix of bare strings, HTTP status alone, and structured
  bodies across different endpoints.
- Request bodies/params/query are validated with Zod at the boundary (see [[node-backend]])
  before reaching business logic; validation errors return 400 with field-level detail.
- List endpoints are paginated by default (cursor-based preferred for streaming-friendly,
  consistent ordering) — an unbounded list endpoint that can return an unbounded result set
  is not acceptable.
- Mutating endpoints that may be retried by a client accept an idempotency key so a retried
  request does not double-apply the operation.
- The API surface is described in an OpenAPI 3.1 document kept in sync with the actual
  implementation — not a stale, hand-maintained spec that drifts from reality.
- Streaming endpoints (SSE) are documented distinctly from regular JSON endpoints,
  including their event shapes, and follow [[protocol-design]]'s cancellation/reconnect
  rules.
- HTTP status codes are used correctly and consistently: 2xx for success, 4xx for client
  error (validation, auth, not-found), 5xx reserved for actual server/upstream failures —
  never 200 with an error payload.

# Anti-Patterns

- Returning `200 OK` with `{ success: false, error: "..." }` in the body.
- An unpaginated `/threads` endpoint that returns every thread in the system.
- A mutating endpoint with no idempotency key that double-charges/double-creates on retry.
- Three different error response shapes across three different route files.
- An OpenAPI spec that hasn't been regenerated/updated after an endpoint changed shape.

# Validation Checklist

- [ ] New/changed endpoint uses the standard error shape and correct status codes
- [ ] List endpoints are paginated
- [ ] Mutating, retryable endpoints accept an idempotency key
- [ ] Request/response validated with Zod at the boundary
- [ ] OpenAPI spec updated to match the actual endpoint behavior
