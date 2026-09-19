# @gixcopilot/react

Headless React 19 adapter over `@gixcopilot/client` and `@gixcopilot/context`. It owns local
chat presentation state and the React bindings for application context/shared state, not the
protocol, transport, model runtime, or providers.

Packages are workspace-private and have not been published. From this repository run
`pnpm install && pnpm build`; an application package can depend on
`"@gixcopilot/react": "workspace:*"`. React is a peer dependency (`^19.0.0`), tested with
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
`useThread`, plus their explicit public types. No UI package, stylesheet, or state library
is required. All hooks require a provider. Imports and empty initial rendering are SSR
safe; the public entry has a `use client` directive for client-component consumers.

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

See the [full API](../../docs/phases/phase-04/Phase_4_API.md),
[architecture](../../docs/phases/phase-04/Phase_4_Architecture.md),
[ADR 0009](../../docs/adr/0009-context-and-state-architecture.md), and the
[application-context example](../../examples/react-context/README.md).
