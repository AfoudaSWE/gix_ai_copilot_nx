# ADR 0017: DevTools Observes the Runtime; It Never Becomes It

## Status

Accepted (Phase 11).

## Context

DevTools has to explain runs, context, tools, security, RAG, memory, agents and workflows. The
risks are drift (a DevTools-only view that disagrees with what the runtime did), privilege (a
debugging surface that leaks data or grants actions), and coupling (production depending on a
debugging endpoint).

## Decisions

1. **`@gixcopilot/devtools` is a pure projection.** `projectSession(snapshot, viewer)` turns
   recorded diagnostics into a session. Every inspector (`toolTimeline`, `firewallTimeline`,
   `agentTree`, `workflow`, `traces`, ...) is a pure function of that session. None evaluates
   policy, re-resolves context or re-runs retrieval. The security inspector shows the
   firewall's recorded decision. Its only dependencies are protocol and telemetry, enforced by
   the Nx module boundary.
2. **Viewer scoping is strict.** With a `tenantId`, only events that carry that tenant, or that
   provably belong to a run tree that does, are visible; unknown ownership is never treated as
   permission. With a `subject`, other users' memory is hidden. Live subscriptions and exports
   use the same scoping.
3. **The transport is opt-in and read-only.** `@gixcopilot/devtools/server` registers nothing
   unless `enabled`. It requires `authorize`, unless `allowUnauthenticated` is set explicitly.
   It refuses to start under `NODE_ENV=production` without `allowInProduction`. It exposes only
   `GET` session, run, export and SSE stream routes. No route executes a tool, approves,
   resumes, cancels or mutates anything, so manual tool execution is deliberately not provided.
4. **Exports never loosen the recording.** A debug bundle is re-sanitized to the stricter of the
   requested mode and the recorded mode. Import validates structure and yields inert data.
5. **The UI is a separate app.** `apps/devtools` consumes the HTTP API or an imported bundle and
   imports only the browser-safe devtools core. The token travels in a header, never in a URL
   (the SSE stream is read with `fetch` for that reason). Raw payload view requires a
   `development-verbose` recording.
6. **State time travel is a debug reconstruction, not a rollback.** The UI always shows that
   notice.

## Consequences

- Removing DevTools changes nothing about execution (tested with DevTools disabled, in the
  server and in the example app).
- DevTools can only show what was recorded; gaps in instrumentation show up as gaps in the UI
  rather than being papered over.
- Because tool-call ids are unique only within a run, all joins key on run id plus call id.
