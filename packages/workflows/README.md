# @gixcopilot/workflows

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
