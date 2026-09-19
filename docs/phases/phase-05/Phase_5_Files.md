# Phase 5 Files

## Created

- `packages/tools/`: package.json, project.json, tsconfig.json, vitest.config.ts; `src/`:
  `index.ts`, `tool-name.ts`, `tool-name.spec.ts`, `tool-metadata.ts`, `tool-definition.ts`,
  `define-tool.ts`, `define-tool.spec.ts`, `tool-registry.ts`, `tool-registry.spec.ts`,
  `tool-resolver.ts`, `tool-resolver.spec.ts`, `tool-schema.ts`, `tool-schema.spec.ts`,
  `tool-result-serialization.ts`, `tool-result-serialization.spec.ts`, `concurrency.ts`,
  `concurrency.spec.ts`, `tool-runtime.ts`, `tool-runtime.spec.ts`, `mock-tools.ts`.
- `packages/protocol/src/tool.ts`, `tool.spec.ts`.
- `packages/providers/provider-core/src/model-tool.ts`, `tool-call-assembler.ts`,
  `tool-call-assembler.spec.ts`, `generate-object.ts`, `generate-object.spec.ts`.
- `packages/providers/openai/src/message-mapping.spec.ts`.
- `packages/server/src/frontend-tool-bridge.ts`, `frontend-tool-bridge.spec.ts`,
  `tool-calling-executor.ts`, `tool-calling-executor.spec.ts`, `tool-frontend.e2e.spec.ts`.
- `packages/react/src/frontend-tool-hooks.ts`, `frontend-tool-hooks.spec.tsx`.
- `packages/ui/src/tool-activity.spec.tsx`.
- `examples/react-tools/`: package.json, project.json, tsconfig.json, vitest.config.ts,
  vite.config.ts, index.html, README.md; `src/`: `assets.d.ts`, `applications.ts`, `app.tsx`,
  `main.tsx`, `styles.css`, `backend.ts`, `server.ts`, `integration.spec.tsx`.
- `docs/adr/0010-canonical-tool-architecture.md`.
- All ten documents in `docs/phases/phase-05/`: Docs, Architecture, Implementation, Status,
  Testing, Decisions, API, Files, Issues, Handoff.

## Modified

- `packages/protocol/src/`: `ids.ts` (+`ToolCallId`/`createToolCallId`), `errors.ts` (+6
  error codes, +6 static factories), `message.ts` (`ContentPart` += `tool_call`/`tool_result`),
  `finish-reason.ts` (+`'tool_calls'`), `events.ts` (+4 event interfaces + union member),
  `serialization.ts` (+matching Zod schemas, +4 `eventSchemasByType` entries), `index.ts`
  (+exports), `serialization.spec.ts` (exhaustive-switch test extended), `errors.spec.ts`
  (+tool error factory tests).
- `packages/core/src/`: `executor.ts` (+`ExecutorContext.onToolEvent`), `runtime.ts` (drains
  `pendingToolEvents` after every step **and** in the `catch` block; suppresses empty-string
  deltas), `runtime.spec.ts` (+4 tests: drain-and-interleave, cancellation-safety,
  drain-before-throw regression, empty-delta suppression).
- `packages/providers/provider-core/src/`: `model-request.ts` (+`tools`), `model-runtime.ts`
  (+`tools`, +`tool_call.requested` handling in the retry loop), `model-stream-event.ts`
  (+`tool_call.requested` variant, +`ModelToolCall`), `model-executor.ts` (+exhaustive-switch
  case that throws), `index.ts` (+exports), `package.json` (+`zod` dependency),
  `model-executor.spec.ts` / `model-runtime.spec.ts` (+tests).
- `packages/providers/mock/src/mock-provider.ts` (+`MockProviderScenario.toolCalls`),
  `mock-provider.spec.ts` (+4 tests).
- `packages/providers/openai/src/`: `message-mapping.ts` (tool_call/tool_result mapping,
  replacing the Phase 2 `tool`-role rejection), `openai-provider.ts` (+tools param, +streamed
  tool-call assembly), `error-mapping.ts` (`'tool_calls'`/`'function_call'` → `'tool_calls'`),
  `openai-provider.spec.ts` (+3 tests).
- `packages/server/src/`: `app.ts` (+`toolRegistry`/`toolRuntimeDefaults` options, +tool-
  calling-executor selection in `buildRun()`, +`POST /runs/:runId/tool-results` route),
  `schemas.ts` (+`tools` field, +submit-tool-result schemas), `app.spec.ts` (+4 tests),
  `package.json`/`tsconfig.json`/`project.json` (+`@gixcopilot/tools` dependency/reference).
- `packages/client/src/`: `transport.ts` (+`tools`, +`submitToolResult`), `sse-transport.ts`
  (implements both), `client.ts` (+`tools` passthrough, +`submitToolResult` delegation),
  `client.spec.ts`/`sse-transport.spec.ts` (+tests).
- `packages/react/src/`: `internals.ts` (+`toolRegistry`/`toolRuntime`), `provider.tsx`
  (creates them, builds `resolveToolManifest`, exposes `useToolCalls`), `chat-store.ts`
  (+`toolCalls` snapshot field, +tool.* event handling, +`executeFrontendTool`, +per-call
  abort-controller cleanup, +`textOfContent` helper), `types.ts` (+`ToolCallState`,
  `ChatSnapshotBase.toolCalls`), `index.ts` (+exports), `package.json`/`tsconfig.json`/
  `project.json` (+`@gixcopilot/tools` + `zod` dependency/reference); five pre-existing spec
  files (`context-hooks.spec.tsx`, `context-model-integration.spec.tsx`, `provider.spec.tsx`,
  `state-hooks.spec.tsx`) updated to satisfy `CopilotClient`'s new required
  `submitToolResult` member and (in two files) a `textOf`/exhaustive-switch narrowing fix for
  the additive `ContentPart` union.
- `packages/ui/src/`: `components.tsx` (+`ToolActivity` component/props, +`CopilotComponents.
  ToolActivity` slot, +`ChatContent` wiring, +`textOfContent` helper), `labels.ts` (+3
  labels), `index.ts` (+exports), `components.spec.tsx` (fixture +`submitToolResult`).
- `examples/react-custom-ui/src/app.tsx` — added the same `textOfContent` narrowing helper
  required by the additive `ContentPart` union (mechanical, behavior-preserving).
- `examples/model-streaming/src/main.ts`, `examples/protocol-demo/src/main.ts` — added
  `tool.*` cases to each demo's exhaustive `CopilotEvent` switch (previously only Phase 1–4
  event types existed).
- `tools/vitest.shared.ts` — added the `@gixcopilot/tools` workspace alias.
- `eslint.config.js` — added the `scope:tools` module-boundary constraint; extended
  `scope:server`/`scope:react`/`scope:example` to permit depending on it. Updated the
  file-header comment.
- `tsconfig.json` (root) — added `packages/tools` and `examples/react-tools` references.
- `docs/PROJECT_STATUS.md`, `docs/DECISIONS.md`, `docs/CHANGELOG_PHASES.md`,
  `docs/architecture/overview.md` — Phase 5 status, ADR index entry, changelog entry, and
  the updated dependency-direction diagram.

No file under `packages/context` was modified — Phase 5 does not touch application context;
`useCopilotContext`/`useCopilotState` are unchanged. Generated `dist/`, `web-dist/`,
tsbuildinfo, and coverage output are ignored, as before. No commits were created by this
work; `git status`/`git diff` reflect the actual pending changes.
