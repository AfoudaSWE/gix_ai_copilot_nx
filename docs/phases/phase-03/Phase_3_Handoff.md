# Phase 3 Handoff

The new seam is `@gixcopilot/react` over the existing client, with `@gixcopilot/ui` as an
optional consumer. Use the headless package for fully custom markup; use the UI package's
component slots and CSS tokens when adapting the provided views.

```sh
pnpm install
pnpm build
pnpm demo:react
```

Open <http://127.0.0.1:5173> (interface lab) or <http://127.0.0.1:5174> (headless example).
The shared server is loopback-only at 4318. The lab shows popup/chat/sidebar, light/dark/
system themes, RTL and mock slow/fail-once scenarios. No provider key is needed. Credentials
for any real provider must remain in a separately configured server.

For validation:

```sh
pnpm validate
pnpm exec playwright install chromium
pnpm test:e2e
node tools/measure-react.mjs
```

All newly exported APIs are documented in [API](Phase_3_API.md); lifecycle choices in
[Architecture](Phase_3_Architecture.md); test evidence and limits in
[Testing](Phase_3_Testing.md) and [Issues](Phase_3_Issues.md).

Maintenance constraints:

- Keep transport/parser/model logic in the existing framework-independent layers.
- Client/model/thread configuration replacement cancels and clears local state. Preserve
  injected client identity unless a session reset is intended.
- Do not silently change retry/regenerate replay semantics or the acceptance-boolean API.
- Keep correlation/token checks around every async run; a stopped run must not update its
  successor. Stop must continue invoking real client cancellation.
- Preserve external-store snapshot identity, narrow subscriptions and StrictMode cleanup.
- Untrusted model text must never become HTML, generated JS, imported code or executable
  React. Custom slots accept only host-registered component references.
- CSS is explicitly imported once; token overrides must preserve contrast. Popup modality
  and sidebar nonmodality are intentional differences.

The repository's existing Phase 1–2 APIs were not changed. No git commits, package
publication or deployment were performed. Work remains in the working tree for review.

**Phase 04 — Application Context & State: LOCKED / NOT STARTED.** No `useCopilotContext`,
`useCopilotState`, context engine, application synchronization or future-phase feature has
been implemented. Starting another phase requires a new explicit user instruction.
