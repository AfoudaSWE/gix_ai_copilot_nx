# Application context and shared state

**Context** (`@gixcopilot/context`) is what the model may know about the application: items
registered by pages or components with a scope, priority and sensitivity. The engine resolves
them within a token budget, truncates or excludes by priority, and applies a data policy.
Nothing is sent implicitly.

- React: `useCopilotContext({ name, value, scope, priority, sensitivity })`
- Angular: `injectCopilotContext({ id, name, value })` (a signal value stays current)
- Diagnostics: `useCopilotContextDebug()` and the DevTools context inspector show exactly what
  was included, and why items were excluded.

**State** (`useCopilotState` / `injectCopilotState`) is shared application state with
validation. Exposing it to the model is opt-in (`exposeToModel`). The model can only
*propose* changes through the validated state-patch tool when `modelWritable` is set. The
application's validator decides; revisions prevent lost updates.

See ADR [0009](../adr/0009-context-and-state-architecture.md) and
`examples/react-context`.
