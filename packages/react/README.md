# @gixcopilot/react

Headless React 19 adapter over `@gixcopilot/client`, `@gixcopilot/context`,
`@gixcopilot/tools`, and `@gixcopilot/generative-ui`. It owns local chat presentation state
and the React bindings for application context/shared state, tool calling, and generative
UI/AI-writable state — not the protocol, transport, model runtime, or providers.

## Install

```bash
npm install @gixcopilot/react react
```

Requires Node.js >=22.12.0. ESM only.

React is a peer dependency (`^19.0.0`), tested with
19.3.0. React DOM belongs to the host application.

```tsx
import { CopilotProvider, useCopilotChat } from '@gixcopilot/react';

function Chat() {
  const { messages, status, sendMessage, stop, retry, regenerate, clear } = useCopilotChat();
  return (
    <>
      {messages.map((message) => (
        <p key={message.id}>{message.content.map((part) => part.text).join('')}</p>
      ))}
      <button onClick={() => sendMessage('Explain SSE')}>Ask</button>
      <button onClick={stop}>Stop</button>
      <button onClick={retry}>Retry</button>
      <button onClick={regenerate}>Regenerate</button>
      <button onClick={clear}>Clear</button>
      <p>{status}</p>
    </>
  );
}

export function App() {
  return (
    <CopilotProvider runtimeUrl="/api/copilot">
      <Chat />
    </CopilotProvider>
  );
}
```

`runtimeUrl` is the API **base** URL: this example posts to `/api/copilot/runs`. The server
must route that prefix to the existing server SDK. Supply `client={existingClient}` instead
for custom fetch/authentication/transport configuration; do not send model API keys from a
browser. Optional `model={{ provider, model }}` selects the server's configured adapter.

Each provider has one local conversation and one active run. `sendMessage(text)` returns
whether it accepted the turn, **not** whether the run succeeded. Read `status` and `error`
for completion. Empty/busy/disposed sends return false. Stop preserves partial text and
aborts the actual client connection. Retry replaces a failed turn's partial response;
regenerate replaces a completed/stopped turn's response. Neither duplicates its user message.
Clear cancels and resets local history; no server memory is deleted.

Changing client identity, runtime URL, model values, or thread ID resets the conversation
and cancels the old run. Keep injected clients stable. Initial render starts no request.
Unmount cleans up the active run. Closing a UI panel does not unmount the provider.

Exports: `CopilotProvider`, `useCopilot`, `useCopilotChat`, `useCopilotStatus`, `useMessages`,
`useThread`, `useToolCalls`, plus their explicit public types. No UI package, stylesheet, or
state library is required. All hooks require a provider. Imports and empty initial
rendering are SSR safe; the public entry has a `use client` directive for client-component
consumers.

## Application context and shared state (Phase 4)

```tsx
import { useCopilotContext, useCopilotState } from '@gixcopilot/react';

function ApplicationDetails({ application }: { application: Application }) {
  useCopilotContext({
    name: 'selectedApplication',
    description: 'Application currently being viewed by the user',
    scope: 'page',
    priority: 'high',
    value: { id: application.id, status: application.status },
  });
  const [filters, setFilters] = useCopilotState({
    name: 'applicationFilters',
    initialValue: { status: 'all' },
    exposeToModel: { description: 'Current application filters' },
  });
  // ...
}
```

`useCopilotContext` registers application-aware context (see `ContextScope`/
`ContextPriority`/`ContextSensitivity`) for the lifetime of the calling component; it is
removed on unmount and updated in place on re-render. `useCopilotState` is a small typed,
shared state slot (`CopilotStateStore` under `@gixcopilot/context`) — state is **never**
automatically sent to a model; set `exposeToModel` explicitly to bridge a slot into context.
Resolved context reaches every run as a leading `system` message; a provider with nothing
registered behaves exactly as it did in Phase 3. `useCopilotContextDebug()` gives low-level
access to `resolve()`/`inspect()` for debugging what would be sent.

See the [Phase 4 API](../../docs/phases/phase-04/Phase_4_API.md),
[architecture](../../docs/phases/phase-04/Phase_4_Architecture.md),
[ADR 0009](../../docs/adr/0009-context-and-state-architecture.md), and the
[application-context example](../../examples/react-context/README.md).

## Tool calling (Phase 5)

```tsx
import { useFrontendTool } from '@gixcopilot/react';
import { z } from 'zod';

function useOpenApplicationTool(onOpen: (id: string) => void) {
  useFrontendTool({
    name: 'navigation.openApplication',
    description: 'Open an application details view by its id.',
    input: z.object({ applicationId: z.string() }),
    execute({ applicationId }) {
      onOpen(applicationId);
      return Promise.resolve({ opened: true, applicationId });
    },
  });
}
```

`useFrontendTool` registers a browser-executed tool for the lifetime of the calling
component, validated by the same `@gixcopilot/tools` `ToolRuntime` pipeline a backend tool
uses. `useToolCalls()` exposes the current run's tool activity timeline headlessly; the
default `CopilotChat` UI (`@gixcopilot/ui`) renders it automatically.

See the [Phase 5 API](../../docs/phases/phase-05/Phase_5_API.md),
[architecture](../../docs/phases/phase-05/Phase_5_Architecture.md),
[ADR 0010](../../docs/adr/0010-canonical-tool-architecture.md), and the
[tools example](../../examples/react-tools/README.md).

## Generative UI and AI-writable shared state (Phase 6)

```tsx
import { useCopilotState, useGenerativeComponent, useInvokeTool, useToolRenderer } from '@gixcopilot/react';

function ApplicationCard({ applicationId, status }: { applicationId: string; status: string }) {
  const invoke = useInvokeTool();
  return (
    <div>
      {applicationId}: {status}
      <button onClick={() => invoke('navigation.openApplication', { applicationId })}>Open</button>
    </div>
  );
}

useGenerativeComponent({
  name: 'ApplicationCard',
  description: 'Displays a compact application summary',
  props: z.object({ applicationId: z.string(), status: z.string() }),
  component: ApplicationCard,
});

useToolRenderer({
  tool: 'applications.getStatus',
  render: ({ status, result }) => status === 'succeeded' ? <StatusBadge {...result} /> : null,
});

const [filters, setFilters] = useCopilotState({
  name: 'applicationFilters',
  initialValue: { status: 'all' },
  exposeToModel: { description: 'Current application filters' },
  modelWritable: true,
});
```

`useGenerativeComponent` registers a trusted, model-selectable component — the model can
only ever select it by name and supply schema-validated props (via the same
`ToolRuntime` pipeline `useFrontendTool` uses); it never generates executable code.
`useToolRenderer` attaches a custom renderer to any tool's activity, generative or not.
`useInvokeTool` lets a rendered component's own event handler call a registered tool
*directly*, with no additional model round trip. `useCopilotState`'s `modelWritable` option
lets a validated AI-proposed patch update a shared state slot, with revision-based conflict
detection — a stale patch is safely rejected, never silently overwriting a newer value.

See the [Phase 6 API](../../docs/phases/phase-06/Phase_6_API.md),
[architecture](../../docs/phases/phase-06/Phase_6_Architecture.md),
[ADR 0011](../../docs/adr/0011-generative-ui-and-state-patch-architecture.md), and the
[generative-UI example](../../examples/react-generative-ui/README.md).

## Documentation

- [react guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/react.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/react)

## License

MIT
