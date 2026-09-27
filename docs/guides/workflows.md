# Workflows

`@gixcopilot/workflows` makes long-running AI operations durable: typed step graphs (function,
tool, agent, approval, condition, parallel), a checkpoint after every step, pause for human
approval and resume, bounded retries with backoff, compensation and cancellation.

- `defineWorkflow({ id, version, input, state, initialState, steps })` and
  `createWorkflowEngine({ checkpointStore, jobExecutor, approvals, toolRuntime })`.
- Production: `createPgCheckpointStore` (PostgreSQL), `createPostgresApprovalStore` (approvals
  decided on any server instance), BullMQ workers (`@gixcopilot/jobs`). A run keeps the
  workflow version it started with.
- Tenancy: a checkpoint created for one tenant cannot be resumed, cancelled or read by another
  (tested on real PostgreSQL).
- Approval steps resume only on a recorded decision, never on model text.

Examples: `examples/workflow-approval`, `examples/workflow-compensation`.
