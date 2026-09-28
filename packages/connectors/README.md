# @gixcopilot/connectors

> **Status:** Beta. See [stability levels](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/VERSIONING.md#stability-levels).

Connect the copilot to **any HTTP or GraphQL API**, whatever language or framework it is built
with (Laravel, Django, FastAPI, Spring, .NET, Rails, Go, Express, legacy PHP…). No OpenAPI
document is needed: declare the endpoints the copilot may use, and each becomes a typed,
schema-validated tool that passes the Action Firewall. Serve the same tools to other AI clients
with `@gixcopilot/mcp`.

## Install

```bash
npm install @gixcopilot/connectors zod
```

Requires Node.js >=22.12.0. ESM only. Server-side only.

## Usage

```ts
import { z } from 'zod';
import { defineHttpApi } from '@gixcopilot/connectors';
import { staticCredentialProvider } from '@gixcopilot/tools';

export const crm = defineHttpApi({
  id: 'crm',
  baseUrl: process.env.CRM_URL!,
  credentials: staticCredentialProvider({ kind: 'bearer', token: process.env.CRM_TOKEN! }),
  endpoints: {
    'customers.get': { method: 'get', path: '/customers/{id}', description: 'Get one customer', input: z.object({ id: z.string() }) },
    'orders.create': { method: 'post', path: '/orders', description: 'Create an order', input: z.object({ sku: z.string(), quantity: z.number() }), approval: 'user-confirmation' },
  },
  graphql: {
    operations: {
      'orders.byId': { description: 'Get an order', query: 'query ($id: ID!) { order(id: $id) { id status } }', variables: z.object({ id: z.string() }) },
    },
  },
});

// createCopilot({ tools: [...crm.tools] })  or  crm.register(registry)
```

Or describe the API in YAML/JSON (no TypeScript needed) and load it:

```ts
import { loadHttpApiManifest } from '@gixcopilot/connectors';
const crm = await loadHttpApiManifest('apis/crm.api.yaml');
```

```sh
npx aicopilot add api crm --url https://crm.internal.example.com   # scaffold a manifest
npx aicopilot api check apis/crm.api.yaml                          # validate, list tools
npx aicopilot mcp serve apis/crm.api.yaml                          # serve as an MCP server
```

## What it guarantees

- Only declared endpoints exist; nothing is discovered or exposed automatically.
- Path fields are URL-encoded (dot segments refused); other fields go to the query (GET/DELETE)
  or JSON body (POST/PUT/PATCH), or where `params` says; `bodyEncoding: 'form'` for form posts.
- Risk from the method (GET read-only, DELETE destructive, others write), overridable;
  every tool requires `api.<id>` unless it declares its own permissions.
- Credentials are resolved on the server per call, never part of tool input, and redacted from
  results. Manifests can only reference credentials through environment variables.
- Requests go only to `baseUrl`; redirects are refused; responses are size-limited; timeouts,
  cancellation and opt-in retries (writes only with an idempotency key) apply.
- GraphQL documents are fixed by you; the model supplies variables only.

## Documentation

- [Connect any API guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/connectors.md)
- [MCP](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/mcp.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/connectors)

## License

MIT
