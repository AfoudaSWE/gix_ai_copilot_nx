# Application context example (Phase 4)

Demonstrates `@gixcopilot/context` and its React adapter (`useCopilotContext`,
`useCopilotState`) end to end: an "Applications" page registers page/user/selected-entity
context and exposes its status filter as state-derived context, then a real chat answers
questions about what is currently on screen - through the real client/server/model-runtime
pipeline, not a hardcoded UI response.

No tools, no generative UI, no agents - Phase 4 only. The Copilot only knows what the page
explicitly registered.

From the repository root:

```sh
pnpm install
pnpm build
pnpm --filter @gixcopilot/react-context server   # terminal 1 - deterministic demo backend on :4319
pnpm --filter @gixcopilot/react-context dev       # terminal 2 - Vite dev server on :5175
```

Open <http://127.0.0.1:5175>. Click an application row to select it, change the status
filter, and ask the copilot "What application am I looking at?" or "What are the current
filters?".

`pnpm --filter @gixcopilot/react-context test` runs the real HTTP/SSE integration test:
selecting an application changes the resolved context, and the (deterministic,
non-network) `context-aware` provider's answer is derived entirely from what it received in
the request - see `src/backend.ts` and `src/integration.spec.tsx`.

The demo provider (`src/backend.ts`) is not a real LLM - it parses the `id`/`status`/
`applicantName` fields out of the leading `system` message's serialized context and
templates a sentence from them, so this example stays credential-free and deterministic
while still proving context reaches the model request unmodified.
