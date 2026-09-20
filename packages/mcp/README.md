# @gixcopilot/mcp

Discover and register governed tools from an MCP server through the official SDK adapter.

This is a private workspace package. Install workspace dependencies with `pnpm install`; a workspace host declares `"@gixcopilot/mcp": "workspace:*"` in its dependencies. Build with `pnpm --filter @gixcopilot/mcp build`.

```ts
import { registerMCP } from '@gixcopilot/mcp';
import { createToolRegistry } from '@gixcopilot/tools';
const registry = createToolRegistry();
const integration = await registerMCP({
  serverId: 'company', registry,
  transport: { kind: 'stdio', command: 'node', args: ['./server.mjs'] },
  tools: { search: { permission: 'documents.read', risk: 'read-only', approval: 'none' } },
});
console.log(integration.report);
await integration.dispose();
```

Use the host server with authentication, an Action Firewall, an approval store and a data policy. Never call generated executors directly from model input. Keep credentials and these Node adapters out of browser bundles. Inspect reports for unsupported operations, denied tools and conflicts.

See [Phase 8 API](../../docs/phases/phase-08/Phase_8_API.md), [architecture](../../docs/phases/phase-08/Phase_8_Architecture.md), [supported limits](../../docs/phases/phase-08/Phase_8_Issues.md), and [validation](../../docs/phases/phase-08/Phase_8_Testing.md).
