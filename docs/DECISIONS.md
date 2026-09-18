# Decisions Index

> This file did not exist before Phase 2. Every architectural decision is recorded as a
> full ADR under `docs/adr/`; this file is a one-line-each index into them so a reader
> doesn't have to open every file to find the one they need.

| ADR                                                      | Decision                                                                                                                                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [0001](adr/0001-monorepo-and-package-boundaries.md)      | Nx + pnpm monorepo, hand-written `project.json` targets (no heavy plugin stack), tag-based module boundaries                                                                                                        |
| [0002](adr/0002-framework-independent-core.md)           | `@gixcopilot/core` depends only on `@gixcopilot/protocol`; the generic `Executor` boundary is where a model (or anything else) attaches                                                                               |
| [0003](adr/0003-event-driven-protocol.md)                | Discriminated-union `CopilotEvent` protocol; sequence-based ordering; explicit version; known/unknown/invalid event classification                                                                                  |
| [0004](adr/0004-sse-as-initial-streaming-transport.md)   | SSE (not WebSocket) for Phase 1+2; run creation and streaming combined into one request; the request-vs-response stream disconnect-detection bug found and fixed                                                    |
| [0005](adr/0005-module-resolution-and-build-strategy.md) | ESM-only, NodeNext `.js`-extension imports, TypeScript project references (not path-alias-to-source), `tsc -b` for both build and typecheck                                                                         |
| [0006](adr/0006-model-provider-abstraction.md)           | `@gixcopilot/provider` depends on `core` (not the reverse); `Executor` extended additively with `ExecutorCompletion`; `messages` replaces `message`; retry lives only in `ModelRuntime`, never in a provider adapter |

Add a new row here whenever a new ADR is added under `docs/adr/`.
