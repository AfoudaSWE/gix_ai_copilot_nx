# devtools example

One application whose chat, tools, Action Firewall, approvals, generative UI, RAG, memory,
multi-agent orchestration, workflow, context and shared state all record into **one** telemetry
session, which DevTools inspects. DevTools is observation only: with it disabled, the same app
behaves identically.

## Run

```sh
SEED_SCENARIO=1 pnpm --filter @gixcopilot/devtools-demo start    # app + DevTools API on :4100
pnpm --filter @gixcopilot/devtools-app dev                       # the DevTools UI (proxies /devtools)
```

The API is `GET /devtools/session`, `/devtools/runs/:runId`, `/devtools/export` and
`/devtools/stream` (SSE). It requires `Authorization: Bearer $DEVTOOLS_TOKEN` (default
`local-dev-token`, for local use only). An optional `x-devtools-tenant` header scopes the view to
one tenant. `MODEL_PROVIDER=openai OPENAI_API_KEY=...` uses the real provider instead of the
scripted models.

## Generate a trace by execution

```sh
pnpm --filter @gixcopilot/devtools-demo trace   # -> output/trace-bundle.json
```

This runs the whole scenario for real, then exports a sanitized debug bundle (`redacted` mode).
Import it in the DevTools UI. Nothing in it is hand-written.

## The scenario

1. An officer asks the chat to show APP-1024 as a card and reassign it. The server calls
   `applications.get`, renders `ui.render.applicationCard`, and requests `applications.reassign`.
   The firewall requires supervisor approval, a supervisor approves over HTTP, and the run
   completes.
2. An applicant asks to delete APP-1024, and the firewall denies it (`PERMISSION_DENIED`).
3. The applicant asks a multi-part question. The orchestrator fans out to application, payment
   and knowledge specialists in parallel, using RAG with an ACL-restricted document and memory.
4. A reassignment workflow validates, reads, pauses for supervisor approval, then resumes and
   completes.
5. Context resolves with a restricted item excluded, and shared state takes one patch plus a
   stale-revision conflict.

## What the test checks

`src/integration.spec.ts` reads the session over the authenticated endpoint and checks:

- the chat request can be followed end to end;
- for each agent: why it ran, its model, visible tools, tool calls, tokens, latency and result;
- the firewall trail: identity, role, tenant, approval level and final state;
- why each chunk reached the model;
- context exclusions, the state conflict, the workflow pause and resume, and trace nesting;
- auth, tenant scoping, an importable export, and that the app still works with DevTools off.
