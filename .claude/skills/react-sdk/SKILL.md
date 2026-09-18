---
name: react-sdk
description: React SDK standards - provider architecture, headless hooks, render optimization, accessibility, SSR, and error boundaries. Load when writing or reviewing any @gixcopilot/react code.
---

# Purpose

Define how the React adapter wraps the framework-independent core without duplicating logic
or leaking React-specific concerns into the core.

# When to Apply

Writing or reviewing any component, hook, or provider in the React SDK package.

# Required Rules

- All business logic lives in the framework-independent core/client; React hooks are thin
  subscriptions/adapters over it — never reimplement runtime logic inside a hook.
- Ship headless hooks (state + actions, no rendered markup) as the primary API; optional
  pre-built UI components are a separate, clearly labeled layer on top.
- Provide both controlled and uncontrolled usage patterns where relevant (e.g. a component
  can manage its own state or accept externally managed state via props/hooks).
- Minimize re-renders: hook state updates are scoped narrowly (e.g. per-message, not whole-
  thread) and memoization (`useMemo`/`useCallback`/context splitting) is applied where a
  broad context would otherwise cause unrelated re-renders.
- Respect React state boundaries: do not mutate objects held in state; treat protocol
  events/messages as immutable per [[typescript-standards]].
- Accessibility is not optional — see [[accessibility]] for the specific requirements any
  shipped UI component must meet.
- SSR-safety: hooks and providers must not assume `window`/`document` exist at module
  init; browser-only APIs are guarded and deferred to effects.
- Error boundaries wrap any provided UI components so a rendering failure in one part of
  the copilot UI does not crash the host application.
- Use `Suspense` only where it materially simplifies a real async boundary (e.g. code-
  split UI) — not as a default pattern for data fetching that streaming/hooks already
  handle.
- The React package has no knowledge of Angular, and vice versa ([[angular-sdk]]); shared
  behavior lives in the core, not copy-pasted between adapters.

# Architecture / Patterns

Planned surface (design target, not an implementation instruction for this task):

```text
CopilotProvider        - supplies core client/context via React context
useCopilot              - low-level access to the client/runtime
useCopilotChat          - message list + send/stream actions
useAgent                - agent run state and control
useMessages / useThread - thread/message state
useCopilotContext       - application context registration
useCopilotState         - shared state read/write
useFrontendTool         - register a frontend tool (see [[tool-system]])
```

Each hook subscribes to a narrow slice of core state so consumers only re-render on
relevant changes.

# Anti-Patterns

- A hook that reimplements streaming/reconnect logic instead of delegating to the core
  client.
- A single giant `CopilotContext` value that changes identity on every keystroke, causing
  the whole tree to re-render.
- Reading `window.localStorage` at module scope, breaking SSR.
- Shipping a UI component with no keyboard focus management or ARIA roles.

# Validation Checklist

- [ ] No runtime/business logic duplicated inside a hook instead of the core
- [ ] Headless hook API exists independent of any bundled UI component
- [ ] State updates are scoped to avoid unnecessary re-renders
- [ ] No unguarded browser-global access at module scope (SSR-safe)
- [ ] Shipped UI components pass the [[accessibility]] checklist
