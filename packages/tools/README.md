# @gixcopilot/tools

## Purpose

## Install

```bash
npm install @gixcopilot/tools
```

Requires Node.js >=22.12.0. ESM only.

Framework-independent canonical tool architecture for the AI Copilot SDK (Phase 5). Defines
one tool shape — `ToolDefinition` — shared by backend (server-executed) and frontend
(browser-executed) tools, with a registry, a discovery resolver, and an execution runtime,
without any dependency on React, Fastify, or a specific LLM provider SDK.

## Responsibilities

- `defineTool()` — an ergonomic authoring API: pass Zod schemas for `input`/`output` and get
  a fully-typed `execute(input, context)` with no repeated annotations.
- `createToolRegistry()` — register/unregister/get/list/subscribe/clear; duplicate tool names
  are rejected by default (`{ replace: true }` opts in explicitly); no global singleton —
  create as many independent registries as needed (one per server, one per UI provider, ...).
- `createDefaultToolResolver()` / `createStaticToolResolver()` / `combineToolResolvers()` —
  the discovery boundary between "everything registered" and "what a given call is actually
  offered" (the seam a future permission-aware or OpenAPI/MCP-backed resolver plugs into).
- `createToolRuntime()` — the execution pipeline: resolve → validate input (Zod) → middleware
  → timeout/cancellation → execute → validate output (Zod, if declared) → serialize/bound the
  result → normalize into a `ToolResult`. Never throws; every failure mode becomes a
  `{ status: 'error' }` result.
- `toToolManifestEntry()` / `toToolManifest()` — converts a `ToolDefinition`'s Zod input
  schema into the provider-neutral, wire-safe JSON Schema manifest sent to a model or across
  a network boundary (via Zod 4's native `z.toJSONSchema`, no extra dependency).
- `serializeToolResult()` — a JSON-safe, size-bounded projection of an arbitrary tool result.
- `planConcurrency()` / `runWithConcurrencyPlan()` — runs a batch of tool calls fully
  parallel unless any call declares itself `serial`/`exclusive`.

## Public API

See `src/index.ts`. No deep imports into `src/` are supported (the package's `exports`
field only exposes `.`).

## Dependencies

- `@gixcopilot/protocol` — `ToolCall`/`ToolResult`/`ToolManifestEntry`/`ToolSource` types and
  `CopilotError`, so tool errors share the SDK's one error taxonomy.
- `zod` — schema definition, validation, and JSON Schema conversion.

## Non-responsibilities

- **No React/Fastify/provider SDK.** `@gixcopilot/react`'s `useFrontendTool` and
  `@gixcopilot/server`'s tool-calling executor are thin consumers of this package — see
  `docs/adr/0010-canonical-tool-architecture.md`.
- **No security enforcement.** `ToolMetadata`'s `riskClass`/`sensitivity`/`custom` fields are
  classification only; they are never treated as an authorization decision anywhere in this
  codebase. Phase 7's Action Firewall will consume this metadata through the
  `ToolRuntimeMiddleware` boundary this package already exposes.
- **No OpenAPI/MCP tool generation.** A future adapter can produce a plain `ToolDefinition`
  from an OpenAPI operation or an MCP tool and call `registry.register()` — nothing here
  needs to change to support that (Phase 8).
- **No dynamic code execution.** A tool is a pre-registered, trusted capability; the model
  chooses from what's offered, never generates executable code that runs.

## Basic Usage

```ts
import { z } from 'zod';
import { createToolRegistry, createDefaultToolResolver, createToolRuntime, defineTool } from '@gixcopilot/tools';

const getApplicationStatus = defineTool({
  name: 'applications.getStatus',
  description: 'Get the current status of an application',
  input: z.object({ applicationId: z.string() }),
  output: z.object({ applicationId: z.string(), status: z.string() }),
  metadata: { readOnly: true },
  async execute({ applicationId }, { signal }) {
    return applicationService.getStatus(applicationId, { signal });
  },
});

const registry = createToolRegistry();
registry.register(getApplicationStatus);

const runtime = createToolRuntime({ resolver: createDefaultToolResolver(registry) });
const result = await runtime.execute({
  toolCallId: 'call-1',
  name: 'applications.getStatus',
  arguments: { applicationId: 'APP-1024' },
  context: { runId: 'run-1', signal: new AbortController().signal },
});
```

## Documentation

- [tools guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/tools.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/tools)

## License

MIT
