# `@gixcopilot/telemetry`

Framework independent observability adapters and diagnostics for copilot runs. The public API is exported from `src/index.ts`.

Use `createNoopTelemetry()` when diagnostics are disabled, `createRecordingTelemetry()` for a bounded in-memory session, or `createOpenTelemetryAdapter()` for OpenTelemetry spans and metrics. `composeTelemetry()` sends records to multiple adapters. Instrumentation helpers wrap model, tool, firewall, approval, retrieval, context, memory, and state boundaries without changing their runtime contracts. `recordRun()` and `recordProtocolEvent()` capture run and wire event diagnostics.

The default recording mode is `redacted`. Payload capture depends on the selected mode; secret-shaped values are scrubbed in every enabled mode. Correlation and parent spans can be passed through `withTelemetryMetadata()`.

This package does not execute models or tools, enforce authorization, persist traces, or serve DevTools endpoints. The Action Firewall remains the source of security decisions. Hosts choose their exporter and control access to recorded sessions.
