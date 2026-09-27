# @gixcopilot/openapi

Generate canonical tools from explicitly selected OpenAPI operations.

## Install

```bash
npm install @gixcopilot/openapi
```

Requires Node.js >=22.12.0. ESM only.

```ts
import { registerOpenAPI } from '@gixcopilot/openapi';
import { createToolRegistry } from '@gixcopilot/tools';
const registry = createToolRegistry();
const integration = await registerOpenAPI({
  integrationId: 'catalog', namespace: 'catalog', registry,
  source: { kind: 'file', path: './openapi.yaml' },
  baseUrl: 'https://api.example.com', include: ['listProducts'],
  operations: { listProducts: { permission: 'catalog.read' } },
});
console.log(integration.report);
```

Use the host server with authentication, an Action Firewall, an approval store and a data policy. Never call generated executors directly from model input. Keep credentials and these Node adapters out of browser bundles. Inspect reports for unsupported operations, denied tools and conflicts.

See [Phase 8 API](../../docs/phases/phase-08/Phase_8_API.md), [architecture](../../docs/phases/phase-08/Phase_8_Architecture.md), [supported limits](../../docs/phases/phase-08/Phase_8_Issues.md), and [validation](../../docs/phases/phase-08/Phase_8_Testing.md).

## Documentation

- [openapi guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/openapi.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/openapi)

## License

MIT
