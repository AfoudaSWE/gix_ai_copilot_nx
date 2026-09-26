# ADR 0016: Telemetry Port, OpenTelemetry, and the Internal Diagnostics Channel

## Status

Accepted (Phase 11).

## Context

Phase 11 must make every layer observable: model, context, tools, the firewall, approvals, RAG,
memory, state, agents and workflows. Phase 10 added OpenTelemetry spans to agents and workflows
directly. DevTools, the test harness and evals also need the *content* of what happened (the
firewall's stage outcomes, retrieval candidates, context exclusions), which spans alone do not
carry well. Much of that content is sensitive.

## Decisions

1. **One port, several adapters.** `@gixcopilot/telemetry` defines `TelemetryAdapter`
   (`startSpan`, `recordEvent`, `recordMetric`) with explicit parent `SpanHandle`s, not ambient
   context. Implementations: `createNoopTelemetry` (the default: shared prototypes, near-zero
   cost), `createOpenTelemetryAdapter` (the standard exporter path via `@opentelemetry/api`; no
   SDK or vendor bundled, so the host configures OTLP or any backend), and
   `createRecordingTelemetry` (bounded in-memory buffers for DevTools, tests and evals).
   `composeTelemetry` fans out to several adapters and isolates failures.
2. **Semantic conventions are ours, not a provider's.** `SPAN_NAMES` (`copilot.run`,
   `model.call`, `context.resolve`, `tool.execute`, `security.evaluate`, `approval.wait`,
   `rag.retrieve`, `memory.read`/`write`, `agent.run`/`delegate`/`handoff`,
   `workflow.run`/`step`, `job.execute`) and `ATTR` keys. The `copilot.*` attribute prefix is
   kept from Phase 10 so existing traces stay joinable.
3. **A versioned diagnostics channel, separate from the public protocol.** `DiagnosticEvent`
   (`diagnosticVersion: 1`) carries runs, wrapped protocol events, context resolutions, model
   calls, tool executions, firewall decisions, approvals, retrievals, memory operations, state
   patches, generative-UI requests, spans, metrics and logs. Implementation detail never enters
   `CopilotEvent`, which clients parse and which is a stable contract.
4. **Instrumentation wraps runtime seams; it never replaces them.** Wrappers for the model
   runtime, tool runtime, firewall, approval store, retriever, context engine, memory service
   and state store are duck-typed, so telemetry depends only on protocol. They return the
   original object untouched when telemetry is disabled. The firewall wrapper records the
   firewall's own result and never recomputes it. Agents and workflows forward the protocol
   events they emit to the diagnostics channel, so DevTools reads exactly what callers
   received.
5. **Safe by default.** Four modes: `off`, `metadata-only`, `redacted` (the default) and
   `development-verbose`. Secret-shaped keys and values are masked in every enabled mode. PII
   is masked except in verbose mode. Numeric counts under "token"/"auth" keys and booleans are
   not secrets. Redaction happens before anything is stored or exported.
6. **Head sampling applies to spans only.** `createRatioSampler` gives each run id a stable
   verdict. Diagnostic events are never sampled, because DevTools and evals need the complete
   record even when traces are sampled away.
7. **Audit is not trace.** Traces are engineering diagnostics: bounded, droppable, exportable.
   The Phase 7 audit sink remains the compliance record, and telemetry never writes to or
   replaces it. They can be joined through run and tool-call ids.

## Consequences

- Adding observability to a new layer means writing a wrapper, not changing the runtime.
- A host that configures nothing pays nothing (measured: no-op equals raw within noise).
- Recording costs about 0.2-0.3 ms per model call, which is negligible next to real model
  latency but is why recording is opt-in.
- Payload-dependent features (recorded replay, argument evals, groundedness) need a
  payload-capturing mode; `metadata-only` sessions are explicitly not replayable.
