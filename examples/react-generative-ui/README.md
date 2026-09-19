# Generative UI & shared-state example (Phase 6, real OpenAI)

Demonstrates `@gixcopilot/generative-ui` and its React adapter
(`useGenerativeComponent`, `useToolRenderer`, `useInvokeTool`, `useCopilotState`'s
`modelWritable`) end to end against a **real OpenAI model**: an "Applications" page registers
a trusted `ApplicationCard` component, a custom renderer for an ordinary Phase 5 tool, and an
AI-writable status filter, then a real chat lets the model render components, patch shared
state, and trigger a registered action - through the real client/server/model-runtime/tool-
runtime pipeline (`@gixcopilot/provider` + `@gixcopilot/provider-openai`), never a hardcoded
or prompt-matched fake response.

The model never generates executable code. It selects a registered component by name and
supplies schema-validated props (exactly like calling any other tool); it never sees a
component's source, and an unknown/invalid selection safely falls back instead of rendering
anything. No Action Firewall, RBAC, approval, OpenAPI, MCP, RAG, or agents - Phase 6 only.

## Requirements

- An [OpenAI API key](https://platform.openai.com/api-keys) with access to the configured
  model (defaults to `gpt-4o-mini`).
- Node and pnpm as used elsewhere in this repository.

## Setup

From the repository root:

```sh
pnpm install
cp examples/react-generative-ui/.env.example examples/react-generative-ui/.env
# edit examples/react-generative-ui/.env and set OPENAI_API_KEY=sk-...
pnpm build
pnpm --filter @gixcopilot/react-generative-ui server   # terminal 1 - demo backend on :4321
pnpm --filter @gixcopilot/react-generative-ui dev       # terminal 2 - Vite dev server on :5177
```

Open <http://127.0.0.1:5177>.

### Model selection

`OPENAI_MODEL` in `.env` selects the model (default `gpt-4o-mini`, see
`OPENAI_DEFAULT_MODEL` in `src/backend.ts`). Only the model *name* is ever forwarded into the
browser bundle (via `vite.config.ts`'s `loadEnv` -> `VITE_OPENAI_MODEL`) so the chat UI can
display it; the API key never leaves the server process - see **Security** below.

### If `OPENAI_API_KEY` is missing

`pnpm server` fails fast with a clear message and a non-zero exit code instead of silently
falling back to a mock response:

```text
OpenAI provider is enabled but OPENAI_API_KEY is not configured.

Create a local .env file based on .env.example and provide your OpenAI API key:

  cp .env.example .env
  # then edit .env and set OPENAI_API_KEY=sk-...
```

## Try it

Try the suggested prompts or type your own:

- **"Show APP-1024"** - the model selects the registered `ApplicationCard` component
  (Section 66, no developer-defined tool involved) and it renders inline with validated
  props.
- **"Show all applications as cards"** - multiple independent component requests in one
  response (Section 25).
- **"What is the status of APP-2048?"** - an ordinary backend tool
  (`applications.getStatus`) whose result is shown through a custom `useToolRenderer` status
  badge instead of the generic "✓ completed" row (Section 26-31).
- Click **Open** on a rendered card - calls the registered `navigation.openApplication`
  frontend tool *directly*, through `useInvokeTool()`, with **no** additional model turn
  (Section 32-35, 105-106).
- **"Filter to approved"** - the model proposes a validated patch to the shared,
  AI-writable `applicationFilters` state (Section 38, 45); the visible table updates.
  Manually changing the dropdown first, then asking the model to patch again based on what
  it saw earlier, demonstrates the stale-revision conflict path (Section 46) - the AI's
  patch is safely rejected, and the UI's own choice is never overwritten.

Since this now talks to a real model, exact wording and tool-selection choices can vary
slightly between runs; the `assistantInstructions` global context in `src/app.tsx` steers it
toward using the registered component and tools instead of describing things in prose.

## Tool data source

Both `applications.getStatus` (backend tool) and `navigation.openApplication` (frontend
tool) read from the same in-memory `APPLICATIONS` array in `src/applications.ts`. A
production app would replace that array with a real database/service call inside the same
`execute()` bodies; nothing about the tool definitions or the model/generative-UI/state
wiring would change.

## Tests

`pnpm --filter @gixcopilot/react-generative-ui test` runs the deterministic, credential-free
integration suite (`src/integration.spec.tsx`) against `createMockDemoServer` - a mock
`ModelProvider` (`src/backend.ts`) that pattern-matches the user's text and requests the
matching reserved tool call, never a real network call. This suite is what CI runs; it never
requires an API key and never talks to OpenAI.

`src/openai-smoke.spec.ts` is an **optional** real-provider smoke test that only runs when
`OPENAI_API_KEY` is set in the environment (`describe.skipIf`) - otherwise it is reported as
SKIPPED, never FAILED. It makes real, small network calls to OpenAI and costs a tiny amount
of real money when it runs:

```sh
OPENAI_API_KEY=sk-... pnpm --filter @gixcopilot/react-generative-ui test -- openai-smoke
```

## Security

- `OPENAI_API_KEY` is read only in `src/backend.ts`'s `resolveOpenAiConfig()`, which runs
  exclusively in `src/server.ts` (a Node process) - it is never imported by, bundled into, or
  reachable from any browser code, and `vite.config.ts` never defines it for the client
  build. Verify with `pnpm build` and grep the resulting `web-dist/` output for the string
  `OPENAI_API_KEY` or your key value - it should not appear.
- `.env` (and `.env.*.local`) are gitignored at the repository root; never commit a real key.
- Costs real money per request once configured - keep an eye on usage while experimenting.
