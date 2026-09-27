# Next.js

Host the copilot API inside a Next.js app (App Router) with `copilot.fetchHandler()`, a
web-standard `Request` → `Response` handler that streams server-sent events. The React UI in the
same app (or any other app) calls `/api/copilot`.

<!-- snippet: next-route.ts -->
```ts
// app/api/copilot/[...path]/route.ts (Next.js App Router)
import { createCopilot } from '@gixcopilot/node';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import { crm } from './connector.js';

const copilot = createCopilot({
  model: { provider: 'openai', model: 'gpt-4o-mini' },
  providers: [createOpenAIProvider({ apiKey: process.env['OPENAI_API_KEY'] })],
  tools: [...crm.tools],
});

const handler = copilot.fetchHandler({ basePath: '/api/copilot' });
export const GET = handler;
export const POST = handler;
export const runtime = 'nodejs'; // streaming SSE on the Node.js runtime
export const dynamic = 'force-dynamic';
```

- The catch-all segment (`[...path]`) routes `/api/copilot/runs`, `/api/copilot/health` and the
  approval routes; `basePath` must match the folder.
- Use the **Node.js runtime** and `force-dynamic` so responses stream and are never cached.
- The model key stays in the server environment (`OPENAI_API_KEY`), never in `NEXT_PUBLIC_*`.
- Authentication: pass `security: { authentication }` to `createCopilot`; the adapter reads the
  incoming request headers (cookies or `Authorization`).
- Tools from [any API](connectors.md), [OpenAPI](openapi.md) or hand-written ones are passed as
  `tools`.

## The UI

```tsx
'use client';
import { CopilotProvider } from '@gixcopilot/react';
import { CopilotChat } from '@gixcopilot/ui';
import '@gixcopilot/ui/styles.css';

export function Copilot() {
  return (
    <CopilotProvider runtimeUrl="/api/copilot">
      <CopilotChat />
    </CopilotProvider>
  );
}
```

## Alternative: a separate copilot server

If the API should run as its own service, start it with `copilot.listen()` (or
`npm create @gixcopilot`, which generates one) and forward the path in `next.config`:

```js
async rewrites() {
  return [{ source: '/api/copilot/:path*', destination: 'http://127.0.0.1:4000/:path*' }];
}
```

The same `fetchHandler()` also works in Remix/React Router actions, Hono, Bun and Deno.
