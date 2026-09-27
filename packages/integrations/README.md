# @gixcopilot/integrations

Maintain a small host-owned registry of integration identity, health and capabilities.

## Install

```bash
npm install @gixcopilot/integrations
```

Requires Node.js >=22.12.0. ESM only.

```ts
import { createIntegrationRegistry } from '@gixcopilot/integrations';
const integrations = createIntegrationRegistry();
integrations.register({ id: 'catalog', type: 'openapi', name: 'Catalog',
  status: 'ready', source: 'Reviewed catalog specification', capabilities: ['catalog.listProducts'] });
console.log(integrations.summarize());
```

This catalog does not connect integrations, execute tools or enforce permissions. The host updates status/capabilities after registration, refresh and disconnect. Records are process-local; keep metadata free of credentials.

See [Phase 8 API](../../docs/phases/phase-08/Phase_8_API.md), [architecture](../../docs/phases/phase-08/Phase_8_Architecture.md), [supported limits](../../docs/phases/phase-08/Phase_8_Issues.md), and [validation](../../docs/phases/phase-08/Phase_8_Testing.md).

## Documentation

- [tools guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/tools.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/integrations)

## License

MIT
