---
name: agent-architecture
description: Future agent architecture principles - agent definition, lifecycle, delegation/handoff, planner/executor separation, and multi-agent orchestration, without coupling the core to any external agent framework. Load when designing agent or multi-agent functionality.
---

# Purpose

Define how agents are modeled as a first-class concept in the SDK's own runtime, so
multi-agent orchestration is native to the protocol rather than bolted on top of a
third-party framework.

# When to Apply

Designing an agent definition, agent lifecycle, delegation/handoff between agents, or any
multi-agent orchestration/workflow logic.

# Required Rules

- An agent is defined declaratively: instructions, model configuration, allowed tools
  (see [[tool-system]]), knowledge sources (see [[rag]]), and state — not as an opaque
  imperative script.
- The agent runtime is built on this project's own protocol and runtime (see
  [[protocol-design]], [[ai-runtime]]) — do not take a hard dependency on an external agent
  framework (e.g. LangChain) inside the core; if such integration is ever needed, it is an
  adapter, per [[project-architecture]].
- Agent lifecycle is explicit and observable: created → running → waiting-on-tool →
  waiting-on-approval (see [[hitl]]) → completed/failed/cancelled — every transition is a
  protocol event.
- Delegation/handoff between agents is a modeled operation (not an implicit tool call side
  effect): a handoff carries context, states the reason, and produces an auditable event.
- Planner/executor separation is a supported pattern, not a mandatory shape: an agent
  responsible for planning is architecturally distinct from an agent/tool responsible for
  executing a step, so either can be swapped independently.
- Long-running agent execution is designed for interruption and resumption from persisted
  state — a process restart must not lose an in-progress agent run silently.
- Specialist agents are scoped by capability (tools/knowledge available to them) using the
  same permission metadata as [[tool-system]] and [[security]] — an agent does not
  implicitly inherit every tool in the system.
- Multi-agent orchestration/routing decisions are logged as protocol events for later
  inspection in [[devtools]] and [[observability]].

# Architecture / Patterns

```text
Agent Definition (instructions, model, tools, knowledge, state)
        ↓ executed by
Agent Runtime (lifecycle, delegation, handoff)
        ↓ orchestrated by
Orchestration / Routing layer (planner/executor, specialist routing, workflows)
```

Handoff shape: `{ fromAgent, toAgent, reason, contextSnapshot, correlationId }` — always
explicit, never an implicit side effect of a tool call.

# Anti-Patterns

- Hardwiring a specific third-party agent framework's runtime into `@gixcopilot/agents`.
- An agent that silently gains access to every registered tool by default.
- A "handoff" implemented as one agent directly calling another's internal function with no
  protocol event or audit trail.
- Long-running agent state held only in process memory with no persistence/resumability.

# Validation Checklist

- [ ] Agent is defined declaratively (instructions/model/tools/knowledge), not as opaque code
- [ ] No external agent framework is a hard dependency of the core agent runtime
- [ ] Lifecycle transitions are explicit protocol events
- [ ] Handoffs are modeled operations with reason and context, not implicit side effects
- [ ] Agent's tool/knowledge access is explicitly scoped, not inherited by default
