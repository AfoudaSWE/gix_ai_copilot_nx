# @gixcopilot/workflows

> **Status:** Beta. See [stability levels](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/VERSIONING.md#stability-levels).

Durable workflow engine for the AI Copilot SDK (Phase 10): typed step graphs (function, tool,
agent, approval, condition, parallel), checkpointing after every step, pause for human approval
and resume, bounded retries with backoff, compensation plans, cancellation, and protocol events
for every transition. Tool and agent steps go through the same Action Firewall as chat.

```sh
pnpm add @gixcopilot/workflows
```

| Export | Purpose |
| --- | --- |
| `defineWorkflow`, `validateWorkflowGraph` and the step builders (`functionStep`, `toolStep`, `agentStep`, `approvalStep`, `conditionStep`, `parallelStep`) | Declare a workflow |
| `createWorkflowEngine` | Start, resume, cancel and inspect runs |
| `CheckpointStore`, `createInMemoryCheckpointStore` | Checkpoint port (use `@gixcopilot/checkpoint-postgres` in production) |
| `JobExecutor`, `createInlineJobExecutor` | Step execution port (use `@gixcopilot/jobs` for BullMQ workers) |
| `buildCompensationPlan` | Compensation for completed side-effecting steps |
| `createWorkflowTestHarness` | Test utility |

A run keeps the definition version it started with. An approval step resumes only on a recorded
human/system decision, never on model text. See ADR 0015 and `examples/workflow-approval`.

## Known limitations

- `parallel` steps always run every branch to completion (`Promise.allSettled`). There is no
  early-abort fail-fast for workflow branches; agent-level parallel delegation does support it.
- An approval wait is recorded as a retroactive span, not a live cross-process trace.

## Documentation

- [workflows guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/workflows.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/workflows)

## License

MIT
