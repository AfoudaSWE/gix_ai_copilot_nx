# AI Copilot SDK

A production-grade, TypeScript-first AI Copilot & Agent SDK. Framework-independent core,
with React/Angular, Node.js server, and LLM provider adapters layered on top.

> **Current status: Phase 2 — LLM Runtime & Streaming.** Phase 1 (foundation) and Phase 2
> (a provider-independent model runtime) are complete. There is no agent runtime, no tools,
> no RAG, and no UI yet. What exists: a transport-independent protocol, a
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

- **`@aicopilot/protocol`** — transport-independent contracts (`Message`, `Thread`, `Run`,
  `CopilotEvent`, `FinishReason`), runtime validation, and (de)serialization.
- **`@aicopilot/core`** — the framework-independent runtime: run lifecycle, event
  sequencing, cancellation, and a generic `Executor` boundary.
- **`@aicopilot/provider`** — provider-neutral model contracts, a registry, and a
  `ModelRuntime` (retry, timeout, cancellation, usage, latency, normalized errors).
- **`@aicopilot/provider-mock`** — a deterministic, non-network provider for tests/CI.
- **`@aicopilot/provider-openai`** — a real OpenAI streaming provider (the only package
  depending on the `openai` SDK).
- **`@aicopilot/server`** — a Fastify HTTP/SSE adapter, routing a request to either the
  default executor or a named model.
- **`@aicopilot/client`** — a framework-independent streaming client (no React/Angular).
- **`examples/protocol-demo`** — the Phase 1 proof (no AI), CLI + integration test.
- **`examples/model-streaming`** — the Phase 2 proof (mock by default, optional real
  OpenAI), CLI + mandatory mock integration test + optional real-provider smoke test.

## Package Structure

```text
packages/
  protocol/             @aicopilot/protocol
  core/                 @aicopilot/core
  client/               @aicopilot/client
  server/               @aicopilot/server
  providers/
    provider-core/      @aicopilot/provider
    mock/               @aicopilot/provider-mock
    openai/             @aicopilot/provider-openai
examples/
  protocol-demo/        Phase 1 end-to-end CLI demo + integration test
  model-streaming/       Phase 2 end-to-end CLI demo + integration test + optional OpenAI smoke test
docs/
  architecture/         architecture overview
  adr/                  architecture decision records
  phases/phase-02/      Phase 2's own documentation set
  PROJECT_STATUS.md, DECISIONS.md, TECHNICAL_DEBT.md
.claude/
  skills/               the engineering skill system this project is built against
```

Dependency direction (enforced by `@nx/enforce-module-boundaries`, see `eslint.config.js`):

```text
protocol  <-  core  <-  server  <-  provider
protocol  <-  client
protocol  <-  core  <-  provider  <-  provider-mock, provider-openai (never each other)
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
```

Each command also works scoped to a single project, e.g. `pnpm --filter @aicopilot/core test`,
or via Nx directly: `npx nx run core:test`, `npx nx run-many -t test --projects=core,server`.

Run the Phase 2 model-streaming demo with `pnpm --filter @aicopilot/model-streaming-demo run demo`
(mock provider by default; set `OPENAI_API_KEY` and `MODEL_PROVIDER=openai` for real
streaming — see [`examples/model-streaming/README.md`](examples/model-streaming/README.md)).

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

This project is built against an explicit skill system in [`.claude/skills/`](.claude/skills/),
covering architecture, TypeScript standards, security, testing, and more — see
[`.claude/skills/README.md`](.claude/skills/README.md). Development proceeds through 12
fixed phases with an explicit phase-gate: work never silently continues from one phase to
the next.

## License

Not yet specified.
