# @gixcopilot/headless

The framework-neutral chat layer shared by `@gixcopilot/react` and `@gixcopilot/angular`
(extracted from the React SDK in Phase 12 so the Angular adapter reuses it instead of forking it).

| Export | Purpose |
| --- | --- |
| `createChatStore(client, model?, threadId?, resolveContext?, resolveTools?, toolRuntime?)` | Immutable chat snapshot + `subscribe`/`getSnapshot` + stable actions (send, stop, retry, regenerate, clear, approve, reject, invokeTool). Consumed by React's `useSyncExternalStore` and Angular signals |
| `createCopilotParts(options)` / `clearCopilotParts(parts)` | One copilot's context registry and engine, state store, frontend tool registry and runtime, generative-UI registry |
| `createContextMessageResolver`, `createToolManifestResolver` | What each run sends: resolved context and the enabled frontend tool manifest (nothing when nothing is registered) |
| `toGenerativeUIRequests` | Projects tool calls onto requests for *registered* components only |
| `ChatSnapshot`, `CopilotMessage`, `ToolCallState`, `ApprovalState`, `AgentRunState`, `WorkflowRunState`, … | Shared state types (re-exported unchanged by `@gixcopilot/react`) |

Application code normally uses a framework adapter; use this package directly to build an
adapter for another framework. No DOM access, no framework imports.
