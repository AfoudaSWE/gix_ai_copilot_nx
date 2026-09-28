# @gixcopilot/generative-ui

> **Status:** Stable. See [stability levels](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/VERSIONING.md#stability-levels).

## Purpose

## Install

```bash
npm install @gixcopilot/generative-ui
```

Requires Node.js >=22.12.0. ESM only.

Framework-independent safe generative UI and AI-writable shared-state bridge for the AI
Copilot SDK (Phase 6). Lets an application register a small, trusted set of components the
model may ask to render - and a small set of state slots the model may propose changes to -
without ever letting the model generate executable code, an arbitrary component reference,
or an unvalidated state mutation.

## Responsibilities

- `createGenerativeComponentRegistry()` — register/get/list/unregister/subscribe a trusted
  `GenerativeComponentDefinition` (name, description, a Zod `propsSchema`, optional
  metadata). No React/Angular component reference lives here - see "Architecture" below.
- `toGenerativeUiToolDefinition()` — bridges one registered component into a reserved,
  frontend-executed `@gixcopilot/tools` `ToolDefinition` (`ui.render.<component>`), so
  "the model requests a UI component" reuses the entire Phase 5 tool-calling pipeline
  (schema validation, lifecycle events, cancellation) instead of inventing a parallel one.
- `toStatePatchToolDefinition()` — bridges one `modelWritable` `@gixcopilot/context` state
  slot into its own reserved tool (`state.patch.<id>`), so an AI-proposed state change goes
  through the exact same validated pipeline, and Section 45-46's revision/conflict handling
  (`CopilotStateStore.applyPatch()`, in `@gixcopilot/context`) is reused rather than
  duplicated here.
- `toProgressSteps()` — a pure projection of tool-call-shaped activity into `ProgressStep[]`
  (Section 50-52), reusing existing lifecycle events instead of a new progress event family.

## Public API

See `src/index.ts`. No deep imports into `src/` are supported.

## Dependencies

- `@gixcopilot/protocol` — indirectly, via `@gixcopilot/tools`'/`@gixcopilot/context`'s own
  use of `CopilotError`.
- `@gixcopilot/tools` — `ToolDefinition`, tool-name validation.
- `@gixcopilot/context` — `CopilotStateStore`, `StatePatch` for the state-patch bridge.

## Architecture: why "structured UI request" is a reserved tool call

The model never receives a free-text `{component, props}` envelope it fills in itself.
Instead, each registered component becomes its own reserved, precisely-typed tool
(`ui.render.<ComponentName>`). This means:

- **No arbitrary component imports** (a hard security requirement) is structural, not a
  runtime check: the model can only ever request a *tool name* present in its manifest, and
  the manifest only ever contains names this package derives from real, registered
  components.
- **Prop validation** is not reimplemented here - the reserved tool's `inputSchema` *is* the
  component's `propsSchema`, so `@gixcopilot/tools`' `ToolRuntime` validates it exactly the
  way it validates any other tool's arguments.
- **The tool runtime is never bypassed** (mandatory for Phase 7 Action Firewall
  compatibility) - rendering a generative component *is* a tool call.

See `docs/adr/0011-generative-ui-and-state-patch-architecture.md` for the full decision and
alternatives considered.

## Non-responsibilities

- **No React rendering.** `GenerativeComponentDefinition` deliberately has no
  `component: ComponentType` field - resolving a component name to an actual React
  component, and rendering it, is `@gixcopilot/react`'s job (`useGenerativeComponent`).
- **No security enforcement beyond schema validation.** `metadata`/tool metadata are
  classification only, same convention as `@gixcopilot/context`/`@gixcopilot/tools`. Phase 7
  owns real authorization.
- **No AI-based component selection.** The model picks from its own tool manifest like any
  other tool call - there is no extra "which component fits best" inference step here.

## Basic Usage

```ts
import { z } from 'zod';
import { createGenerativeComponentRegistry, toGenerativeUiToolDefinition } from '@gixcopilot/generative-ui';
import { createToolRegistry } from '@gixcopilot/tools';

const components = createGenerativeComponentRegistry();
const tools = createToolRegistry();

const registration = components.register({
  name: 'ApplicationCard',
  description: 'Displays a compact summary of one application.',
  propsSchema: z.object({ applicationId: z.string(), status: z.string() }),
});

tools.register(toGenerativeUiToolDefinition(components.get('ApplicationCard')!));
```

```ts
import { createCopilotStateStore } from '@gixcopilot/context';
import { toStatePatchToolDefinition } from '@gixcopilot/generative-ui';

const state = createCopilotStateStore();
state.register({ id: 'filters', name: 'applicationFilters', initialValue: { status: 'all' }, modelWritable: true });

const patchTool = toStatePatchToolDefinition(state, 'filters', {
  name: 'applicationFilters',
  description: 'Update the applications list status filter.',
});
```

## Documentation

- [generative-ui guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/generative-ui.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/generative-ui)

## License

MIT
