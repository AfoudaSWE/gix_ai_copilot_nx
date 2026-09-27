# @gixcopilot/management

The AI Copilot control plane (**Beta**): authorized, audited, tenant-scoped management
services and the `/management/v1` HTTP API used by `apps/platform`.

## Install

```bash
npm install @gixcopilot/management fastify
```

Requires Node.js >=22.12.0. ESM only.

```ts
const service = createManagementService({
  store: persistence.controlPlane,                    // or createInMemoryControlPlaneStore()
  audit: persistence.audit, auditReader: persistence.audit,
  secrets: createEncryptedSecretStore({ repository: persistence.secretRepository, keys: { v1: key }, activeKeyVersion: 'v1' }),
  conversations: persistence.conversations, usage: persistence.usage,
  traces: devtools, evals: (tenantId) => evalStoreFor(tenantId), jobs: jobQueue,
  catalog: { agents: () => agentList, tools: () => toolList },   // what the app registered in code
});
await app.register(createManagementPlugin(service, { authentication }), { prefix: '/management/v1' });
```

**Architecture.** UI → HTTP plugin (request translation only) → `ManagementService` (all
authorization, validation and auditing) → `ControlPlaneStore` / existing stores → PostgreSQL.
The UI never touches the database.

**Authorization.** Every route authenticates through your `AuthenticationAdapter`. The tenant
comes from the authenticated identity. Roles come from the tenant's memberships: `viewer` <
`operator` < `admin` < `owner`, optionally restricted to projects. Platform administrators
(identity permission `platform.admin`) manage tenants but get no tenant data without a
membership. The last owner cannot be removed.

**Security properties.**
- The platform cannot weaken security declared in code. Tool approval overrides may only be
  stricter; agent tool lists may only be narrowed; unknown agents and tools are rejected
  (no dynamic code).
- OpenAPI imports list every operation and store all of them **disabled**; a refresh keeps
  earlier decisions.
- Secrets are write-only: AES-256-GCM at rest with tenant and name bound as associated data.
  Resources hold secret *names*. No route returns a value.
- Conversation content is available to operators only when the tenant's security policy
  allows it; denials are audited.
- Every mutation writes an audit record (`management.*`).

**Versioned configuration.** Models, agents, tools, OpenAPI, MCP, knowledge sources, prompts
(draft → staging → production, never skipping staging), security policies, budgets and rate
limits. Every edit adds an immutable version. `snapshot(scope)` resolves the enabled current
versions into a content-addressed snapshot for runs. `createSnapshotCache` serves the last good
snapshot when the control plane is unavailable.

## Documentation

- [platform guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/platform.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/management)

## License

MIT
