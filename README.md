# AI Copilot SDK

A TypeScript-first AI Copilot & Agent SDK with a framework-independent core and
React, Vue, Angular, Node.js server, and LLM provider adapters layered on top.
It exists to connect application context and authorized actions to model-driven conversations
without treating model output as authority.

> **Current status: Phase 12 — Production Platform + Ecosystem COMPLETE.**
> Phases 1–11 are complete. Phase 12 adds Angular and Node SDKs, a CLI, multi-tenant
> persistence, Redis workers, model routing and usage enforcement, a management API and
> platform, production deployment, release tooling and a documentation portal. Packages are
> published to npm under the MIT license as `@gixcopilot/*`; the previously committed
> real credential was rotated and its exposure reviewed per the owner. Always check
> [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) for authoritative phase state; see
> [`docs/architecture/overview.md`](docs/architecture/overview.md) and the [ADRs](docs/adr/)
> for the reasoning, and
> [`.claude/skills/ai-copilot-project/SKILL.md`](.claude/skills/ai-copilot-project/SKILL.md)
> for the 12-phase roadmap.

## Quick start

Add a copilot to an existing React, Vue or Angular app (or an empty folder) with one command:

```sh
npm create @gixcopilot@latest
```

It detects your framework, asks a few questions, installs the SDK, adds a chat component and
the dev proxy, and creates a Node copilot server (by default) that keeps the model key off the
browser. Then `npm run copilot:server` and your app's dev server. See
[Getting started](docs/guides/getting-started.md).

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
- **Phases 7–10** — `@gixcopilot/security`, `openapi`, `mcp`, `integrations`, `knowledge`,
  `rag`, `vectorstore-pgvector`, `memory`, `agents`, `workflows`, `jobs`,
  `checkpoint-postgres`; see each phase's docs under `docs/phases/`.
- **`@gixcopilot/telemetry`** (Phase 11) — the `TelemetryAdapter` port (no-op, OpenTelemetry,
  in-memory recording), semantic conventions, safe redaction, sampling, metrics, cost
  estimation, and instrumentation wrappers for every runtime seam.
- **`@gixcopilot/devtools`** (Phase 11) — read-only, viewer-scoped inspectors over recorded
  diagnostics, safe debug bundles, and an opt-in authenticated `/server` transport;
  **`apps/devtools`** is the React DevTools UI.
- **`@gixcopilot/testing`** (Phase 11) — deterministic test models, tool mocks, security/RAG/
  memory/approval fixtures, agent and workflow simulation, and side-effect-free replay.
- **`@gixcopilot/evals`** (Phase 11) — datasets, evaluators, reports, baseline comparison and CI
  gates in which security is a hard gate.
- **Phase 12 SDKs** — `@gixcopilot/headless` shares framework-neutral behavior between
  React and `@gixcopilot/angular`; `@gixcopilot/node` provides in-process and HTTP use;
  `@gixcopilot/cli` scaffolds projects, agents and tools.
- **Phase 12 production** — `@gixcopilot/config`, `tenancy`, `persistence-postgres`, `redis`,
  `model-router`, `usage`, and `management` power `apps/api`, `apps/worker` and the
  `apps/platform` control-plane UI. `apps/docs` serves the [developer guides](docs/guides/getting-started.md)
  and [production guides](docs/production/DEPLOYMENT.md).
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
  headless/             @gixcopilot/headless (shared chat behavior)
  react/                @gixcopilot/react (React hooks and provider)
  angular/              @gixcopilot/angular (Angular signals and components)
  vue/                  @gixcopilot/vue (Vue 3 plugin, composables and chat component)
  create/               @gixcopilot/create (npm create @gixcopilot installer)
  node/                 @gixcopilot/node (Node integration)
  cli/                  @gixcopilot/cli (aicopilot command)
  ui/                   @gixcopilot/ui (optional components + CSS)
  context/              @gixcopilot/context (framework-independent context/state engine)
  tools/                @gixcopilot/tools (framework-independent canonical tool architecture)
  generative-ui/        @gixcopilot/generative-ui (framework-independent generative UI/state-patch bridge)
  security/ openapi/ mcp/ integrations/ knowledge/ rag/ memory/   (Phases 7-9)
  vectorstores/pgvector/  agents/ workflows/ jobs/ checkpoint-postgres/   (Phases 9-10)
  telemetry/            @gixcopilot/telemetry (Phase 11)
  devtools/             @gixcopilot/devtools (+ /server) (Phase 11)
  testing/              @gixcopilot/testing (Phase 11)
  evals/                @gixcopilot/evals (Phase 11)
  config/ tenancy/ persistence-postgres/ redis/ model-router/ usage/ management/ (Phase 12)
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
  ...                   Phase 7-10 examples (react-enterprise, openapi, mcp, react-rag, agent-basic, multi-agent, workflow-*)
  devtools/             Phase 11 DevTools demo host + execution-generated trace
  evals/                Phase 11 evaluation example (deterministic + live OpenAI)
apps/
  devtools/             Phase 11 React DevTools UI
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
Install from npm, for example `npm install @gixcopilot/react react` or
`npm install @gixcopilot/node @gixcopilot/provider-openai`; see [Releasing](docs/RELEASING.md).

## Phase 12 developer and production guides

- Start with [Getting started](docs/guides/getting-started.md) and the [examples](docs/guides/examples.md).
- SDK guides: [React](docs/guides/react.md), [Vue](docs/guides/vue.md), [Angular](docs/guides/angular.md), and [Node](docs/guides/node.md).
- Application features: [tools](docs/guides/tools.md), [generative UI](docs/guides/generative-ui.md), [security](docs/guides/security.md), [OpenAPI](docs/guides/openapi.md), [MCP](docs/guides/mcp.md), [RAG](docs/guides/rag.md), [memory](docs/guides/memory.md), [agents](docs/guides/agents.md), and [workflows](docs/guides/workflows.md).
- Operations: [CLI](docs/guides/cli.md), [platform](docs/guides/platform.md), [DevTools](docs/guides/devtools.md), [testing](docs/guides/testing.md), [evaluations](docs/guides/evaluations.md), [production](docs/guides/production.md), and [deployment](docs/production/DEPLOYMENT.md).
- [API reference](docs/reference/api.md), [versioning](docs/VERSIONING.md), and [release process](docs/RELEASING.md). Contributors should read [AGENTS.md](AGENTS.md).

## Capability maturity

These labels describe the current repository evidence, not a published support promise.
Packages are published to npm at version 0.1.0 (pre-1.0; APIs may change in minor releases).

| Capability | Status | Main package or app |
| --- | --- | --- |
| Protocol, streaming, React | Beta | `protocol`, `core`, `server`, `client`, `react`, `ui` |
| Tools, generative UI, Action Firewall | Beta | `tools`, `generative-ui`, `security` |
| OpenAPI, MCP, RAG, memory | Beta | `openapi`, `mcp`, `rag`, `memory` |
| Agents, workflows, DevTools, evaluations | Beta | `agents`, `workflows`, `devtools`, `evals` |
| Angular, Vue and Node SDKs, CLI, installer | Beta | `angular`, `vue`, `node`, `cli`, `create` |
| Management platform and production deployment | Experimental | `management`, `apps/platform`, `apps/api`, `apps/worker` |

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

[MIT](LICENSE)
