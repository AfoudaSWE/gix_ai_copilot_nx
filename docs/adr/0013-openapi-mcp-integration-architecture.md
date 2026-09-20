# ADR 0013: Governed OpenAPI and MCP integrations

Status: accepted for Phase 8; security defaults clarified during completion review.

## Context

Existing enterprise APIs and MCP servers must become AI capabilities without a parallel tool, authorization or approval architecture. Specifications and remote descriptions describe interfaces, not trusted permissions.

## Decision

`@gixcopilot/openapi` and `@gixcopilot/mcp` produce the canonical `ToolDefinition` from `@gixcopilot/tools`. Inspection is registry-agnostic; registration owns only its tool slots, rejects conflicts, reconciles refresh and removes stale tools. A separate minimal `@gixcopilot/integrations` catalog records host-managed health and capabilities, not execution.

OpenAPI operation IDs determine names, with deterministic method/path fallback and optional namespace. Generation requires an explicit include list or operation configuration. Excludes and `expose: false` win. Method defaults classify selected operations: GET read candidate, writes approval candidate, DELETE denied unless explicitly opted in. Security manifests use explicit overrides or integration-scoped permissions. Phase 7 owns final RBAC/ABAC, risk, approval, reauthorization and data policy. Server execution rejects external tools when no firewall is configured.

OpenAPI supports structural 3.0/3.1 validation and a documented JSON Schema subset. Unsupported constructs produce diagnostics; no silent approximation of dangerous constraints. Shared Zod conversion validates input and declared JSON response schemas. Credentials resolve server-side from trusted context. HTTP execution pins the destination to configured base URL, escapes parameters, rejects dot traversal and redirects, bounds responses and omits sensitive upstream errors.

The official MCP SDK 1.30.0 supplies stdio and Streamable HTTP transports behind project-owned public contracts. Remote tools are denied by default, namespaced by server, and registered only after policy/schema mapping. Client lifecycle subscriptions invalidate stale tools. Initialization failures close transports; requests have finite timeouts and cancellation signals. Resources/prompts are host-requested untrusted data, never policy or automatic system instructions.

Shared helpers live in tools: schema conversion, name sanitation, credential handling, source audit extraction and telemetry. `toToolNameSegment` moved from a private generative-ui module. Server/security gain additive audit context; no protocol event changes or provider changes.

## Alternatives and consequences

- A second integration execution pipeline would duplicate approval and policy enforcement; rejected.
- Exposing every endpoint with method-only defaults would make API additions silently callable; rejected in favor of explicit selection.
- A bespoke MCP protocol implementation would duplicate SDK transport/security behavior; rejected. Installed SDK types remain internal.
- A full OpenAPI/JSON Schema engine was not added. This implementation deliberately skips unsupported constructs and documents limits, trading coverage for inspectable behavior.
- Registry, health, refresh and demo state remain process-local. Refresh is serialized, disposal terminal, and reconnect occurs only on requested refresh with bounded attempts.
- Host code remains trusted: direct executor calls, custom adapters, URL configuration, credential scope and data policy are host responsibilities. Model calls use the canonical server path.

Evidence: [Phase 8 testing](../phases/phase-08/Phase_8_Testing.md), [API](../phases/phase-08/Phase_8_API.md), [limitations](../phases/phase-08/Phase_8_Issues.md).
