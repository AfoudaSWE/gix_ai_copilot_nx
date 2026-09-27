# @gixcopilot/agents

Agent runtime for the AI Copilot SDK (Phase 10): versioned agent definitions, an agent registry
with graph validation, deterministic and model-based routing, delegation and handoff with
least-privilege tool/knowledge/memory intersection, planning, and run limits (iterations, tool
calls, delegations, depth). Agents run on the same model runtime, tool runtime and Action
Firewall as everything else; an agent never gains authority the caller does not have.

```sh
pnpm add @gixcopilot/agents @gixcopilot/provider @gixcopilot/tools @gixcopilot/security
```

Main entry points:

| Export | Purpose |
| --- | --- |
| `defineAgent`, `createAgentRegistry`, `validateAgentGraph` | Declare agents and validate the delegation graph |
| `createAgentRuntime` | Run an agent (model loop, tools through the firewall, delegation, handoff) |
| `createDeterministicRouter`, `createModelBasedRouter` | Pick the agent for a request |
| `createPlanner`, `executePlan` | Structured plans validated before execution |
| `DEFAULT_AGENT_LIMITS`, `resolveAgentLimits` | Budget limits |
| `createAgentTestHarness` | Test utility (deterministic model, recorded events) |

See [docs/guides/agents.md](../../docs/guides/agents.md), ADR 0015 and `examples/multi-agent`.

Not responsible for: durable multi-step execution (use `@gixcopilot/workflows`), authorization
decisions (`@gixcopilot/security`), model provider SDKs (provider adapters).

## Documentation

- [agents guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/agents.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/agents)

## License

MIT
