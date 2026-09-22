# workflow-approval

Phase 10 demonstration of the deterministic workflow engine (`@gixcopilot/workflows`):

```text
Validate -> Application Agent -> Check Payment -> Prepare Change
  -> Supervisor Approval -> Update Application -> Complete
```

The final, consequential step (`applications.update`) sits behind a real human-in-the-loop
approval — reusing Phase 7's `ApprovalStore`, not a second approval engine. The agent step
only *summarizes*; it never decides or approves anything (Section 135).

## Run

```sh
pnpm --filter @gixcopilot/workflow-approval-demo demo
```

Starts the workflow, prints the real pause, approves it as a supervisor, then resumes and
completes — demonstrating pause/persist/resume, not just a happy-path function call.

## Test

```sh
pnpm --filter @gixcopilot/workflow-approval-demo test
```

Covers the pause/approve/resume cycle, a rejected approval never applying the update, and a
simulated process restart — two independent `WorkflowEngine` instances sharing only the
persisted checkpoint and approval stores (Section 198, 209).
