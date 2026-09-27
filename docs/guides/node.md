# Node

`@gixcopilot/node` (**Beta**) composes the server, runtime, providers, tools and security for
plain Node programs, with no UI framework. It is a composition layer over
`@gixcopilot/server`, not a second runtime.

<!-- snippet: secure-server.ts -->
```ts
import { createCopilot } from '@gixcopilot/node';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import { createActionFirewall, createInMemoryAuditSink } from '@gixcopilot/security';
import type { AuthenticationAdapter } from '@gixcopilot/security';
import { applicationsGet } from './tool.js';

declare const authentication: AuthenticationAdapter; // your identity provider's verifier

const copilot = createCopilot({
  model: { provider: 'openai', model: 'gpt-4o-mini' },
  providers: [createOpenAIProvider({ apiKey: process.env['OPENAI_API_KEY'] })],
  tools: [applicationsGet],
  security: { authentication, firewall: createActionFirewall({ audit: createInMemoryAuditSink() }) },
  server: { requireAuthentication: true },
});
await copilot.listen({ port: 4000 });
```

| Member | Use |
| --- | --- |
| `listen()` / `app` | Serve HTTP + SSE with Fastify |
| `nodeHandler()` | Mount in `node:http`, Express or Connect |
| `run(input)` / `stream(input)` | In-process turns (jobs, scripts, tests); they dispatch into the same routes, so authentication and the firewall still apply |
| `client(headers?)` | An in-process `CopilotClient` |

Agents, RAG and memory compose as tools and context from their packages
(`@gixcopilot/agents`, `@gixcopilot/rag`, `@gixcopilot/memory`). Example: `examples/node-basic`.
For the full production server (Postgres, Redis, management API) see `apps/api` and
[Production](production.md).
