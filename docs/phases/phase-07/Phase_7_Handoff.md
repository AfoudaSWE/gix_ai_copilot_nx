# Phase 7 Handoff

## Running the example

```sh
pnpm install
pnpm build
pnpm --filter @gixcopilot/react-enterprise server   # terminal 1 - backend on :4322
pnpm --filter @gixcopilot/react-enterprise dev       # terminal 2 - Vite dev server on :5178
```

Open <http://127.0.0.1:5178>. No `OPENAI_API_KEY` is required — every security/HITL
capability works through the "Application actions" panel. See
`examples/react-enterprise/README.md` for the full walkthrough, and optionally set
`OPENAI_API_KEY`/`OPENAI_MODEL` in a `.env` file there to enable the real chat panel too.

## Wiring a Phase 7 firewall into your own server

```ts
import { createServer } from '@gixcopilot/server';
import {
  createActionFirewall, createInMemoryApprovalStore, createInMemoryAuditSink,
  createStaticAuthenticationAdapter, createFieldRedactionDataPolicy,
  createPolicyRegistry, definePolicy, allow, deny,
} from '@gixcopilot/security';

const app = createServer({
  runtime, modelRuntime, toolRegistry,
  authenticationAdapter: createStaticAuthenticationAdapter(identitiesByToken), // replace with a real session adapter
  actionFirewall: createActionFirewall({
    policies: createPolicyRegistry([/* your ABAC/business policies */]),
    audit: createInMemoryAuditSink(),
    roleMap: { /* role -> permissions, if your identities carry roles */ },
  }),
  approvals: createInMemoryApprovalStore(),
  dataPolicy: createFieldRedactionDataPolicy([{ field: 'ssn', classification: 'pii' }]),
  actionHistory: audit, // the same AuditSink, if it exposes .list()
});
```

A tool opts into enforcement by declaring `security` on `defineTool()`:

```ts
defineTool({
  name: 'applications.delete',
  security: { requiredPermissions: ['applications.delete'], risk: 'destructive', reversibility: 'irreversible', approval: 'admin' },
  dryRun: (input) => Promise.resolve({ summary: '...', changes: [...] }),
  execute: (input) => { /* the real mutation */ },
});
```

A tool with no `security` field is unaffected — Phase 5/6 behavior is preserved exactly.

## Replacing the demo identity fixture with a real authentication system

`createStaticAuthenticationAdapter` is explicitly a deterministic, credential-free fixture. A
real integration implements `AuthenticationAdapter` directly:

```ts
const authenticationAdapter: AuthenticationAdapter = {
  async authenticate(requestContext) {
    const token = extractBearerToken(requestContext); // your own transport-specific extraction
    if (!token) return null;
    const session = await yourSessionStore.verify(token); // or JWT/OIDC verification
    if (!session) return null;
    return { subject: session.userId, roles: session.roles, permissions: session.permissions, attributes: { tenantId: session.tenantId } };
  },
};
```

Nothing else in the firewall pipeline changes — `SecurityContext`, RBAC, ABAC, approval
routing, and audit all consume whatever `Identity` this returns.

## Future maintenance notes

- The `approvals.<level>` permission-naming convention `canApprove()` expects is a default,
  not a requirement — supply your own `RolePermissionMap`/`Identity.permissions` scheme
  freely; only `canApprove()`'s own built-in string convention assumes it.
- `ApprovalStore`/`AuditSink`/`RateLimiter` are all interfaces — swap the in-memory
  implementations for database/Redis-backed ones without touching the firewall or the
  executor; see `docs/TECHNICAL_DEBT.md` for the known process-local limitation this closes.
- Phase 8 (OpenAPI/MCP tool generation) is expected to register generated tools through the
  exact same `defineTool()`/`ToolRegistry` path this phase already secures — a generated
  tool that declares `security` metadata is protected identically to a hand-written one, with
  no firewall change anticipated.
