import { createStaticToolResolver, createToolRuntime } from '@gixcopilot/tools';
import { createActionFirewall, createActionFirewallMiddleware, createPermissionAwareToolResolver } from '@gixcopilot/security';
import type { SecurityContext } from '@gixcopilot/security';
import { createWorkflowEngine } from '@gixcopilot/workflows';
import type { WorkflowEngine } from '@gixcopilot/workflows';
import { createOrderTools } from './order-system.js';
import type { OrderSystem } from './order-system.js';
import { orderFulfillmentWorkflow } from './workflow.js';

/**
 * Every forward step AND every compensation goes through the permission-aware resolver and
 * the Action Firewall under the original trusted caller's identity (Section 123) - no model
 * is involved, and nothing chooses a different identity for the compensations.
 */
export function createOrderEngine(system: OrderSystem, securityContext: SecurityContext): WorkflowEngine {
  const resolver = createPermissionAwareToolResolver(
    createStaticToolResolver(createOrderTools(system)),
    securityContext.identity,
  );
  const toolRuntime = createToolRuntime({
    resolver,
    middleware: [
      createActionFirewallMiddleware({ firewall: createActionFirewall(), resolver, getContext: () => securityContext }),
    ],
  });
  // No retries, so a carrier failure deterministically reaches compensation.
  const engine = createWorkflowEngine({ toolRuntime, retryPolicy: { maxAttempts: 1 } });
  engine.register(orderFulfillmentWorkflow);
  return engine;
}
