# DevTools app (`@gixcopilot/devtools-app`)

The DevTools UI: a React app that inspects a running copilot through the DevTools API, or opens
an exported debug bundle offline.

```sh
SEED_SCENARIO=1 pnpm --filter @gixcopilot/devtools-demo start   # a host with DevTools enabled on :4100
pnpm --filter @gixcopilot/devtools-app dev                      # http://127.0.0.1:5180
```

Enter the host's DevTools token and choose **Connect**. The dev server proxies `/devtools` to
`DEVTOOLS_TARGET` (default `http://127.0.0.1:4100`), so no cross-origin access is opened on the
host. **Live** follows the SSE stream; it is read with `fetch` so the token travels in a header,
never in a URL. **Import debug bundle** opens a file from `/devtools/export` or
`pnpm --filter @gixcopilot/devtools-demo trace` offline.

## Panels

Overview, Runs (with errors), Messages, Context (budget, per-scope tokens, priority, truncation,
exclusion reasons), State (revision timeline and a debug-only reconstruction), Tools (phase
timeline and the recorded firewall decision, including blocked calls), Generative UI, RAG
(pipeline, candidates, ACL exclusions, citations), Memory, Agents (tree, selection reason,
visible tools, calls, denials, tokens, latency; routing, delegations, handoffs), Workflows (step
graph, pauses, retries, checkpoints, compensation, approvals), Security (firewall stage trail and
approvals), Events (category, severity and free-text filters, pagination, detail view), Traces
(span waterfall), and Evals (open an eval report JSON from `@gixcopilot/evals`).

Selecting a run in **Runs**, or in the sidebar selector, scopes the other panels.

## Safety

- Read-only. There is no control that executes a tool, approves anything, resumes a workflow or
  changes state. Seeing an action in DevTools grants no authority.
- **Safe view by default.** Recorded payloads stay hidden. **Raw view** is available only for
  sessions recorded in `development-verbose` mode, and secrets are masked even then.
- Imported bundles are data only; nothing in them is executed.
- The app imports only the browser-safe `@gixcopilot/devtools` core, never server or runtime
  code.

## Accessibility

Landmarks, a skip link, a vertical ARIA tablist (arrow keys, Home and End), focus moved to each
panel heading, a polite status region, table captions and header scopes, text on every status
badge (never color alone), visible focus, light and dark themes, `prefers-reduced-motion`, an
RTL toggle (logical CSS properties throughout), and a stacked layout on narrow screens. Covered
by `src/app.spec.tsx` (jsdom) and `tests/browser/devtools.spec.ts` (Chromium, including phone
width).
