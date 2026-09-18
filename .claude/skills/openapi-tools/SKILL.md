---
name: openapi-tools
description: OpenAPI-to-tool architecture - discovery, naming, allowlists/denylists, and the rule that endpoints are never auto-exposed to the model wholesale. Load when generating tools from an OpenAPI spec.
---

# Purpose

Define how OpenAPI 3.1 specs are turned into safely-scoped tools, rather than exposing an
entire API surface to the model by default.

# When to Apply

Building or modifying OpenAPI-to-tool generation, endpoint discovery, or the configuration
surface for allowlisting/denylisting generated tools.

# Required Rules

- **Never automatically expose all API endpoints in a spec to the model.** Generation
  produces candidate tools; only endpoints explicitly allowlisted (by operationId, tag, or
  pattern) become active, callable tools.
- Each generated tool's name is derived from a stable identifier (`operationId`) — not from
  a path template that could change — and is namespaced per [[tool-system]] to avoid
  collisions with other tool sources.
- Request/response schemas from the OpenAPI spec are converted into Zod schemas used for
  the same validation pipeline every other tool uses (see [[tool-system]]); do not bypass
  validation because "the spec already defines the shape."
- Tool descriptions shown to the model are derived from the spec's `summary`/`description`
  fields but can be overridden per-endpoint where the raw spec text is unclear or exposes
  internal implementation detail that shouldn't reach the model.
- Authentication required by an endpoint (API key, OAuth, bearer token) is resolved from
  the server-side session/credentials — never by asking the model to supply or handle
  credentials directly.
- A denylist takes precedence over an allowlist match — an explicitly denied operation is
  never exposed even if it would otherwise match an allow pattern.
- Every generated tool still declares permission/side-effect metadata (per [[tool-system]])
  — mutating endpoints (`POST`/`PUT`/`PATCH`/`DELETE`) default to a stricter approval
  policy than `GET` unless explicitly overridden, per [[hitl]].
- Generated tools pass through [[action-firewall]] identically to hand-written tools — spec
  origin is not a bypass.
- Distinguish generated tools (produced at build/config time from a spec) from runtime
  tools (dynamically discovered) — runtime-discovered OpenAPI tools go through the same
  allowlist/validation gate before ever becoming callable, not after.

# Anti-Patterns

- Ingesting a spec and registering every operation as a tool with no allowlist.
- Letting the model supply an API key or auth header value as a tool argument.
- Skipping Zod validation for OpenAPI-derived tools because the spec "already validates."
- Treating a `DELETE` endpoint as `NONE` approval level by default.
- A denylisted operation still reachable because an allowlist pattern matches it elsewhere.

# Validation Checklist

- [ ] Only explicitly allowlisted operations become callable tools
- [ ] Every generated tool has a Zod schema derived from the spec and is validated like any other tool
- [ ] Auth is resolved server-side, never passed as a model-suppliable argument
- [ ] Mutating operations default to an appropriate [[hitl]] approval level
- [ ] Generated tools flow through [[action-firewall]] with no special-case bypass
