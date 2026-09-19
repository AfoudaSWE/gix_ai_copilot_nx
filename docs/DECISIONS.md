# Decisions Index

> This file did not exist before Phase 2. Every architectural decision is recorded as a
> full ADR under `docs/adr/`; this file is a one-line-each index into them so a reader
> doesn't have to open every file to find the one they need.

| ADR                                                      | Decision                                                                                                                                                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [0001](adr/0001-monorepo-and-package-boundaries.md)      | Nx + pnpm monorepo, hand-written `project.json` targets (no heavy plugin stack), tag-based module boundaries                                                                                                         |
| [0002](adr/0002-framework-independent-core.md)           | `@gixcopilot/core` depends only on `@gixcopilot/protocol`; the generic `Executor` boundary is where a model (or anything else) attaches                                                                              |
| [0003](adr/0003-event-driven-protocol.md)                | Discriminated-union `CopilotEvent` protocol; sequence-based ordering; explicit version; known/unknown/invalid event classification                                                                                   |
| [0004](adr/0004-sse-as-initial-streaming-transport.md)   | SSE (not WebSocket) for Phase 1+2; run creation and streaming combined into one request; the request-vs-response stream disconnect-detection bug found and fixed                                                     |
| [0005](adr/0005-module-resolution-and-build-strategy.md) | ESM-only, NodeNext `.js`-extension imports, TypeScript project references (not path-alias-to-source), `tsc -b` for both build and typecheck                                                                          |
| [0006](adr/0006-model-provider-abstraction.md)           | `@gixcopilot/provider` depends on `core` (not the reverse); `Executor` extended additively with `ExecutorCompletion`; `messages` replaces `message`; retry lives only in `ModelRuntime`, never in a provider adapter |

Add a new row here whenever a new ADR is added under `docs/adr/`.

| Phase 3 ADR | Decision |
| --- | --- |
| [0007](adr/0007-headless-react-state-and-lifecycle.md) | Headless React/UI split; scoped external store; one active run; cancellation, retry/regenerate and configuration lifecycle; React 19 peers |
| [0008](adr/0008-copilot-ui-rendering-and-styling.md) | Exported CSS tokens/themes; native popup + Tab wrap/nonmodal sidebar; safe Markdown/GFM; component slots; examples instead of Storybook |

| Phase 4 ADR | Decision |
| --- | --- |
| [0009](adr/0009-context-and-state-architecture.md) | `@gixcopilot/context` depends only on protocol; resolved context reaches the model as a leading `system` message built entirely in `@gixcopilot/react`, with a synchronous fast path when nothing is registered; state and context are separate stores, state exposure to the model is explicit opt-in only |

| Phase 5 ADR | Decision |
| --- | --- |
| [0010](adr/0010-canonical-tool-architecture.md) | `@gixcopilot/tools` depends only on protocol; `ToolDefinition.execute` uses method shorthand for bivariant storage typing; duplicate registration rejected by default; `ToolResolver` is a mandatory discovery indirection; `ExecutorContext.onToolEvent` extends core additively instead of widening the yield type; the whole backend tool loop runs inside one `Executor.execute()` call; a frontend tool call suspends on a `FrontendToolBridge` promise rather than a new `RunStatus` |

| Phase 6 ADR | Decision |
| --- | --- |
| [0011](adr/0011-generative-ui-and-state-patch-architecture.md) | A "structured UI request" is a call to a reserved, SDK-generated tool per registered component (`ui.render.<name>`), not a new protocol content part; tool-result rendering (`useToolRenderer`) is a separate mechanism; interactive component actions route through a new `useInvokeTool` directly to the Tool Runtime, never back through the model; shared AI-writable state extends `@gixcopilot/context`'s existing store in place (`modelWritable`/`revision`/`applyPatch`) rather than a new package; no protocol/core/server/client/provider file was modified |
