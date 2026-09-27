# @gixcopilot/node

Node.js SDK for the AI Copilot SDK (**Beta**). `createCopilot()` composes the existing server
(`@gixcopilot/server`), core runtime, model runtime, backend tools and security into one
object. It is a composition layer, not a second runtime.

```sh
pnpm add @gixcopilot/node @gixcopilot/provider-openai
```

```ts
import { createCopilot } from '@gixcopilot/node';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';

const copilot = createCopilot({
  model: { provider: 'openai', model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini' },
  providers: [createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY })],
  tools: [applicationsGet],                     // defineTool(...) from @gixcopilot/tools
  security: { authentication, firewall },       // @gixcopilot/security
});

await copilot.listen({ port: 4000 });           // Fastify (HTTP + SSE)
http.createServer(copilot.nodeHandler());       // or node:http / Express: app.use('/api/copilot', copilot.nodeHandler())
const result = await copilot.run('Summarize APP-1');        // or in-process (jobs, scripts)
for await (const event of copilot.stream('Hi')) { /* protocol events */ }
```

| Member | Purpose |
| --- | --- |
| `app` | The configured Fastify server (`/runs`, `/health`, approvals, tool results) |
| `run(input)` / `stream(input)` | In-process turns. They dispatch into the same HTTP routes (validation, authentication, Action Firewall, approvals) via Fastify's in-process injection, so in-process use cannot bypass security |
| `client(headers?)` | An in-process `CopilotClient` |
| `nodeHandler()` | `(req, res)` listener for `node:http`, Express or Connect |
| `listen()` / `close()` | Lifecycle |

The server picks the model (`defaultModel`). The browser never needs a provider key or a
model name. Agents, knowledge (RAG) and memory are composed as tools and context with their own
packages (`@gixcopilot/agents`, `@gixcopilot/rag`, `@gixcopilot/memory`); see the Node guide.
