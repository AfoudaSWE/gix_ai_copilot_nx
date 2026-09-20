# AI Copilot SDK

A production-grade, TypeScript-first AI Copilot & Agent SDK. Framework-independent core,
with React/Angular, Node.js server, and LLM provider adapters layered on top.

> **Current status: Phase 6 — Generative UI & Shared State COMPLETE.** Phases 1–6 are
> complete. Phase 4 added a framework-independent context/state engine
> (`@gixcopilot/context`); Phase 5 added a canonical tool architecture
> (`@gixcopilot/tools`) with backend/frontend tool calling; Phase 6 lets the model safely
> drive UI (a trusted component registry, `@gixcopilot/generative-ui`) and propose
> AI-writable state changes with revision/conflict handling — both carried entirely over
> Phase 5's existing tool-calling pipeline, with no protocol/core/server/client/provider
> change. There is still no Action Firewall, RBAC/HITL, OpenAPI/MCP integration, RAG, or
> agents. The foundation remains a transport-independent protocol, a
> framework-independent core runtime, an HTTP/SSE server, a streaming client, and a real
> model execution layer (retry, timeout, cancellation, usage, latency, normalized errors)
> proven against both a deterministic mock provider and real OpenAI streaming. See
> [`docs/architecture/overview.md`](docs/architecture/overview.md),
> [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md), and the [ADRs](docs/adr/) for the
> reasoning behind these choices, and
> [`.claude/skills/ai-copilot-project/SKILL.md`](.claude/skills/ai-copilot-project/SKILL.md)
> for the full 12-phase roadmap and engineering standards.

## Capabilities So Far

```text
Client -> Server -> Core -> (default executor | Model Runtime -> Provider) -> SSE -> Client
```

- **`@gixcopilot/protocol`** — transport-independent contracts (`Message`, `Thread`, `Run`,
  `CopilotEvent`, `FinishReason`), runtime validation, and (de)serialization.
- **`@gixcopilot/core`** — the framework-independent runtime: run lifecycle, event
  sequencing, cancellation, and a generic `Executor` boundary.
- **`@gixcopilot/provider`** — provider-neutral model contracts, a registry, and a
  `ModelRuntime` (retry, timeout, cancellation, usage, latency, normalized errors).
- **`@gixcopilot/provider-mock`** — a deterministic, non-network provider for tests/CI.
- **`@gixcopilot/provider-openai`** — a real OpenAI streaming provider (the only package
  depending on the `openai` SDK).
- **`@gixcopilot/server`** — a Fastify HTTP/SSE adapter, routing a request to either the
  default executor or a named model.
- **`@gixcopilot/client`** — a framework-independent streaming client (no React/Angular).
- **`@gixcopilot/react`** — provider, headless chat hooks, streaming state and actions, plus
  `useCopilotContext`/`useCopilotState` (Phase 4), `useFrontendTool`/`useToolCalls`
  (Phase 5), and `useGenerativeComponent`/`useToolRenderer`/`useInvokeTool` (Phase 6) hooks.
- **`@gixcopilot/ui`** — chat/popup/sidebar, safe Markdown, accessible controls and themes,
  with automatic generative-component/custom tool-result rendering (Phase 6).
- **`@gixcopilot/context`** — framework-independent application context registry/engine
  (scopes, priority, sensitivity, serialization, token budgeting/truncation, deduplication)
  and a shared typed state store, extended in Phase 6 with `modelWritable`/revision/
  `applyPatch`; depends only on `@gixcopilot/protocol`.
- **`@gixcopilot/tools`** — framework-independent canonical tool architecture
  (`ToolDefinition`/`defineTool`, registry, resolver, execution runtime) shared by backend
  and frontend tools; depends only on `@gixcopilot/protocol`.
- **`@gixcopilot/generative-ui`** — framework-independent trusted component registry and the
  reserved-tool bridge that carries a model-selected component/state patch entirely over the
  canonical tool-calling pipeline; depends only on protocol/tools/context, never React.
- **`examples/react-basic` / `examples/react-custom-ui`** — styled and headless React examples.
- **`examples/react-context`** — application-aware chat example (Phase 4).
- **`examples/react-tools`** — backend/frontend tool calling example (Phase 5).
- **`examples/react-generative-ui`** — generative UI + AI-writable state example (Phase 6).
- **`examples/protocol-demo`** — the Phase 1 proof (no AI), CLI + integration test.
- **`examples/model-streaming`** — the Phase 2 proof (mock by default, optional real
  OpenAI), CLI + mandatory mock integration test + optional real-provider smoke test.

## Package Structure

