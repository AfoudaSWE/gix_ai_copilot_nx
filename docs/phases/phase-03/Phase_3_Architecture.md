# Phase 3 Architecture

## Dependency direction

An arrow means “depends on”; call flow can travel through injected interfaces in the
opposite direction. No framework-independent package gained a React dependency.

```text
                         Protocol
                        /        \
                    Client       Core
                      ^          ^  ^
                      |          |  Model Runtime <- Provider adapters
               @gixcopilot/react |       ^
                   ^       ^     Server -+
                   |       |
               Custom UI   @gixcopilot/ui
                             /   |   \
                           Chat Popup Sidebar
```

More explicitly: UI → React → Client → Protocol; React may also import protocol public
contracts. Server → Core and Provider contract; Provider contract → Core → Protocol;
provider adapters → Provider contract. Nx allows UI to import only UI/React workspace
packages and React to import only React/Client/Protocol. Examples compose both ends.

## Application and request flow

```text
Application
     |
CopilotProvider
     |
React SDK / local presentation store
     |
@gixcopilot/client
     |
Protocol events over existing HTTP/SSE transport
     |
Server -> Core -> Model Runtime -> Mock/OpenAI adapter
```

```text
User input -> sendMessage(text) -> optimistic protocol-shaped user message
           -> client.run({threadId, model?, messages})
           -> protocol events -> local immutable snapshot
           -> useSyncExternalStore hooks -> components
```

The provider's context identity stays stable during token updates. `useCopilot` subscribes
to no snapshot; messages/status/thread each have a narrow hook. The full chat hook exposes
all local state for custom applications. UI message renderers are memoized, and unchanged
message object identities survive deltas. There is no protocol parser or retry/backoff
implementation in either new package.

## State transitions and lifecycle

```text
idle --send--> submitting --first delta--> streaming --run.completed--> completed
                  |                         |
                  +---- failure ------------+----> error --retry--> submitting
                  +---- stop/cancel ---------+----> stopped
completed/stopped --regenerate--> submitting
any --clear--> idle (active run cancelled, local history/thread reset)
```

A response with no deltas can complete directly from submitting. `message.started`
creates one assistant message; each delta appends to that message; `message.end` replaces
its content with the authoritative final content. Chat completion waits for the terminal
run event. Unexpected EOF is an error. Terminal metadata resets when the next run starts.

Each active operation has an identity token. Stop invalidates it before cancelling the
client, so late events cannot overwrite a later run. Correlation checks additionally
validate the thread/run and discard non-increasing event sequences. Exactly one operation
is accepted at a time; busy submissions return false and are not queued.

Retry/regenerate replay a retained snapshot ending in the latest user message, replacing
only that turn's answer. Earlier conversation remains in the request. A new send after a
partial/stopped answer includes visible partial history; callers can regenerate or clear
if they prefer another policy.

Provider changes to client identity, URL, model values or thread ID reset the local store
and cancel the old run. StrictMode mount/cleanup starts no network work. Unmount disables
old actions and cancels the owned run. Empty initial rendering is deterministic for SSR.
Threads are local, created on the first send, and never persisted.

## UI

CopilotChat composes a header, initial invitation/message list, generation feedback and
input. Popup adds a native dialog, explicit Tab wrapping and focus restoration. Sidebar
adds a nonmodal in-flow aside and Escape handling. Both leave the provider mounted when
closed, retaining history and allowing an active request to finish.

Raw model content reaches an AST-to-React Markdown renderer with HTML/images disabled and
safe URL filtering. CSS is an explicit export with public tokens; JavaScript imports do
not access DOM globals. Host components can replace the five documented slots. Rendering
errors are contained and reported. Static suggestions carry no application context.
