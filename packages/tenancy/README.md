# @gixcopilot/tenancy

Multi-tenancy primitives for the AI Copilot SDK (**Beta**). Platform-neutral, no storage
dependencies.

| Export | Purpose |
| --- | --- |
| `scopeFromSecurityContext`, `requireScope` | The runtime scope (`tenantId`, `projectId`, `environment`) derived **only** from the authenticated `SecurityContext`, never from request bodies or model output. Malformed ids are rejected. |
| `assertTenantOwns`, `assertValidId` | Guards for resource ownership and ids used in storage keys |
| `Tenant`, `Project`, `Environment`, `Membership`, `TenantRole`, `roleAtLeast` | The Tenant → Project → Environment model and ranked tenant roles (`viewer` < `operator` < `admin` < `owner`) |
| `ConversationStore`, `createInMemoryConversationStore` | Threads, messages and runs. Data is reachable only through `forTenant(scope)`: no method takes a tenant id, so a query cannot forget the tenant filter. PostgreSQL implementation: `@gixcopilot/persistence-postgres`. |
| `createConversationRecorder(store, { retain })` | A server run observer that persists each run under the authenticated tenant (`retain: 'metadata'` keeps no message text) |

```ts
const server = createServer({ ..., requireAuthentication: true, runObservers: [createConversationRecorder(store)] });
```
