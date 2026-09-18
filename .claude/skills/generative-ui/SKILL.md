---
name: generative-ui
description: Safe generative UI architecture - the model requests structured, schema-validated components from a trusted registry; it never generates executable code. Load when building any UI the model can drive.
---

# Purpose

Define how the model can drive UI rendering without ever generating executable code, so
generative UI cannot become a code-injection vector.

# When to Apply

Building any feature where model output determines what UI is rendered (tool-result
rendering, structured component requests, interactive AI-driven UI).

# Required Rules

- **The model must never generate executable JavaScript or arbitrary React/Angular code
  that gets evaluated or rendered directly.** This is a hard rule with no exception.
- The model may only emit a structured, schema-validated "component request" (a name plus
  props matching a declared schema) — never markup, code, or a template string that is
  interpreted as code.
- Every component request is validated against a Zod schema before it is allowed to reach
  rendering; a request that fails validation is rejected and never rendered, not
  best-effort coerced.
- Components are resolved only from a trusted, pre-registered Component Registry mapping a
  known component name to an actual application-authored component — the model can select
  from this registry, it cannot introduce new entries into it.
- Props passed into a registered component are exactly the validated, schema-typed props —
  never raw, unvalidated strings interpolated into HTML/DOM or `dangerouslySetInnerHTML`-
  style sinks.
- Streaming UI updates (partial component data arriving incrementally) still validate the
  final assembled payload against the schema before render; partial/incomplete data is
  shown via an explicit loading state, not a best-effort partial render of unvalidated data.
- Interactive actions surfaced by a generated component (e.g. a button that triggers a tool
  call) go through the normal [[tool-system]] and [[action-firewall]] pipeline — a
  generative UI component is never a way to bypass tool security.
- Errors in rendering a requested component (unknown name, schema mismatch) degrade to a
  safe fallback UI, never to executing the malformed payload as a last resort.

# Architecture / Patterns

```text
Model
  ↓ emits
Structured component request  { component: "OrderCard", props: {...} }
  ↓ validated by
Schema Validation (Zod, per-component prop schema)
  ↓ resolved against
Trusted Component Registry (name → real component, model cannot add entries)
  ↓ rendered as
React / Angular component (existing, application-authored)
```

# Anti-Patterns

- Evaluating a model-returned string as JSX/JS/HTML (`eval`, `new Function`,
  `dangerouslySetInnerHTML` with model content).
- A "component registry" that accepts an arbitrary component name/URL supplied by the
  model at runtime.
- Rendering partially-streamed component data before the full payload passes schema
  validation.
- A generated component's button directly performing a mutation instead of dispatching a
  validated tool call through the firewall.

# Validation Checklist

- [ ] Model output never reaches `eval`, `new Function`, or an HTML-injection sink
- [ ] Every component request is Zod-validated before rendering
- [ ] Component resolution only ever hits the pre-registered, trusted registry
- [ ] Component-triggered actions route through [[tool-system]] + [[action-firewall]]
- [ ] Invalid/unknown component requests render a safe fallback, not raw model output
