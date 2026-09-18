---
name: observability
description: OpenTelemetry-based tracing and metrics - runs, model calls, tools, RAG, workflows, and approvals, plus latency/token/cost/error metrics with correlation IDs. Load when instrumenting any part of the runtime.
---

# Purpose

Define a consistent observability foundation so every layer of the system (runtime,
tools, RAG, workflows, approvals) is traceable and measurable through one standard.

# When to Apply

Instrumenting new runtime code, adding a metric, or wiring tracing into a new subsystem.

# Required Rules

- OpenTelemetry is the standard for tracing and metrics; do not introduce a second,
  parallel tracing/metrics library without a documented reason (see [[dependency-policy]]).
- Every unit of work that matters for debugging or billing gets a span: a `Run`, a model
  call, a tool execution, a RAG retrieval, a workflow step, and an approval wait — nested
  correctly so a single run's trace shows the full causal chain.
- Every span/log carries a correlation id tying it back to the `Run`/`Thread` it belongs to
  (see [[protocol-design]]) — logs and traces must be joinable, not independent streams.
- Required metrics at minimum: latency (per span kind), token usage, estimated cost, error
  rate, retry count, and tool execution duration — captured consistently across providers
  and tool origins.
- Logs are structured (not free-form strings) and never include secrets or raw PII, per
  [[security]].
- Approval waits ([[hitl]]) are represented as spans with explicit start/end so the time
  spent waiting on a human is visible and distinguishable from system latency.
- Observability data itself respects tenant isolation — one tenant's traces/metrics must
  not be queryable by another.
- Instrumentation must not materially degrade the hot path (streaming latency); prefer
  batched/async export over synchronous blocking calls to the telemetry backend.

# Architecture / Patterns

```text
Run span
 ├─ Model call span (per provider call, includes tokens/cost/latency)
 ├─ Tool execution span (per tool call, includes firewall stage timings)
 ├─ RAG retrieval span (includes retrieval + rerank timings)
 ├─ Approval wait span (see [[hitl]])
 └─ Workflow step spans (see [[agent-architecture]])
```

All spans propagate the run/thread correlation id as a standard attribute.

# Anti-Patterns

- A second custom logging/metrics pipeline built alongside OpenTelemetry "for simplicity."
- Logging tool arguments or model prompts verbatim at info level without redaction review.
- A trace with no correlation id, unjoinable to the run it belongs to.
- Synchronous, blocking telemetry export on the streaming hot path.
- Metrics/traces queryable across tenant boundaries.

# Validation Checklist

- [ ] New subsystem work is wrapped in an OTel span with correct parent/child nesting
- [ ] Correlation id is attached and propagated correctly
- [ ] Latency, token, cost, error, and retry metrics are captured where applicable
- [ ] No secret or raw PII appears in a span attribute or log line
- [ ] Telemetry export does not block the streaming hot path
