# DevTools and observability

`@gixcopilot/telemetry` records traces, metrics and structured diagnostics (redacted by
default; modes `off`, `metadata-only`, `redacted`, `development-verbose`) and exports through
the OpenTelemetry API.

`@gixcopilot/devtools` projects a recording into inspectors: runs, messages, context budget,
state timeline, tools with firewall decision trails, approvals, RAG candidates and citations,
memory, agent trees, workflow graphs, events, traces and errors. `apps/devtools` is the UI.

- Development only: `createDevToolsPlugin(createDevTools({ source }), { enabled, authorize,
  resolveViewer })`. It refuses `NODE_ENV=production` without an explicit override, and the
  config layer rejects DevTools in production outright. It is read-only (no execution route).
- Production: OpenTelemetry to your collector, ratio sampling, Prometheus `/metrics`
  (token-protected, no tenant labels), structured JSON logs. The platform's **Traces** view
  shows the tenant-scoped recording of each API instance.
- Debug bundles: `exportBundle()` re-redacts; imports are inert data.

ADRs [0016](../adr/0016-telemetry-and-diagnostics-architecture.md),
[0017](../adr/0017-devtools-observes-the-runtime.md). Example: `examples/devtools`.
