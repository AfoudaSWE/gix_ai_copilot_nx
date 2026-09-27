# Connect any API

`@gixcopilot/connectors` (**Beta**) connects the copilot to **any HTTP or GraphQL API**, whatever
language or framework it is built with (Laravel, Django, FastAPI, Spring, .NET, Rails, Go,
Express, NestJS, legacy PHP…). No OpenAPI document is needed: you declare the endpoints the
copilot may use, and each one becomes a typed, schema-validated tool that passes the
[Action Firewall](security.md). If the API does publish an OpenAPI document, [OpenAPI import](openapi.md)
generates the same kind of tools for you.

```text
your API (any stack) ◄── HTTP ── connector tool ◄── Action Firewall ◄── model tool call
                                       │
                                       └── also served as an MCP server for other AI clients
```

## Declare an API in TypeScript

<!-- snippet: connector.ts -->
```ts
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
```

Register the tools like any other: `createCopilot({ tools: [...crm.tools] })`, or
`crm.register(registry)` (returns an unregister function).

### How input fields become the request

| Field | Goes to |
| --- | --- |
| Named in the path (`/customers/{id}`) | Path segment (URL-encoded, dot segments refused) |
| Any other field on `GET` / `DELETE` | Query string (arrays repeat the key) |
| Any other field on `POST` / `PUT` / `PATCH` | JSON body |
| Override per field | `params: { apiVersion: 'header', include: 'query' }` |

Set `bodyEncoding: 'form'` for APIs that expect `application/x-www-form-urlencoded`, add fixed
non-secret `headers`, and declare `output` (a zod schema) to reject responses that do not match.
Every tool returns `{ status, body }`.

### Security defaults

- **Risk** comes from the method: `GET` read-only, `DELETE` destructive, other methods write.
  Override with `risk`, and require a human with `approval` (for example `supervisor`).
- **Permissions**: every tool requires `api.<id>` unless it declares `requiredPermissions`.
- **Credentials** come from a `CredentialProvider` on the server on every call (bearer, API key,
  basic or custom headers). They are never part of the tool input, and credential values echoed
  in a response are redacted before the model sees them.
- **Requests** are built only from your `baseUrl` plus encoded parameters: input cannot change the
  host; redirects are refused; responses are size-limited (1 MiB by default); only safe response
  headers are kept; timeouts and cancellation apply. Retries are opt-in and never repeat a write
  without an `idempotencyKeyHeader`.

> [!SECURITY]
> Only the endpoints you list exist. Nothing is discovered or exposed automatically, and write
> tools still need approval under the default risk policy.

## GraphQL

```ts
const shop = defineHttpApi({
  id: 'shop',
  baseUrl: 'https://shop.example.com',
  graphql: {
    path: '/graphql',
    operations: {
      'orders.byId': {
        description: 'Get an order',
        query: 'query ($id: ID!) { order(id: $id) { id status } }',
        variables: z.object({ id: z.string() }),
      },
    },
  },
});
```

The GraphQL document is fixed by you; the model only supplies variables. `query` documents are
read-only and `mutation`s are writes by default. GraphQL `errors` in a 200 response become tool
errors.

## Declare an API in a manifest (no TypeScript)

Teams that do not write TypeScript can describe the API in YAML or JSON, next to the service
itself:

```sh
npx aicopilot add api crm --url https://crm.internal.example.com   # writes apis/crm.api.yaml
npx aicopilot api check apis/crm.api.yaml                          # validates, lists the tools
```

```yaml
id: crm
baseUrl: ${env:CRM_URL}
auth: { type: bearer, tokenEnv: CRM_TOKEN }   # none | bearer | apiKey | basic | headers
endpoints:
  customers.get:
    method: GET
    path: /customers/{id}
    description: Get one customer by id
    permissions: [crm.read]
    input:
      type: object
      properties: { id: { type: string } }
      required: [id]
```

Load it in the copilot server with `await loadHttpApiManifest('apis/crm.api.yaml')`. Inputs are
JSON Schema; unknown keys are rejected; URLs and credentials can only come from environment
variables (`${env:NAME}`, `tokenEnv`, `valueEnv` …), so no secret is ever written in the file.

## Expose the connected app as an MCP server

The same tools can be served over the [Model Context Protocol](mcp.md), so desktop assistants,
IDEs and other agents can use your application, still through the Action Firewall.

**Without code:**

```sh
npx aicopilot mcp serve apis/crm.api.yaml                     # stdio (launched by the MCP client)
npx aicopilot mcp serve apis/crm.api.yaml --http --port 3333 --token-env MCP_TOKEN
```

Only read-only tools are served unless you pass `--allow-writes` (an explicit operator decision:
there is no one to answer approvals). HTTP listens on `127.0.0.1`; `--token-env` requires a
bearer token. Every call is audited to stderr.

**In your server** (per-caller identity, approvals and audit as in the copilot):

<!-- snippet: mcp-server.ts -->
```ts
import { createMcpToolServer } from '@gixcopilot/mcp';
import { createActionFirewall, createActionFirewallMiddleware, createInMemoryAuditSink } from '@gixcopilot/security';
import type { SecurityContext } from '@gixcopilot/security';
import { createStaticToolResolver, createToolRuntime } from '@gixcopilot/tools';
import { crm } from './connector.js';

declare function authenticate(request: Request): Promise<SecurityContext>; // your identity check

const resolver = createStaticToolResolver(crm.tools);
const firewall = createActionFirewall({ audit: createInMemoryAuditSink() });

export const mcp = createMcpToolServer({
  name: 'crm',
  tools: crm.tools,
  // Each MCP call runs as the authenticated caller, through the Action Firewall.
  runtime: ({ metadata }) =>
    createToolRuntime({
      resolver,
      middleware: [createActionFirewallMiddleware({ firewall, resolver, getContext: () => metadata?.['security'] as SecurityContext })],
    }),
});

// Streamable HTTP (e.g. a Next.js route handler: export const POST = handler)
export async function handler(request: Request): Promise<Response> {
  return mcp.handleRequest(request, { metadata: { security: await authenticate(request) } });
}
```

`handleRequest` is web-standard (`Request` → `Response`), so it runs in Node, Next.js route
handlers, Bun, Deno and edge runtimes; `connectStdio()` serves a local process. Tools advertise
`readOnlyHint` / `destructiveHint` from their risk, and errors come back as MCP tool errors with
the public error code only.

## Next

- [Next.js](nextjs.md): host the copilot API in a Next.js route handler.
- [Tools](tools.md), [Security](security.md), [OpenAPI](openapi.md), [MCP](mcp.md).
