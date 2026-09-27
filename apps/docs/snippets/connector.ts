import { z } from 'zod';
import { defineHttpApi } from '@gixcopilot/connectors';
import { staticCredentialProvider } from '@gixcopilot/tools';

// Any HTTP API: Laravel, Django, Spring, .NET, Rails, Go, Express... no OpenAPI document needed.
export const crm = defineHttpApi({
  id: 'crm',
  baseUrl: process.env['CRM_URL'] ?? 'https://crm.internal.example.com',
  credentials: staticCredentialProvider({ kind: 'bearer', token: process.env['CRM_TOKEN'] ?? '' }),
  endpoints: {
    'customers.get': {
      method: 'get',
      path: '/customers/{id}',
      description: 'Get one customer by id',
      input: z.object({ id: z.string() }),
    },
    'orders.create': {
      method: 'post',
      path: '/orders',
      description: 'Create an order for a customer',
      input: z.object({ customerId: z.string(), sku: z.string(), quantity: z.number().int().positive() }),
      approval: 'user-confirmation',
    },
  },
});

// crm.tools: crm.customers.get (read-only), crm.orders.create (write, needs confirmation)
