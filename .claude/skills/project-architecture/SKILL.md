---
name: project-architecture
description: Core architectural rules for the AI Copilot SDK - framework independence, package boundaries, dependency direction, adapter architecture, and abstraction boundaries. Load before designing any package, module, or cross-package interface.
---

# Purpose

Define the structural rules that keep the SDK's core framework-independent, prevent
circular dependencies, and keep security/runtime/storage/model concerns properly separated
behind abstractions.

# When to Apply

Any time a new package, module boundary, public interface, or cross-cutting abstraction
(transport, storage, model, tool) is being designed or modified.

# Required Rules

- The core runtime must never import a UI framework (React, Angular), a specific LLM
  provider SDK, a specific database driver, or a specific transport implementation.
- Dependencies flow one direction only, outward from the core. Framework SDKs depend on the
  client SDK; the client SDK depends on the protocol; nothing inside the core depends back
  on an adapter.
- No circular dependencies between packages, enforced via [[nx-monorepo]] module boundaries.
- Every external technology integration (React, Angular, OpenAI, Anthropic, Gemini, Ollama,
  OpenAPI, MCP, PostgreSQL, Redis) is implemented as an adapter or integration package that
  implements a core-defined interface — never as a hard dependency inside `@gixcopilot/core`.
- Public APIs (exported from a package's root/index) must be intentional and reviewed;
  internal implementation types must not leak through public signatures. See
  [[typescript-standards]] for the type-level rules and [[sdk-design]] for API ergonomics.
- Transport (HTTP/SSE/WebSocket), storage (Postgres/Redis/in-memory), and model (OpenAI/
  Anthropic/etc.) are each defined as an interface in the core/protocol layer, with concrete
  implementations living in adapter packages.
- Tool execution is abstracted behind the tool interface defined in [[tool-system]]; the
  core must not assume tools are local, remote, frontend, or backend.
- Security boundaries (auth, RBAC/ABAC, approval) are enforced at defined choke points
  (see [[action-firewall]]), not scattered ad hoc through business logic.

# Architecture / Patterns

Target conceptual layering:

```text
Framework SDKs   (React adapter, Angular adapter)
      ↓
Client SDK       (framework-agnostic client, consumed by framework SDKs)
      ↓
Protocol         (Message, Thread, Run, Event, ToolCall, ToolResult, State — see [[protocol-design]])
      ↓
Server           (Node/Fastify transport implementation — see [[node-backend]])
      ↓
Core Runtime     (orchestration, lifecycle, execution — see [[ai-runtime]])
      ↓
Agents / Context / Tools   (see [[agent-architecture]], [[context-engine]], [[tool-system]])
      ↓
Adapters         (LLM providers, DB, cache, MCP, OpenAPI — see [[dependency-policy]])
```

Each layer depends only on the layer(s) below it via an interface, never on a concrete
adapter implementation.

# Anti-Patterns

- Importing `react` or `@angular/core` from any package outside a `*-react`/`*-angular`
  adapter package.
- A core package importing a specific vector database or LLM provider SDK directly.
- "Just this once" reaching from the core into a framework adapter to fix a bug quickly.
- Business logic performing authorization checks inline instead of going through the
  firewall pipeline.
- Circular imports between two packages that both claim to be "core."

# Validation Checklist

- [ ] No core package imports a framework, provider SDK, or specific storage driver directly
- [ ] New cross-package dependencies flow in the approved direction only
- [ ] New external integrations are implemented as adapters against a core-defined interface
- [ ] Public exports were reviewed for leaked internal types
- [ ] No new circular dependency introduced (verify with Nx graph — see [[nx-monorepo]])
