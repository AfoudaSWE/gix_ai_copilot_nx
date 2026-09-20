# @gixcopilot/integrations

Maintain a small host-owned registry of integration identity, health and capabilities.

This is a private workspace package. Install workspace dependencies with `pnpm install`; a workspace host declares `"@gixcopilot/integrations": "workspace:*"` in its dependencies. Build with `pnpm --filter @gixcopilot/integrations build`.

```ts
import { createIntegrationRegistry } from '@gixcopilot/integrations';
const integrations = createIntegrationRegistry();
integrations.register({ id: 'catalog', type: 'openapi', name: 'Catalog',
  status: 'ready', source: 'Reviewed catalog specification', capabilities: ['catalog.listProducts'] });
console.log(integrations.summarize());
```

This catalog does not connect integrations, execute tools or enforce permissions. The host updates status/capabilities after registration, refresh and disconnect. Records are process-local; keep metadata free of credentials.

See [Phase 8 API](../../docs/phases/phase-08/Phase_8_API.md), [architecture](../../docs/phases/phase-08/Phase_8_Architecture.md), [supported limits](../../docs/phases/phase-08/Phase_8_Issues.md), and [validation](../../docs/phases/phase-08/Phase_8_Testing.md).
