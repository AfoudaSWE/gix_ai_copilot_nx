# Phase 8 public API

These packages are server integration entry points. Register definitions into a host-owned registry and configure `createServer` with authentication, the Action Firewall and an approval store. Calling a generated `.execute()` directly is a trusted host operation and does not run the firewall; models must use the canonical server/runtime path.

## OpenAPI

```ts
import { registerOpenAPI, inspectOpenAPI } from '@gixcopilot/openapi';
import { createToolRegistry, staticCredentialProvider } from '@gixcopilot/tools';

const registry = createToolRegistry();
const options = {
  integrationId: 'applications', namespace: 'apps',
  source: { kind: 'file' as const, path: './openapi.yaml' },
  baseUrl: 'https://api.example.com/v1',
  include: ['getApplication', 'assignApplication'],
  operations: {
    getApplication: { permission: 'applications.read' },
    assignApplication: { permission: 'applications.write', approval: 'supervisor' as const },
  },
  credentialProvider: staticCredentialProvider({ kind: 'bearer', token: process.env['API_TOKEN'] ?? '' }),
};
const preview = await inspectOpenAPI(options); // tools + report, no registry mutation
const integration = await registerOpenAPI({ ...options, registry });
await integration.refresh();
integration.dispose();
```

Use real host token validation; the snippet only illustrates construction. For user-scoped tokens implement `CredentialProvider.getCredentials({ integrationId, executionContext })`; read authenticated identity from `executionContext.metadata.securityContext`, never tool arguments.

| Export | Contract |
| --- | --- |
| `inspectOpenAPI`, `generateOpenAPITools` | Async options -> `{ tools, report }`; registry-agnostic |
| `registerOpenAPI` | Generation options + `registry` -> `OpenAPIIntegration` with `integrationId`, `report`, `toolNames`, `refresh()`, `dispose()` |
| `createOpenAPILoader` | Object/file/URL loader; optional `fetchImpl` |
| `validateOpenAPIDocument` | `{ ok, document, version }` or `{ ok: false, issues }` |
| `resolveLocalRefs` | New resolved object; `CircularReferenceError` / `UnresolvableReferenceError` for invalid chains |
| `discoverOperations` | Minimal validated document -> operation candidates |
| `deriveToolName`, `deriveFallbackName`, `operationKey`, `detectNamingConflicts` | Deterministic ID/path fallback, namespace and collision diagnostics |
| `resolveOperationExposure`, `buildSecurityMetadata` | Candidate method/operation policy and canonical security manifest |
| `buildOperationInputPlan` | Zod input plus parameter/body routing, or conversion issues |
| `createFetchHttpExecutor` | `execute(HttpExecutionRequest)` -> `{ status, headers, body }`; optional fetch implementation and `maxResponseBytes` |
| `normalizeHttpError`, `normalizeExecutionError` | External failures -> existing `CopilotError` taxonomy |
| `shouldRetry`, `retryDelayMs`, `withRetry` | Bounded, explicit idempotency-aware retry helpers |

Generation options include `source`, `integrationId`, optional `namespace`, `baseUrl`, `include`, `exclude`, method `policies`, operation `operations`, `defaultPermission`, `credentialProvider`, `httpExecutor`, `loader`, `timeoutMs`, `retry`, `idempotencyKeyHeader`, `transformResult` and `onTelemetry`.

Operation overrides support `expose`, `permission` / `requiredPermissions`, `risk`, `reversibility`, `approval`, `dataClassification`, `name`, `description`, and `allowedHeaderParameters`. Keys are exact operation IDs, falling back to `METHOD /path`; no tag/glob selection API is claimed.

Reports contain `operationsDiscovered`, `generated`, `skipped`, `denied`, `unsupported`, `warnings`, `conflicts`, and document-level issues. Unsupported candidates are skipped with diagnostics (lenient generation). Document-level failures expose no tools. No `strict` option exists. For all-or-nothing policy, inspect the report before registration.

## MCP

```ts
import { registerMCP } from '@gixcopilot/mcp';

const integration = await registerMCP({
  serverId: 'company', registry,
  transport: { kind: 'stdio', command: 'node', args: ['./server.mjs'] },
  tools: {
    search: { permission: 'documents.read', risk: 'read-only', approval: 'none' },
    createTicket: { permission: 'tickets.write', risk: 'write', approval: 'user-confirmation' },
  },
});
await integration.listResources(); // untrusted host-only discovery data
await integration.dispose();
```

`McpTransportConfig` is `{ kind: 'stdio', command, args?, env?, cwd? }` or `{ kind: 'streamableHttp', url }`. HTTP authentication uses server-only `requestHeaders`; stdio credentials use explicitly configured environment values. A client represents one credential/security scope; do not share a user-scoped connection across tenants.

`createMcpClient({ serverId, transport, requestHeaders?, timeoutMs?, onStateChange? })` returns `McpClient`: `state`, `serverId`, `connect`, `disconnect`, `listTools`, `callTool(name, args, { signal?, timeoutMs? })`, `listResources`, `readResource`, `listPrompts`, and optional `subscribeState` for supplied custom clients.

`inspectMCP` / `generateMcpTools` accept a client, exposure (`include`, `exclude`, `defaultExposure`, `tools` overrides), default permission, timeout, trust label, transform and telemetry. They return canonical tools and a `McpGenerationReport`. Inspection may connect; the caller owns cleanup.

`registerMCP` adds `registry`, `serverId`, `transport`, optional existing `client`, `requestHeaders`, state callback and `reconnect: { maxAttempts?, baseDelayMs? }`. Its handle exposes connection state, report, tool names, refresh, resource/prompt methods and async dispose. Default connection attempts: one. Maximum configured attempts: ten. Default request timeout: 30 seconds.

Lower-level exports: `deriveMcpToolName`, `detectNamingConflicts`, `buildMcpInputSchema`, `resolveMcpToolExposure`, `buildMcpSecurityMetadata`, `normalizeMcpError`, `normalizeMcpToolFailure`. `McpCallResult` and content/resource/prompt types are project-owned. Raw binary content is reduced to metadata; explicit resource reads return the first content item.

## Shared helpers and catalog

`@gixcopilot/tools` exports `jsonSchemaToZod(schema, direction?)`, `toToolNameSegment`, `CredentialProvider`, credential types, `staticCredentialProvider`, `noCredentialsProvider`, `credentialsToHeaders`, `redactSensitiveHeaders`, `redactCredentialValues`, `toolSourceAuditMetadata`, and safe `measureIntegration` / telemetry types.

`@gixcopilot/integrations` exports `createIntegrationRegistry`, `IntegrationRecord`, `IntegrationSummary`, `IntegrationType`, `IntegrationHealth`, `IntegrationRegistry` and `IntegrationListFilter`. Methods: register/upsert, unregister, has, get, list, updateStatus, summarize, subscribe. It holds host-supplied records; it does not connect or execute tools. Store only non-sensitive source labels and metadata.

Full type definitions and optional fields are in each package's `src/index.ts` exports and generated `.d.ts` files.
