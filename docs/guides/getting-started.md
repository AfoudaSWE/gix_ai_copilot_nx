# Getting started

From nothing to a streaming copilot: install, configure a provider, add a server, add a UI, run.

## One command

Inside an existing React, Vue or Angular app (or an empty folder):

```sh
npm create @gixcopilot@latest
```

The installer detects your framework and package manager, asks a few questions, installs the
right SDK package, adds a ready chat component and the `/api/copilot` dev proxy, and creates a
Node copilot server in `copilot-server/` (on by default). Then run `npm run copilot:server` and
your app's dev server. `--yes` accepts every default; `--dry-run` shows the plan first. The
steps below explain what it sets up.

## 1. Create a project

```sh
npx @gixcopilot/cli init my-copilot --template react    # or node, angular, enterprise
cd my-copilot
cp .env.example .env                                    # OPENAI_API_KEY=... (server-side only)
npm install                                             # npm 11+ or pnpm
npm run build && npm test
```

Without `OPENAI_API_KEY`, the generated server uses a clearly labelled development mock, so
everything runs without a paid key.

## 2. The server (the model provider lives here)

<!-- snippet: node-server.ts -->
```ts
import { createCopilot } from '@gixcopilot/node';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';

const copilot = createCopilot({
  model: { provider: 'openai', model: process.env['OPENAI_MODEL'] ?? 'gpt-4o-mini' },
  providers: [createOpenAIProvider({ apiKey: process.env['OPENAI_API_KEY'] })],
});

await copilot.listen({ port: 4000 });
```

The browser never talks to OpenAI and never sees a key: it talks to this server.

## 3. The UI

<!-- snippet: react-app.tsx -->
```tsx
import { createRoot } from 'react-dom/client';
import { CopilotProvider } from '@gixcopilot/react';
import { CopilotChat } from '@gixcopilot/ui';
import '@gixcopilot/ui/styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <CopilotProvider runtimeUrl="/api/copilot">
    <CopilotChat />
  </CopilotProvider>,
);
```

Proxy `/api/copilot` to the server in your dev server (the React template's `vite.config.ts`
does), then `npm start` and `npm run dev`, and chat.

## 4. Give it a capability

<!-- snippet: tool.ts -->
```ts
import { z } from 'zod';
import { defineTool } from '@gixcopilot/tools';

export const applicationsGet = defineTool({
  name: 'applications.get',
  description: 'Look up a visa application by id',
  input: z.object({ id: z.string() }),
  security: { risk: 'read-only', requiredPermissions: ['applications.read'] },
  execute: async ({ id }) => ({ id, status: 'under_review' }),
});
```

Pass it as `tools: [applicationsGet]`. Every call is schema-validated and goes through the
Action Firewall. `npx aicopilot add tool applications-get` generates this file with a test.

## Next

- [Concepts](concepts.md): runs, events, tools, the firewall, context, agents.
- [React](react.md), [Angular](angular.md), [Vue](vue.md), [Node](node.md).
- [Security](security.md) before exposing anything consequential.
- [Production](production.md) when you deploy.
