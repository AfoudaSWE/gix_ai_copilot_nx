# Phase 10 handoff

Use the [completion record](Phase_10_Status.md), [test evidence](Phase_10_Testing.md),
[API](Phase_10_API.md), and [limits](Phase_10_Issues.md).

## Run from the workspace root

```powershell
pnpm install
pnpm build
pnpm --filter @gixcopilot/agents test
pnpm --filter @gixcopilot/workflows test
pnpm --filter @gixcopilot/checkpoint-postgres test   # real Postgres via Testcontainers; auto-skips without Docker
pnpm --filter @gixcopilot/jobs test                  # real Redis via Testcontainers; auto-skips without Docker
pnpm --filter @gixcopilot/react test
```

## Run the examples

```powershell
pnpm --filter @gixcopilot/agent-basic-demo demo
pnpm --filter @gixcopilot/multi-agent-demo demo
pnpm --filter @gixcopilot/workflow-approval-demo demo
pnpm --filter @gixcopilot/workflow-compensation-demo demo
```

Each uses the deterministic mock model provider by default. For a real OpenAI run (any
example):

```powershell
$env:MODEL_PROVIDER='openai'
$env:OPENAI_API_KEY='sk-...'
pnpm --filter @gixcopilot/agent-basic-demo demo
Remove-Item Env:MODEL_PROVIDER,Env:OPENAI_API_KEY
```

Each example's own `pnpm test` runs its integration suite (zero network, zero Docker
required) — see each example's `README.md` for what it specifically proves.

## Running the real-infrastructure suites

Both require Docker reachable on the host (`docker info` must succeed):

```powershell
pnpm --filter @gixcopilot/checkpoint-postgres test
pnpm --filter @gixcopilot/jobs test
```

Both `describe.skipIf(!dockerAvailable)` — a clean skip (not a failure) when Docker is
unreachable. Both were run for real this session (see [Testing](Phase_10_Testing.md) for the
exact results) before Docker became unavailable in this particular environment for the final
validation pass.

## Building your own agent

```ts
import { defineAgent, createAgentRegistry, createAgentRuntime } from '@gixcopilot/agents';
import { createModelRuntime } from '@gixcopilot/provider';
import { createToolRuntime, createStaticToolResolver } from '@gixcopilot/tools';

const supportAgent = defineAgent({
  id: 'support',
  name: 'Support Agent',
  instructions: 'Help users understand the product.',
  tools: ['tickets.get', 'tickets.create'],
  knowledge: { sources: ['product-docs'] },
});

const registry = createAgentRegistry();
registry.register(supportAgent);

const resolver = createStaticToolResolver([...]);
const runtime = createAgentRuntime({
  registry,
  modelRuntime: createModelRuntime({ providers: [...] }),
  toolRuntime: createToolRuntime({ resolver }),
  toolResolver: resolver,
});

const result = await runtime.run({
  agent: 'support',
  input: { message: 'How do I reset my password?' },
  securityContext, // always a trusted, server-derived SecurityContext - never from the model
});
```

**Wire the real Action Firewall** the same way `examples/multi-agent` does — pass a
`toolRuntime` built with `createToolRuntime({ resolver, middleware:
[createActionFirewallMiddleware({ firewall, resolver, getContext })] })`, exactly as
`@gixcopilot/server` already does for ordinary chat.

**An orchestrator that only delegates still needs to declare the union of its specialists'
tools** as its own `tools` list — see [Architecture](Phase_10_Architecture.md)'s "Least
privilege" section and `examples/multi-agent/src/agents.ts` for why.

## Building your own workflow

```ts
import { defineWorkflow, functionStep, toolStep, approvalStep, createWorkflowEngine } from '@gixcopilot/workflows';

const workflow = defineWorkflow({
  id: 'my-workflow',
  version: '1',
  state: myStateSchema,
  initialState: (input) => ({ ... }),
  steps: [
    functionStep({ id: 'validate', run: ({ state }) => ({ ...state, validated: true }) }),
    approvalStep({ id: 'approve', action: 'do-thing', summary: () => 'Approve the thing' }),
    toolStep({ id: 'apply', dependencies: ['approve'], tool: 'do.thing', input: () => ({}), updateState: (s) => s }),
  ],
});

const engine = createWorkflowEngine({ toolRuntime, agentRuntime, approvals, checkpointStore });
engine.register(workflow);

const started = await engine.start({ workflowId: 'my-workflow', input: { ... }, securityContext });
// ... later, after a real human approval decision ...
const resumed = await engine.resume(started.workflowRunId, { securityContext });
```

**For real durability**, pass `checkpointStore: createPgCheckpointStore({ connectionString
})` and `jobExecutor: createBullMQJobExecutor({ connection })` — both are drop-in
replacements for the in-memory/inline defaults; nothing else about the workflow definition
or call sites changes.

## Troubleshooting

- `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS`: check `pnpm-workspace.yaml`'s
  `allowBuilds` map for a placeholder string instead of a real boolean — this was the actual
  repository's state before this review (see [Issues](Phase_10_Issues.md)).
- A delegated specialist's tool calls are all denied even though the specialist declares the
  right tools: the delegating/orchestrating agent's own `tools` list is the real ceiling —
  add the specialist's tool names to the orchestrator's own declaration too (a deliberate,
  tested design choice, not a bug — see Architecture's "Least privilege" section).
- `checkpoint-postgres`/`jobs` integration tests skip: Docker is unreachable in that
  environment; intentional graceful degradation, not a failure.
- A workflow `resume()` unexpectedly denies a step that worked at `start()`: check whether
  the `securityContext` passed to `resume()` still carries the permission the step requires
  — this is the re-authorization behavior working as intended (Section 128), not a bug.
- No OpenTelemetry spans appear anywhere: nothing is exported unless a real
  `TracerProvider`/exporter is registered via `@opentelemetry/sdk-trace-node` (or similar) in
  your own application bootstrap — both packages use the standard OTel no-op default until
  you do, by design (never a required dependency to run an agent/workflow at all).

No commit, deployment, or publication was requested. Stop here; Phase 11 (DevTools, testing/
evals, observability platform) requires explicit user instruction, exactly as every prior
phase gate has held.
