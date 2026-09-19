# react-tools example

Demonstrates Phase 5 (Tools & Agent Actions) end to end, using only the deterministic mock-style
provider in `src/backend.ts` - no external AI API key is required.

Covers:

- **Backend tool** - `applications.getStatus`, executed server-side via `@gixcopilot/tools`'
  `ToolRuntime`.
- **Frontend tool** - `navigation.openApplication`, registered with `useFrontendTool` and
  executed in the browser.
- **Context + tool** - "What is its status?" resolves the currently selected application from
  Phase 4 application context, without repeating the id.
- **Tool error** - asking about `APP-ERROR` makes the backend tool throw; the model receives a
  normalized `tool_result` error and explains the failure instead of crashing the run.
- **Tool cancellation** - `applications.runAudit` takes ~2 seconds; pressing Stop mid-call ends
  the run cleanly with no late `tool.completed`/`run.completed`.

## Run it

```bash
pnpm --filter @gixcopilot/react-tools run server   # starts the demo backend on :4320
pnpm --filter @gixcopilot/react-tools run dev       # starts the Vite dev server on :5176
```

Then open http://127.0.0.1:5176 and try the suggested prompts, or type your own (e.g. "Open
APP-1024", "Run an audit on APP-2048").

## Test it

```bash
pnpm --filter @gixcopilot/react-tools run test
```

`src/integration.spec.tsx` exercises every scenario above against a real (in-process,
ephemeral-port) server and a real HTTP/SSE client - nothing is mocked above the deterministic
provider itself.
