# Installation

Every package is published under the `@gixcopilot` npm scope, ESM-only, with TypeScript
declarations. Requirements: **Node.js 22.12 or newer** for servers and tooling, and a bundler
that understands package `exports` (Vite, Angular CLI, webpack 5, Next.js) for web apps.

## One command

Inside an existing React, Vue or Angular app, or in an empty folder:

```bash
npm create @gixcopilot@latest
```

The installer detects your framework and package manager, asks a few questions, installs the
right SDK packages, adds a ready chat component and the `/api/copilot` dev proxy, and creates a
Node copilot server in `copilot-server/` (on by default). See [Getting started](getting-started.md)
for what each step sets up.

> [!TIP]
> `npm create @gixcopilot@latest -- --dry-run` prints the plan without changing anything, and
> `--yes` accepts every default (useful in scripts).

## Install packages yourself

| You are building | Install |
| --- | --- |
| React UI | `npm install @gixcopilot/react @gixcopilot/ui react react-dom` |
| React UI, your own components | `npm install @gixcopilot/react react react-dom` |
| Vue UI | `npm install @gixcopilot/vue vue` |
| Angular UI | `npm install @gixcopilot/angular zod` |
| Node copilot server | `npm install @gixcopilot/node @gixcopilot/provider-openai` |
| Server with security and tools | add `@gixcopilot/security @gixcopilot/tools zod` |
| Any HTTP/GraphQL API as tools | add `@gixcopilot/connectors` ([guide](connectors.md)) |
| Serve tools as an MCP server | add `@gixcopilot/mcp` |
| Next.js API route | `@gixcopilot/node` with `copilot.fetchHandler()` ([guide](nextjs.md)) |
| Agents and workflows | add `@gixcopilot/agents @gixcopilot/workflows` |
| Knowledge (RAG) and memory | add `@gixcopilot/knowledge @gixcopilot/rag @gixcopilot/memory` |
| PostgreSQL + pgvector | add `@gixcopilot/vectorstore-pgvector @gixcopilot/persistence-postgres` |
| CLI | `npx @gixcopilot/cli --help` (command: `aicopilot`) |

Browser packages (`client`, `react`, `ui`, `vue`, `angular`, `headless`) never depend on a model
provider, database or Node built-in, so provider keys and server code cannot end up in a
browser bundle.

> [!SECURITY]
> Model provider API keys belong only in the server's environment (`.env`, a secret manager or
> mounted files). The browser talks to your copilot server, never to the model provider.

## Versions

All packages share one version and are released together. Before 1.0, minor releases may
change APIs; see [Versioning](../VERSIONING.md) and the [migration guides](../migrations/README.md).

## Next

- [Quickstart](getting-started.md): a streaming copilot in a few minutes.
- [React](react.md), [Vue](vue.md), [Angular](angular.md), [Node](node.md).
