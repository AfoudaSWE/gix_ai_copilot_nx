---
name: angular-sdk
description: Angular SDK standards - services, DI, signals, directives, and the requirement to wrap the same framework-independent core rather than reimplement runtime logic. Load when writing or reviewing @aicopilot/angular code.
---

# Purpose

Define how the Angular adapter wraps the same framework-independent core the React adapter
uses, so behavior stays consistent across frameworks per [[project-architecture]].

# When to Apply

Writing or reviewing any Angular service, directive, component, or provider in the Angular
SDK package.

# Required Rules

- The Angular package must not reimplement runtime, protocol, or state logic that already
  exists in the framework-independent core — it adapts that core to Angular idioms only.
- Expose core state via Angular services using signals as the primary reactive primitive;
  use RxJS only where a stream-based API is genuinely a better fit (e.g. bridging an
  event-emitter-style core API), not as a default.
- Use Angular's dependency injection (`providedIn: 'root'` or explicit providers) to supply
  the copilot client/service — no hidden global singletons outside DI.
- Any directive/component provided by this package is a thin presentation layer over the
  injected service's state and actions, mirroring the headless-first principle in
  [[react-sdk]] and [[sdk-design]].
- Angular-specific concerns (zones, change detection, `OnPush` compatibility) are handled
  inside this adapter package only, never leaking into the core's public types.
- Any UI subcomponents shipped here meet the same [[accessibility]] bar as the React
  components.

# Architecture / Patterns

```text
CopilotService (Angular, DI-provided)
   ↓ wraps
Core client / runtime (framework-independent)
```

The Angular service subscribes to core events/state and exposes them as signals (and RxJS
observables where appropriate), mirroring the hook surface described in [[react-sdk]]
(chat state, thread state, agent state, context registration, shared state, frontend tools)
without duplicating their implementation.

# Anti-Patterns

- A second, Angular-specific implementation of streaming/reconnect/tool-execution logic
  that diverges from the core's behavior.
- Components that are not `OnPush`-compatible by default, causing needless change-detection
  churn across a host app.
- Exposing a core type through an Angular-specific wrapper type instead of the shared
  protocol type.

# Validation Checklist

- [ ] No runtime/protocol logic reimplemented in the Angular package
- [ ] Public state exposed via DI-provided services using signals (RxJS only where justified)
- [ ] Components are change-detection-friendly (`OnPush` compatible)
- [ ] Shipped UI meets the [[accessibility]] checklist
- [ ] Angular package has no dependency on the React package or vice versa
