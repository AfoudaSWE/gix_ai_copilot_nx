---
name: devtools
description: Future AI DevTools panels - messages, agent, context, state, tools, RAG, events, trace, security, tokens, cost, evals - context/tool inspection, trace visualization, and conversation replay. Load when building developer-facing debugging tooling.
---

# Purpose

Define the developer-facing inspection surface for debugging copilot/agent behavior during
development, built on the same protocol and observability data the runtime already
produces.

# When to Apply

Building or modifying any DevTools panel, inspector, trace visualization, or replay
feature.

# Required Rules

- DevTools reads from the same protocol events ([[protocol-design]]) and telemetry
  ([[observability]]) the runtime already emits — it must not require a parallel, DevTools-
  specific instrumentation path that can drift from production behavior.
- Planned panels are scoped by concern and must not blur together: Messages, Agent,
  Context, State, Tools, RAG, Events, Trace, Security, Tokens, Cost, Evals.
- The Context inspector shows exactly what was assembled and sent for a given run,
  respecting [[context-engine]]'s sensitivity rules — DevTools is still bound by
  [[security]]; it must not surface data a viewing developer isn't authorized to see in a
  shared/staging environment.
- The Tool inspector shows the full firewall pipeline decision trail for a given tool call
  (per [[action-firewall]]) — allow/deny/approval outcome per stage, not just the final
  result.
- Trace visualization and the event timeline reconstruct a run from its correlation id
  using [[observability]] spans and [[protocol-design]] events — not a separate log format.
- Conversation replay reconstructs a past run's messages/events for inspection; it must not
  re-execute real tool calls or side effects — replay is read-only by default.
- State debugging shows shared/application state at a point in time without allowing an
  uncontrolled mutation path that bypasses normal state-update flows.
- DevTools must be clearly separated from production surfaces (dev-only build, explicit
  enablement) so it is never inadvertently shipped as an attack surface exposing internal
  system state to end users.

# Architecture / Patterns

```text
Runtime protocol events + OTel traces (existing, not DevTools-specific)
        ↓ consumed (read-only) by
DevTools panels (Messages, Agent, Context, State, Tools, RAG, Events, Trace, Security, Tokens, Cost, Evals)
```

# Anti-Patterns

- A DevTools-only logging path that diverges from what production actually records.
- Conversation replay that re-triggers real tool execution/side effects.
- A Context inspector that ignores sensitivity classification and shows redacted data in
  the clear.
- Shipping DevTools panels reachable in a production end-user build.

# Validation Checklist

- [ ] Panel reads existing protocol/telemetry data, not a parallel instrumentation path
- [ ] Tool inspector shows full firewall stage-by-stage decisions, not just pass/fail
- [ ] Replay is read-only and does not re-execute side effects
- [ ] DevTools respects [[security]] sensitivity rules for displayed data
- [ ] DevTools is excluded from production end-user builds by default
