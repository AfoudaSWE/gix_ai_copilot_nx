# Phase 5 Handoff

The new seam is `@gixcopilot/tools` (framework-independent), consumed by `@gixcopilot/server`
(backend tools, via `CreateServerOptions.toolRegistry`) and `@gixcopilot/react` (frontend
tools, via `useFrontendTool`) — no new required prop on `CopilotProvider`, no opt-in step
beyond registering a tool.

```sh
pnpm install
pnpm build
pnpm --filter @gixcopilot/react-tools server   # terminal 1 - deterministic demo backend on :4320
pnpm --filter @gixcopilot/react-tools dev       # terminal 2 - Vite dev server on :5176
```

Open <http://127.0.0.1:5176>. Click an application row, then try the suggested prompts or
type your own — "What is the status of APP-1024?" (backend tool), "Open APP-2048" (frontend
tool), "What is its status?" after selecting a row (context + tool), "What is the status of
APP-ERROR?" (tool error), or "Run an audit on APP-1024" then press Stop while it's running
(tool cancellation). No provider key needed; the demo backend is a deterministic, non-network
`ModelProvider` (see `examples/react-tools/src/backend.ts`). Every prior example
(`:5173`–`:5175`, their own backends on `:4317`–`:4319`) is unchanged and still works exactly
as before.

For validation:

```sh
pnpm validate
pnpm --filter @gixcopilot/tools test
pnpm --filter @gixcopilot/provider test
pnpm --filter @gixcopilot/provider-mock test
pnpm --filter @gixcopilot/provider-openai test
pnpm --filter @gixcopilot/server test
pnpm --filter @gixcopilot/client test
pnpm --filter @gixcopilot/react test
pnpm --filter @gixcopilot/ui test
pnpm --filter @gixcopilot/react-tools test
```

All newly exported APIs are documented in [API](Phase_5_API.md); pipeline/lifecycle choices
in [Architecture](Phase_5_Architecture.md) and ADR 0010; test evidence and limits in
[Testing](Phase_5_Testing.md) and [Issues](Phase_5_Issues.md).

## Maintenance constraints

- **Keep `@gixcopilot/tools` free of React, Fastify, and provider-SDK dependencies** —
  enforced by `@nx/enforce-module-boundaries` (`scope:tools` → `protocol, tools` only). A
  future OpenAPI/MCP tool-source adapter (Phase 8) should produce plain `ToolDefinition`s and
  call `registry.register()`, not add a new dependency to this package.
- **Never wire `registry.list()` directly into a model request.** Always go through a
  `ToolResolver` (`createDefaultToolResolver` or a composed one) — this is the exact seam
  Phase 7's permission-aware discovery and Phase 8's OpenAPI/MCP discovery need untouched.
- **Do not add security/authorization middleware to `ToolRuntimeMiddleware` yet.** The
  pipeline boundary exists specifically for Phase 7's Action Firewall; adding an
  authentication/RBAC check here now would be scope creep this phase's own boundary forbids.
- **`ExecutorContext.onToolEvent` is the only tool-lifecycle channel into `@gixcopilot/core`.**
  Do not widen `Executor.execute()`'s yield type to carry tool events directly — every
  Phase 1/2 `Executor` (including `createEchoExecutor`) depends on that signature staying
  `AsyncGenerator<string, ExecutorCompletion | void, undefined>`.
- **If you touch `runtime.ts`'s drain loop, re-run `runtime.spec.ts`'s "drains pending tool
  events queued just before the executor throws" test** — it pins down a real bug (see
  [Issues](Phase_5_Issues.md)) that silently drops queued events on any code path that
  doesn't drain in both the success and error branches.
- **If you touch `tool-calling-executor.ts`'s dispatch ordering, re-run
  `tool-frontend.e2e.spec.ts`.** It uses a real listening server and real `fetch` specifically
  because `app.inject()` cannot exercise the concurrent two-request round trip a frontend
  tool call requires — a regression here reintroduces a real deadlock, not just a slow test.
- **`metadata.riskClass`/`metadata.sensitivity`/`metadata.custom` are not authorization.**
  Phase 7 will add real enforcement; do not start relying on any of these fields as a
  security boundary in application or server code.
- **Frontend tool arguments are validated on the browser, not trusted from the SSE event.**
  `useFrontendTool`'s registered tool is executed through the same
  `@gixcopilot/tools` `ToolRuntime` pipeline the server uses — do not bypass it by calling a
  registered tool's `execute()` directly from `chat-store.ts` or anywhere else.
- **`maxToolIterations` defaults to 8.** A server that expects legitimately long multi-tool
  conversations should raise `toolRuntimeDefaults.maxToolIterations` explicitly, not rely on
  the default silently accommodating it.

The repository's existing Phase 1–4 APIs were not changed in a breaking way; every Phase 1–4
test passes (with the disclosed mechanical `ContentPart` narrowing fix — see
[Issues](Phase_5_Issues.md)). No git commits, package publication, or deployment were
performed. Work remains in the working tree for review.

**Phase 06 — Generative UI & Shared State: LOCKED / NOT STARTED.** No generative-component
registry, structured UI request handling, schema-validated props, trusted component
rendering, or any other future-phase feature has been implemented. Starting another phase
requires a new explicit user instruction.
