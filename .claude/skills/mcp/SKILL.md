---
name: mcp
description: MCP integration architecture - client connections, tool/resource/prompt discovery, schema mapping, connection lifecycle, and the rule that MCP tools never bypass the normal security pipeline. Load when integrating an MCP client or server connection.
---

# Purpose

Define how the SDK integrates with MCP servers as a peer integration alongside OpenAPI,
without letting MCP-sourced tools sidestep the security pipeline.

# When to Apply

Implementing the MCP client, connecting to MCP servers, mapping MCP tools/resources/prompts
into the SDK's own tool/context model, or handling MCP connection failures.

# Required Rules

- **MCP tools must not bypass the normal security pipeline.** Every tool discovered via
  MCP is registered through the same [[tool-system]] registry and executes through
  [[action-firewall]] identically to a hand-written or OpenAPI-derived tool.
- MCP tool schemas are mapped into the same Zod-validated tool input/output shape used
  elsewhere — arguments are validated before execution, not trusted because they conform to
  the MCP server's own schema.
- MCP resources and prompts are treated as untrusted external content when they flow into
  model context — apply the same context-sensitivity and prompt-injection posture defined
  in [[security]] and [[context-engine]].
- Connection lifecycle is explicit and observable: connecting, connected, tool-list-changed,
  disconnected, and reconnecting are distinct states surfaced to [[observability]]/
  [[devtools]] — a silently dropped connection must not leave stale tools registered as
  available.
- Authentication to an MCP server (where required) is configured and held server-side; the
  model never receives or sets MCP server credentials.
- Tool discovery from an MCP server does not automatically make every discovered tool
  callable — apply the same allowlist/permission-metadata gate as [[openapi-tools]] before
  a discovered tool becomes usable.
- Failures connecting to, or calling a tool via, an MCP server are surfaced as normalized
  tool/runtime errors (see [[ai-runtime]]'s error taxonomy pattern) — not raw protocol-level
  exceptions leaking to application code.
- Namespace MCP-derived tools by server (e.g. `mcp.<serverName>.<toolName>`) to avoid
  collisions with other tool origins, per [[tool-system]].

# Architecture / Patterns

```text
MCP Server ── connect ──► MCP Client (lifecycle: connecting/connected/disconnected)
        ↓ discovers
Tools / Resources / Prompts (mapped to internal schemas)
        ↓ registered into
Tool Registry (namespaced, allowlisted) ── same path as any other tool origin
        ↓ executes via
Action Firewall (unchanged pipeline)
```

# Anti-Patterns

- Executing an MCP-discovered tool directly against the server without routing through
  the firewall pipeline.
- Auto-registering every tool an MCP server advertises as immediately callable.
- Feeding an MCP resource's content into model context without applying the same
  sensitivity/injection handling as any other external content source.
- Leaving stale tools registered as callable after an MCP server disconnects.

# Validation Checklist

- [ ] MCP-discovered tools are registered through [[tool-system]] and gated by an allowlist
- [ ] MCP tool arguments are Zod-validated, not trusted from the server's own schema
- [ ] MCP tool execution passes through [[action-firewall]] with no special-case bypass
- [ ] Connection lifecycle changes are observable and stale tools are deregistered on disconnect
- [ ] MCP resource/prompt content is treated as untrusted context
