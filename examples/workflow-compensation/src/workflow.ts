import { z } from 'zod';
import { defineWorkflow, toolStep } from '@gixcopilot/workflows';

const inputSchema = z.object({
  orderId: z.string(),
  sku: z.string(),
  quantity: z.number().int().positive(),
  amount: z.number().positive(),
});
const stateSchema = inputSchema.extend({ reserved: z.boolean(), charged: z.boolean(), shipped: z.boolean() });
type State = z.infer<typeof stateSchema>;

/**
 * Reserve → Charge → Ship (Section 119-121, 175). Each consequential forward step declares its
 * trusted, developer-configured compensation; if a later step fails, the engine runs the
 * compensations of the completed steps in reverse order: refund, then release.
 */
export const orderFulfillmentWorkflow = defineWorkflow({
  id: 'order-fulfillment',
  version: '1',
  input: inputSchema,
  state: stateSchema,
  initialState: (input) => ({ ...input, reserved: false, charged: false, shipped: false }),
  steps: [
    toolStep<State>({
      id: 'reserve-inventory',
      tool: 'inventory.reserve',
      input: ({ state }) => ({ orderId: state.orderId, sku: state.sku, quantity: state.quantity }),
      updateState: (state) => ({ ...state, reserved: true }),
      compensate: {
        tool: 'inventory.release',
        input: ({ state }) => ({ orderId: state.orderId, sku: state.sku, quantity: state.quantity }),
      },
    }),
    toolStep<State>({
      id: 'charge-payment',
      dependencies: ['reserve-inventory'],
      tool: 'payment.charge',
      input: ({ state }) => ({ orderId: state.orderId, amount: state.amount }),
      updateState: (state) => ({ ...state, charged: true }),
      compensate: {
        tool: 'payment.refund',
        input: ({ state }) => ({ orderId: state.orderId, amount: state.amount }),
      },
    }),
    toolStep<State>({
      id: 'create-shipment',
      dependencies: ['charge-payment'],
      tool: 'shipment.create',
      input: ({ state }) => ({ orderId: state.orderId }),
      updateState: (state) => ({ ...state, shipped: true }),
    }),
  ],
});