```text
packages/
  protocol/             @gixcopilot/protocol
  core/                 @gixcopilot/core
  client/               @gixcopilot/client
  server/               @gixcopilot/server
  react/                @gixcopilot/react (headless)
  ui/                   @gixcopilot/ui (optional components + CSS)
  context/              @gixcopilot/context (framework-independent context/state engine)
  tools/                @gixcopilot/tools (framework-independent canonical tool architecture)
  generative-ui/        @gixcopilot/generative-ui (framework-independent generative UI/state-patch bridge)
  providers/
    provider-core/      @gixcopilot/provider
    mock/               @gixcopilot/provider-mock
    openai/             @gixcopilot/provider-openai
examples/
  protocol-demo/        Phase 1 end-to-end CLI demo + integration test
  model-streaming/       Phase 2 end-to-end CLI demo + integration test + optional OpenAI smoke test
  react-basic/           Phase 3 interface lab + mock server + integration tests
  react-custom-ui/       Phase 3 headless-only example
  react-context/         Phase 4 application-context example + mock server + integration test
  react-tools/           Phase 5 backend/frontend tool example + mock server + integration tests
  react-generative-ui/   Phase 6 generative-UI/state-patch example + mock server + integration tests
docs/
  architecture/         architecture overview
  adr/                  architecture decision records
  phases/phase-02/      Phase 2's own documentation set
  phases/phase-03/      Phase 3 API, validation, completion and handoff
  phases/phase-04/      Phase 4 API, validation, completion and handoff
  phases/phase-05/      Phase 5 API, validation, completion and handoff
  phases/phase-06/      Phase 6 API, validation, completion and handoff
  PROJECT_STATUS.md, DECISIONS.md, TECHNICAL_DEBT.md
.claude/
  skills/               the engineering skill system this project is built against
```

Dependency direction (enforced by `@nx/enforce-module-boundaries`, see `eslint.config.js`):

```text
protocol  <-  core  <-  server
protocol  <-  client  <-  react  <-  ui
protocol  <-  context  <-  react
protocol  <-  tools  <-  react, server
protocol, tools, context  <-  generative-ui  <-  react
protocol  <-  core  <-  provider  <-  provider-mock, provider-openai (never each other)
provider  <-  server
```

`protocol` depends on nothing else in the workspace. `core` depends only on `protocol` —
notably, **not** on `provider`; it's the other way around. See
[ADR 0006](docs/adr/0006-model-provider-abstraction.md).

## Development Commands

This is an Nx + pnpm monorepo.

```sh
pnpm install        # install workspace dependencies

pnpm lint           # nx run-many -t lint
pnpm typecheck      # nx run-many -t typecheck
pnpm test           # nx run-many -t test
pnpm build          # nx run-many -t build
pnpm validate       # all four, in one call

pnpm demo           # run the Phase 1 end-to-end CLI demo
pnpm demo:react      # after build: React examples on 5173/5174, mock server on 4318
pnpm test:e2e        # builds examples and runs credential-free Chromium tests
```

Each command also works scoped to a single project, e.g. `pnpm --filter @gixcopilot/core test`,
or via Nx directly: `npx nx run core:test`, `npx nx run-many -t test --projects=core,server`.

Run the Phase 2 model-streaming demo with `pnpm --filter @gixcopilot/model-streaming-demo run demo`
(mock provider by default; set `OPENAI_API_KEY` and `MODEL_PROVIDER=openai` for real
streaming — see [`examples/model-streaming/README.md`](examples/model-streaming/README.md)).

For React, run `pnpm build && pnpm demo:react`, then open <http://127.0.0.1:5173>.
The standalone headless example is on port 5174. Both use the existing runtime through
HTTP/SSE. For browser tests, first run `pnpm exec playwright install chromium`.

```tsx
import { CopilotProvider } from '@gixcopilot/react';
import { CopilotPopup } from '@gixcopilot/ui';
import '@gixcopilot/ui/styles.css';

export function App() {
  return (
    <CopilotProvider runtimeUrl="/api/copilot">
      <CopilotPopup suggestions={['Explain SSE']} />
    </CopilotProvider>
  );
}
```

The runtime URL is a base URL; requests go to `/api/copilot/runs`. See the
[React API](docs/phases/phase-03/Phase_3_API.md) for custom clients and headless hooks.
Packages remain private workspace packages; no npm release was performed.

## Testing

Vitest for unit/integration tests. `examples/protocol-demo/src/integration.spec.ts` and
`examples/model-streaming/src/integration.spec.ts` are the full end-to-end proofs (client →
real HTTP → real server → core → [model runtime →] SSE → client, including cancellation),
run against a real, in-process Fastify server — no mocks of our own code, no external AI
service required for either. `examples/model-streaming/src/openai-smoke.spec.ts` is an
**optional** real-network test against the actual OpenAI API, skipped (not failed) unless
`OPENAI_API_KEY` is set — never part of the deterministic CI requirement.

## Architecture

See [`docs/architecture/overview.md`](docs/architecture/overview.md) for package
responsibilities and the full request/response flow, and [`docs/adr/`](docs/adr/) for the
specific decisions made and why. Each package also has its own README describing its
public API and, importantly, its **non-responsibilities** — what it deliberately does not
do, to keep architecture drift from creeping in as later phases are built.

## Engineering Standards

[`AGENTS.md`](AGENTS.md) is the entry point for any coding agent working in this repo, and
[`CONSTITUTION.md`](CONSTITUTION.md) is the non-negotiable law it defers to — framework
independence, phase discipline, the trust boundary around model output, verified-completion
requirements, and dependency discipline. Everything below that is an explicit skill system in
[`.claude/skills/`](.claude/skills/), covering architecture, TypeScript standards, security,
testing, and more — see [`.claude/skills/README.md`](.claude/skills/README.md). Development
proceeds through 12 fixed phases with an explicit phase-gate: work never silently continues
from one phase to the next.

## License

Not yet specified.
