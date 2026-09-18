# AI Copilot SDK

A production-grade, TypeScript-first AI Copilot & Agent SDK. Framework-independent core,
with React/Angular, Node.js server, and LLM provider adapters layered on top.

> **Current status: Phase 1 — Foundation & Architecture.** This repository does **not**
> yet provide any LLM integration. There is no OpenAI/Anthropic/Gemini/Ollama adapter, no
> agent runtime, no tools, and no UI. What exists is the architectural foundation: a
> transport-independent protocol, a framework-independent runtime, an HTTP/SSE server
> adapter, and a streaming client — proven end to end with a deterministic, non-AI
> executor. See [`docs/architecture/overview.md`](docs/architecture/overview.md) and the
> [ADRs](docs/adr/) for the reasoning behind these choices, and
> [`.claude/skills/ai-copilot-project/SKILL.md`](.claude/skills/ai-copilot-project/SKILL.md)
> for the full 12-phase roadmap and engineering standards.

## Phase 1 Capabilities

```text
Client -> HTTP request -> Server -> Core -> Typed protocol events -> SSE stream -> Client
```

- **`@aicopilot/protocol`** — transport-independent contracts (`Message`, `Thread`, `Run`,
  `CopilotEvent`), runtime validation, and (de)serialization.
- **`@aicopilot/core`** — the framework-independent runtime: run lifecycle, event
  sequencing, cancellation, and a generic `Executor` boundary (no LLM).
- **`@aicopilot/server`** — a Fastify HTTP/SSE adapter over the core runtime.
- **`@aicopilot/client`** — a framework-independent streaming client (no React/Angular).
- **`examples/protocol-demo`** — the end-to-end proof, runnable as a CLI and covered by an
  automated integration test against a real, in-process server.

## Package Structure

```text
packages/
  protocol/   @aicopilot/protocol
  core/       @aicopilot/core
  client/     @aicopilot/client
  server/     @aicopilot/server
examples/
  protocol-demo/   end-to-end CLI demo + integration test
docs/
  architecture/    architecture overview
  adr/             architecture decision records
.claude/
  skills/          the engineering skill system this project is built against
```

Dependency direction (enforced by `@nx/enforce-module-boundaries`, see `eslint.config.js`):

```text
protocol  <-  core  <-  server
protocol  <-  client
```

`protocol` depends on nothing else in the workspace. Nothing in `core` or `client` depends
on `server`.

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

## Testing

Vitest for unit/integration tests. `examples/protocol-demo/src/integration.spec.ts` is the
full end-to-end proof (client → real HTTP → real server → core → SSE → client, including
both client-initiated and out-of-band cancellation), run against a real, in-process Fastify
server — no mocks, no external AI service, no network access required.

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
