---
name: tool-system
description: Tool architecture - definitions, registry, frontend/backend/remote tools, schema validation, versioning, middleware, and cancellation. Load when defining, registering, or executing any tool the model can call.
---

# Purpose

Define a consistent, safe architecture for tools the model can invoke, whether they run on
the frontend, backend, or a remote system (MCP, OpenAPI-derived).

# When to Apply

Defining a new tool, building the tool registry, implementing tool execution/middleware, or
wiring OpenAPI/MCP tools into the system.

# Required Rules

- Every tool has a schema-validated input type and output type defined with Zod; the model's
  arguments are validated against the input schema before the tool body ever runs — invalid
  arguments are rejected as a typed tool error, never passed through.
- Tools are identified by a namespaced, stable name (e.g. `crm.createContact`) to avoid
  collisions across frontend, backend, and remote (MCP/OpenAPI) sources.
- The tool registry distinguishes tool origin explicitly: `frontend`, `backend`, `remote`
  — origin affects where execution happens and which security checks apply, and must never
  be ambiguous at call time.
- Every consequential tool call (anything that mutates state, spends money, or affects a
  real system) passes through the [[action-firewall]] pipeline before executing — this is
  not optional and does not vary by tool origin, including MCP/OpenAPI-derived tools (see
  [[mcp]], [[openapi-tools]]).
- Tools declare permission metadata (required roles/scopes, side-effect class: read-only /
  reversible / irreversible) that the firewall and [[hitl]] approval policy consume.
- Tool execution supports cancellation (an in-flight tool call can be aborted) and a
  timeout, so one hanging tool cannot hang an entire run.
- Tools can declare middleware (logging, tracing, rate limiting, dry-run) applied uniformly
  by the registry, not reimplemented per tool.
- Parallel tool execution is supported by the runtime where tools declare themselves safe to
  run concurrently; tools that are not safe to parallelize must declare that explicitly.
- Tool versioning: a breaking change to a tool's input/output schema is a new tool version,
  not a silent mutation of the existing schema (see [[backward-compatibility]]).
- Tool discovery (listing available tools, e.g. for the model's system context) filters by
  the caller's permissions before the list is ever built into a prompt — a user must never
  see or be offered a tool they are not authorized to call.

# Architecture / Patterns

```text
Tool Definition (name, schema, handler, origin, permission metadata)
        ↓ registered in
Tool Registry (namespacing, discovery, versioning)
        ↓ invoked as
Tool Execution (validate → middleware → firewall → handler → result)
        ↓ produces
Tool Result | Tool Error
```

# Anti-Patterns

- Executing a tool handler before validating the model's arguments against its schema.
- A "backend tool" that is actually invoked directly from the frontend, bypassing the
  server-side firewall.
- Two tools sharing the same name from different origins with no namespace to disambiguate.
- Auto-generating and registering every MCP/OpenAPI endpoint as a tool with no allowlist
  (see [[mcp]], [[openapi-tools]]).
- A tool with no timeout that can block a run indefinitely.

# Validation Checklist

- [ ] Tool input/output are Zod-validated and arguments are validated before execution
- [ ] Tool is namespaced and declares its origin (frontend/backend/remote)
- [ ] Tool declares permission metadata consumed by [[action-firewall]]/[[hitl]]
- [ ] Tool call path enforces cancellation and a timeout
- [ ] Tool discovery is filtered by caller permission before reaching the model
