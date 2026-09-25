import { z } from 'zod';
import { CopilotError } from '@gixcopilot/protocol';
import { defineTool } from '@gixcopilot/tools';

/**
 * A small, real, in-memory order back end (Section 169, 175): inventory stock and a payment
 * ledger that the forward steps change and the compensations change back. Compensation here
 * is a NEW semantically-reversing action (release, refund), never a pretend rollback
 * (Section 120) - the ledger keeps both the charge and the refund.
 */
export interface OrderSystem {
  readonly inventory: Map<string, number>;
  readonly ledger: { readonly entry: 'charge' | 'refund'; readonly orderId: string; readonly amount: number }[];
  readonly shipments: string[];
  /** When true, the carrier rejects every shipment - the failure this example compensates. */
  carrierDown: boolean;
}

export function createOrderSystem(options: { readonly carrierDown?: boolean } = {}): OrderSystem {
  return { inventory: new Map([['SKU-1', 10]]), ledger: [], shipments: [], carrierDown: options.carrierDown ?? true };
}

const stockInput = z.object({ orderId: z.string(), sku: z.string(), quantity: z.number().int().positive() });
const paymentInput = z.object({ orderId: z.string(), amount: z.number().positive() });

export function createOrderTools(system: OrderSystem) {
  const reserve = defineTool({
    name: 'inventory.reserve',
    description: 'Reserve stock for an order.',
    input: stockInput,
    security: { requiredPermissions: ['orders.write'], risk: 'write', reversibility: 'compensatable', approval: 'none' },
    execute: (input) => {
      const available = system.inventory.get(input.sku) ?? 0;
      if (available < input.quantity) return Promise.reject(CopilotError.provider('insufficient stock', undefined, false));
      system.inventory.set(input.sku, available - input.quantity);
      return Promise.resolve({ reserved: input.quantity });
    },
  });

  const release = defineTool({
    name: 'inventory.release',
    description: 'Release previously reserved stock.',
    input: stockInput,
    security: { requiredPermissions: ['orders.write'], risk: 'write', reversibility: 'reversible', approval: 'none' },
    execute: (input) => {
      system.inventory.set(input.sku, (system.inventory.get(input.sku) ?? 0) + input.quantity);
      return Promise.resolve({ released: input.quantity });
    },
  });

  const charge = defineTool({
    name: 'payment.charge',
    description: 'Charge the customer for an order.',
    input: paymentInput,
    security: { requiredPermissions: ['payments.write'], risk: 'write', reversibility: 'compensatable', approval: 'none' },
    execute: (input) => {
      system.ledger.push({ entry: 'charge', orderId: input.orderId, amount: input.amount });
      return Promise.resolve({ charged: input.amount });
    },
  });

  const refund = defineTool({
    name: 'payment.refund',
    description: 'Refund a previous charge.',
    input: paymentInput,
    security: { requiredPermissions: ['payments.write'], risk: 'write', reversibility: 'irreversible', approval: 'none' },
    execute: (input) => {
      system.ledger.push({ entry: 'refund', orderId: input.orderId, amount: input.amount });
      return Promise.resolve({ refunded: input.amount });
    },
  });

  const ship = defineTool({
    name: 'shipment.create',
    description: 'Create a shipment with the carrier.',
    input: z.object({ orderId: z.string() }),
    security: { requiredPermissions: ['orders.write'], risk: 'write', reversibility: 'irreversible', approval: 'none' },
    execute: (input) => {
      if (system.carrierDown) return Promise.reject(CopilotError.provider('carrier unavailable', undefined, false));
      system.shipments.push(input.orderId);
      return Promise.resolve({ shipped: true });
    },
  });

  return [reserve, release, charge, refund, ship] as const;
}
