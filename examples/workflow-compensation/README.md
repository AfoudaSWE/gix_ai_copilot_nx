# workflow-compensation

Phase 10 demonstration of workflow compensation (Section 119-121, 175): an order workflow that
reserves inventory, charges payment, then fails to create a shipment. The engine then runs the
declared compensations for the completed steps in reverse order: refund the payment, then
release the stock.

Compensation is a new, reversing action, not a rollback: the payment ledger keeps both the
charge and the refund. Every forward step and every compensation goes through the
permission-aware resolver and the Action Firewall under the original caller's identity.

Fully deterministic; no model is involved.

## Run

```sh
pnpm --filter @gixcopilot/workflow-compensation-demo demo
```

## Test

```sh
pnpm --filter @gixcopilot/workflow-compensation-demo test
```

Covers the success path (no compensation), reverse-order compensation after the shipment
fails, and a caller without `payments.write` whose charge is denied, so only the inventory
reservation is compensated.
