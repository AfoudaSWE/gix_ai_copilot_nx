import type { SecurityContext } from '@gixcopilot/security';
import type { WorkflowEventListener } from '@gixcopilot/workflows';
import { createOrderEngine } from './engine.js';
import { createOrderSystem } from './order-system.js';

const printEvent: WorkflowEventListener = (event) => {
  if (event.type === 'workflow.step.started') console.log(`[${event.phase ?? 'forward'}] ${event.stepId} started`);
  if (event.type === 'workflow.step.completed') console.log(`[${event.phase ?? 'forward'}] ${event.stepId} completed`);
  if (event.type === 'workflow.step.failed') {
    console.log(`[${event.phase ?? 'forward'}] ${event.stepId} FAILED: ${event.error.message}`);
  }
};

async function main(): Promise<void> {
  const system = createOrderSystem({ carrierDown: true });
  const securityContext: SecurityContext = {
    tenant: { tenantId: 'demo' },
    identity: { subject: 'clerk-1', roles: ['clerk'], permissions: ['orders.write', 'payments.write'] },
  };
  const engine = createOrderEngine(system, securityContext);

  console.log(`Stock before: SKU-1 = ${String(system.inventory.get('SKU-1'))}\n`);
  const result = await engine.start({
    workflowId: 'order-fulfillment',
    input: { orderId: 'ORD-1', sku: 'SKU-1', quantity: 2, amount: 49.5 },
    securityContext,
    onEvent: printEvent,
  });

  console.log(`\nStatus: ${result.status}`);
  console.log(`Stock after:  SKU-1 = ${String(system.inventory.get('SKU-1'))}`);
  console.log('Ledger:', system.ledger);
  console.log('Shipments:', system.shipments);
}

main().catch((error: unknown) => {
  console.error('Fatal error running the workflow-compensation demo:', error);
  process.exitCode = 1;
});
