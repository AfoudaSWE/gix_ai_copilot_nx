# Generative UI & shared-state example (Phase 6)

Demonstrates `@gixcopilot/generative-ui` and its React adapter
(`useGenerativeComponent`, `useToolRenderer`, `useInvokeTool`, `useCopilotState`'s
`modelWritable`) end to end: an "Applications" page registers a trusted `ApplicationCard`
component, a custom renderer for an ordinary Phase 5 tool, and an AI-writable status filter,
then a real chat lets the model render components, patch shared state, and trigger a
registered action - through the real client/server/model-runtime/tool-runtime pipeline, not
a hardcoded UI response.

The model never generates executable code. It selects a registered component by name and
supplies schema-validated props (exactly like calling any other tool); it never sees a
component's source, and an unknown/invalid selection safely falls back instead of rendering
anything. No Action Firewall, RBAC, approval, OpenAPI, MCP, RAG, or agents - Phase 6 only.

From the repository root:

```sh
pnpm install
pnpm build
pnpm --filter @gixcopilot/react-generative-ui server   # terminal 1 - demo backend on :4321
pnpm --filter @gixcopilot/react-generative-ui dev       # terminal 2 - Vite dev server on :5177
```

Open <http://127.0.0.1:5177>. Try the suggested prompts or type your own:

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

`pnpm --filter @gixcopilot/react-generative-ui test` runs the real HTTP/SSE integration
tests: generative component rendering (single and multiple), the unknown-id fallback, the
interactive direct-invocation action, a valid AI state patch, and the stale-revision conflict
path - see `src/backend.ts` and `src/integration.spec.tsx`.

The demo provider (`src/backend.ts`) is not a real LLM - it pattern-matches the user's text
and requests the matching reserved tool call (`ui.render.applicationCard`,
`applications.getStatus`, or `state.patch.applicationFilters`), deterministically and
credential-free, mirroring how `@gixcopilot/provider-mock` and the Phase 5 examples already
avoid any real network call.
