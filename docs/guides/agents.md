# Agents

`@gixcopilot/agents` runs agents on the same model runtime, tool runtime and Action Firewall
as chat. An agent never gains authority its caller does not have.

- `defineAgent({ id, name, instructions, tools, model, knowledge, memory, delegation, limits })`
  and `createAgentRegistry()` / `validateAgentGraph()`.
- `createAgentRuntime(...)` runs the model and tool loop with limits (iterations, tool calls,
  delegations, depth).
- Routing: `createDeterministicRouter`, `createModelBasedRouter`. Delegation (A → B → A) and
  handoff (A → B) intersect tools, knowledge and memory with the delegator's ceiling (least
  privilege).
- Planning: `createPlanner` + `executePlan` with schema-validated plans.
- UI: `useAgentRuns()`, `useAgentDelegations()` (React) and `agentRuns` (Angular) expose
  structured progress, never chain-of-thought.
- Platform: agents are defined in code; the platform shows them and can only **narrow** them
  (tools, model, limits) through versioned overrides.

`npx aicopilot add agent support` scaffolds a definition and a test. Example:
`examples/multi-agent`. ADR [0015](../adr/0015-agent-and-workflow-runtime-architecture.md).
