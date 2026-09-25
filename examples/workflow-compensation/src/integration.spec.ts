import { describe, expect, it } from 'vitest';
import type { CopilotEvent } from '@gixcopilot/protocol';
import type { SecurityContext } from '@gixcopilot/security';
import { createOrderEngine } from './engine.js';
import { createOrderSystem } from './order-system.js';

const INPUT = { orderId: 'ORD-1', sku: 'SKU-1', quantity: 2, amount: 49.5 };

function clerk(permissions: readonly string[]): SecurityContext {
  return { tenant: { tenantId: 'demo' }, identity: { subject: 'clerk-1', roles: ['clerk'], permissions } };
}

function compensationSteps(events: readonly CopilotEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === 'workflow.step.completed' && event.phase === 'compensation' ? [event.stepId] : [],
  );
}

describe('workflow-compensation example (Section 119-121, 175, 202)', () => {
  it('completes without compensating when every step succeeds', async () => {
    const system = createOrderSystem({ carrierDown: false });
    const securityContext = clerk(['orders.write', 'payments.write']);
    const events: CopilotEvent[] = [];

    const result = await createOrderEngine(system, securityContext).start({
      workflowId: 'order-fulfillment', input: INPUT, securityContext, onEvent: (event) => events.push(event),
    });

    expect(result.status).toBe('completed');
    expect(system.inventory.get('SKU-1')).toBe(8);
    expect(system.ledger).toEqual([{ entry: 'charge', orderId: 'ORD-1', amount: 49.5 }]);
    expect(system.shipments).toEqual(['ORD-1']);
    expect(compensationSteps(events)).toEqual([]);
  });

  it('shipment failure refunds then releases, in reverse order, and restores stock', async () => {
    const system = createOrderSystem({ carrierDown: true });
    const securityContext = clerk(['orders.write', 'payments.write']);
    const events: CopilotEvent[] = [];

    const result = await createOrderEngine(system, securityContext).start({
      workflowId: 'order-fulfillment', input: INPUT, securityContext, onEvent: (event) => events.push(event),
    });

    expect(result.status).toBe('failed');
    expect(compensationSteps(events)).toEqual(['charge-payment', 'reserve-inventory']);
    expect(system.inventory.get('SKU-1')).toBe(10);
    // Compensation is a new reversing action, not an erased history (Section 120).
    expect(system.ledger).toEqual([
      { entry: 'charge', orderId: 'ORD-1', amount: 49.5 },
      { entry: 'refund', orderId: 'ORD-1', amount: 49.5 },
    ]);
    expect(system.shipments).toEqual([]);
  });

  it('a caller without payments.write never charges, so there is nothing to refund (Section 123)', async () => {
    const system = createOrderSystem({ carrierDown: true });
    const securityContext = clerk(['orders.write']);
    const events: CopilotEvent[] = [];

    const result = await createOrderEngine(system, securityContext).start({
      workflowId: 'order-fulfillment', input: INPUT, securityContext, onEvent: (event) => events.push(event),
    });

    expect(result.status).toBe('failed');
    expect(system.ledger).toEqual([]);
    // Only the step that actually completed is compensated.
    expect(compensationSteps(events)).toEqual(['reserve-inventory']);
    expect(system.inventory.get('SKU-1')).toBe(10);
  });
});
