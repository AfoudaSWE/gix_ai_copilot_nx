---
name: node-backend
description: Node.js server engineering standards for the Copilot server SDK - Fastify routes, services, DI, config, logging, streaming, graceful shutdown, and validation. Load when writing or reviewing server-side code.
---

# Purpose

Define server engineering standards for the Node.js/Fastify server package so it stays a
thin, well-structured transport layer over the framework-independent core runtime.

# When to Apply

Writing or reviewing routes, services, server configuration, logging, or server-side
streaming code.

# Required Rules

- Preferred stack: Node.js, TypeScript, Fastify, Zod. Do not introduce a second web
  framework or a second schema-validation library without a documented reason (see
  [[dependency-policy]]).
- Every route validates its input (params, query, body) with a Zod schema before touching
  business logic; validation failures return a structured error response, never an
  unhandled exception.
- Routes are thin: they parse/validate input, call a service, and shape the response.
  Business logic lives in services, not in route handlers.
- Dependency injection is explicit (constructor/factory injection or a documented DI
  container) — no reaching for globally mutated singletons from deep in the call stack.
- Configuration is loaded once at startup, validated with Zod, and typed; no direct
  `process.env` reads scattered through business logic.
- Logging is structured (JSON, one logger instance per request/correlation id) and never
  logs secrets, tokens, or raw PII — see [[security]].
- Errors are normalized to a consistent shape at the edge (see [[api-design]]) and
  distinguished by type (validation, auth, not-found, upstream/provider, internal).
- Streaming endpoints (SSE) flush incrementally, handle client disconnect by aborting
  upstream work, and are covered by the same cancellation contract as [[protocol-design]]
  and [[ai-runtime]].
- The server implements graceful shutdown: stop accepting new connections, let in-flight
  requests/streams drain or cancel cleanly, close DB/Redis connections, then exit.
- The server package must not embed a specific AI provider's SDK logic directly in a route
  or service — provider calls go through the [[ai-runtime]] abstraction.
- Every route/service is covered per [[testing]]; security-relevant routes go through the
  [[action-firewall]] pipeline, not ad hoc per-route auth checks.

# Anti-Patterns

- A route handler that calls the OpenAI SDK directly instead of going through the runtime
  abstraction.
- Reading `process.env.SOME_KEY` inline inside a service function.
- Swallowing an error and returning `200 OK` with an empty body.
- An SSE handler that keeps running provider work after the client has disconnected.
- Logging the full request body (which may contain PII or secrets) at info level.

# Validation Checklist

- [ ] Every route validates input with Zod before calling business logic
- [ ] No provider SDK is called directly from a route/service outside [[ai-runtime]]
- [ ] Config is loaded/validated once at startup, not read ad hoc from `process.env`
- [ ] Streaming endpoints handle client disconnect and cancellation correctly
- [ ] Graceful shutdown closes connections and drains in-flight work
- [ ] No secret, token, or raw PII appears in logs
