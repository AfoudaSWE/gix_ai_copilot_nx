# @gixcopilot/context

## Purpose

## Install

```bash
npm install @gixcopilot/context
```

Requires Node.js >=22.12.0. ESM only.

Framework-independent application context and shared state engine for the AI Copilot SDK
(Phase 4). Lets an application tell the Copilot what it is currently looking at - and gives
it a typed, subscribable place to keep shared state - without any dependency on React,
Angular, or a specific LLM provider.

## Responsibilities

- `createContextRegistry()` — register/update/remove/list/subscribe application context
  items, each scoped (`global`/`user`/`application`/`page`/`component`/`session`/
  `temporary`), prioritized, and tagged with a sensitivity level.
- `createDefaultContextSerializer()` — the controlled boundary that turns an arbitrary
  application value into safe, model-facing text (handles `undefined`, `Date`, `bigint`,
  circular references, functions, DOM-like nodes, class instances, and oversized
  strings/arrays deterministically, never by throwing or emitting invalid JSON).
- `createDefaultTokenEstimator()` — a dependency-free, provider-neutral token estimate.
- `createTruncatingCompressor()` — the deterministic default for the `ContextCompressor`
  extension point (a foundation for future summarization, not built in Phase 4).
- `createContextEngine()` — the pipeline: collect → validate → serialize → filter
  (enabled/sensitivity) → deduplicate → prioritize → budget/truncate → `ResolvedContext`,
  plus `inspect()` for debugging what was included/excluded and why.
- `createCopilotStateStore()` — a small, typed, subscribable shared-state store. State is a
  distinct concept from context (see "State vs Context" below) and is never automatically
  exposed to a model. Extended in Phase 6 with a per-slot `revision`, an opt-in
  `modelWritable` capability flag, and a validated, non-throwing `applyPatch()` pipeline
  (`'applied' | 'conflict' | 'rejected'`) — see "AI-writable state" below.

## Public API

See `src/index.ts`. No deep imports into `src/` are supported (the package's `exports`
field only exposes `.`).

## Dependencies

- `@gixcopilot/protocol` — reused only for `CopilotError`, so context/state errors share the
  SDK's one error taxonomy instead of inventing a parallel one.

## Non-responsibilities

- **No React/Angular.** `@gixcopilot/react`'s `useCopilotContext`/`useCopilotState` are thin
  adapters over this package (see `docs/adr/0009-context-and-state-architecture.md`).
- **No AI-based context selection.** Resolution is deterministic (scope/priority/budget),
  not an extra LLM call to pick relevant context (Section 19 of the Phase 4 brief).
- **No security enforcement.** Sensitivity metadata and the default "exclude `restricted`"
  policy are a foundation only - never an authorization mechanism. See the security skill
  and Phase 7.
- **No durable memory.** `session`/`temporary` context and shared state are in-memory for
  the life of the registry/store; nothing here persists across page loads or is Copilot
  "memory" (a later phase's concern).

## State vs Context

- **State** is mutable application/Copilot data (e.g. `applicationFilters`).
- **Context** is what has been selected/prepared for model consumption (e.g. "Current
  filters are: status = pending").

State is not automatically sent to the model. Exposing a state value to a model is an
explicit, separate act — see `@gixcopilot/react`'s `useCopilotState({ exposeToModel })`.

## Basic Usage

```ts
import { createContextRegistry, createContextEngine } from '@gixcopilot/context';

const registry = createContextRegistry();
const engine = createContextEngine({ maxContextTokens: 4000 });

const registration = registry.register({
  name: 'selectedApplication',
  description: 'Application currently selected by the user',
  scope: 'component',
  priority: 'high',
  value: { id: 'APP-1024', status: 'pending' },
});

const resolved = await engine.resolve(registry);
console.log(resolved.content); // ready to place into a model request

registration.update({ id: 'APP-1024', status: 'approved' });
registration.dispose();
```

```ts
import { createCopilotStateStore } from '@gixcopilot/context';

const state = createCopilotStateStore();
state.register({ id: 'filters', name: 'applicationFilters', initialValue: { status: 'all' } });
state.subscribe('filters', (value) => console.log('filters changed', value));
state.update('filters', (previous) => ({ ...previous, status: 'pending' }));
```

## AI-writable state (Phase 6)

A slot registered with `modelWritable: true` accepts a validated, revision-checked patch —
never a direct, untrusted write:

```ts
state.register({ id: 'filters', name: 'applicationFilters', initialValue: { status: 'all' }, modelWritable: true });

const result = state.applyPatch('filters', { op: 'set', value: { status: 'pending' } }, state.getRevision('filters')!);
// { status: 'applied', revision: 1, value: { status: 'pending' } }
//   | { status: 'conflict', currentRevision: number }   <- baseRevision was stale
//   | { status: 'rejected', reason: '...', detail?: string }
```

`revision` increments on **every** successful `set`/`update`/`applyPatch`, so a UI-driven
change also invalidates a stale AI-proposed `baseRevision` — see
`docs/adr/0011-generative-ui-and-state-patch-architecture.md`. `@gixcopilot/generative-ui`
bridges a `modelWritable` slot into a reserved tool a model calls to propose a patch;
`@gixcopilot/react`'s `useCopilotState({ modelWritable: true })` wires this up automatically.

## Documentation

- [context-and-state guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/context-and-state.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/context)

## License

MIT
