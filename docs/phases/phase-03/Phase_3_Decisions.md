# Phase 3 Decisions

- [ADR 0007](../../adr/0007-headless-react-state-and-lifecycle.md): separate headless React
  and visual packages; provider-scoped immutable snapshots with narrow external-store
  subscriptions; one active run; explicit stopped state; deterministic retry/regenerate
  semantics; configuration changes reset local sessions; React 19 peer policy.
- [ADR 0008](../../adr/0008-copilot-ui-rendering-and-styling.md): exported CSS and semantic
  tokens; native modal popup with Tab wrapping; nonmodal sidebar; component slots; safe
  Markdown/GFM with raw HTML/images disabled; no highlighter, Storybook or attachment shell.
- Preserve the actual `@gixcopilot/*` scope and existing NodeNext/project-reference build
  strategy. The brief's `@aicopilot/*` examples map directly to this established scope.
- Use a synchronous acceptance result for user actions and asynchronous errors in state.
  This avoids unhandled promise rejection paths in event handlers and preserves submitted
  text on failures. It does not replace the client's own async-iterable run API.
- No breaking changes to Phase 1–2 public APIs or protocol events. New APIs are additive,
  version 0.1.0 and private, with no npm publication performed in this task.
- API base URL semantics are explicit: `/api/copilot` becomes `/api/copilot/runs` using the
  existing transport. Examples solve same-origin routing with a development proxy.
- A closed UI panel preserves the provider's conversation and active request; applications
  can explicitly stop on close. Provider unmount always cancels.

Phase 4 remains locked/not started. Application context, shared state, tools, generated
components, approvals, knowledge retrieval and agents have no implementation here.
