# Phase 8 decisions

[ADR 0013](../../adr/0013-openapi-mcp-integration-architecture.md) owns the external-adapter architecture. The completion review clarified its security defaults:

1. OpenAPI method defaults classify explicitly selected operations; they do not activate a whole specification. Both sources require deliberate exposure configuration.
2. Generated definitions are canonical. The server refuses external execution without the existing Action Firewall; no duplicate approval engine was introduced.
3. Unsupported JSON Schema/serialization features produce diagnostics. `allOf` uses intersections rather than overwriting earlier properties. Responses with declared JSON schemas are validated.
4. HTTP destinations are trusted configuration, redirects are refused, request headers from credentials win, error payloads remain private, and response bytes are bounded.
5. MCP uses official SDK 1.30.0 behind plain public types. Lifecycle state subscriptions remove stale tools; failed handshakes close their transport.
6. Refresh is serialized and disposal is terminal. No scheduler or automatic reconnection loop is introduced.
7. Source audit metadata and telemetry are additive. No protocol event changes or browser bundle dependencies are required.
8. Test providers remain deterministic. The CLI uses only the configured real OpenAI provider; live smoke tests require explicit opt-in.

Standards consulted: [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0.html), [MCP security guidance](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices), and the installed MCP client/transport declarations. The implementation documents its supported subset rather than claiming complete standards conformance.
