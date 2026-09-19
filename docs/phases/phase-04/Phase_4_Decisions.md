# Phase 4 Decisions

Full reasoning lives in [ADR 0009](../../adr/0009-context-and-state-architecture.md). This
page summarizes the decisions and the smaller ones that didn't rise to ADR-worthy.

## ADR 0009 summary

1. `@gixcopilot/context` depends only on `@gixcopilot/protocol` (for `CopilotError`) — never
   React, never a provider SDK, never `core`/`client`/`server`.
2. Resolved context reaches the model as a leading `system` message, built entirely inside
   `@gixcopilot/react`; `protocol`/`core`/`server` are untouched.
3. Context resolution can return synchronously when nothing is registered, preserving
   Phase 3's exact same-tick `client.run()` dispatch timing.
4. State and context are separate stores; state is exposed to a model only via an explicit
   `exposeToModel` option, which composes `useCopilotContext` rather than a parallel path.
5. Deduplication/identity comparisons are exact (serialized-text or explicit-id), never
   fuzzy similarity.
6. `ContextCompressor` operates per-item, not on the whole `ResolvedContext` — narrower than
   the brief's illustrative sample, deliberately.
7. Sensitivity is metadata with one conservative default (exclude `restricted`), not
   enforcement.
8. `useCopilotContext`'s default id is React's own `useId()`; registration/patch are two
   separate effects so a value change never tears down and recreates the registration.

## Smaller decisions

- **Priority is a closed 4-tier enum (`critical`/`high`/`normal`/`low`), not a numeric
  scale.** A numeric scale invites meaningless comparisons ("47 vs 48") with no documented
  semantics; four named tiers is the "one clean model" Section 20 asks for.
- **The `'invalid'` exclusion reason exists in the type but has no runtime code path today.**
  `ContextRegistry.register/update/patch` already reject a blank name at admission time, so
  every item the engine sees is structurally valid — adding a redundant runtime check would
  validate a scenario that cannot happen. The type stays for a future schema-validated
  registration path (see the context-engine skill's exclusion-reason list, Section 35).
- **A minimum compressible budget (16 tokens) gates compression.** Below that, compressing
  an item would produce a near-useless fragment; the engine excludes it outright instead.
  This is a Phase 4 implementation choice, not something the brief specifies numerically —
  documented here so a future tuning pass has the rationale, not just the constant.
- **The default token estimator is a ~4-chars-per-token heuristic**, explicitly documented as
  an approximation (Section 26 requires exactly this — no tokenizer dependency in the core
  package). `ContextEngineOptions.estimator` lets a host swap in a real tokenizer.
- **`useCopilotState`'s controlled mode requires *both* `value` and `onChange`.** Supplying
  only one falls back to uncontrolled behavior rather than throwing — a deliberate
  simplification; adding validation for a "half-controlled" combination that is unlikely and
  cheap to reason about would be over-engineering for this phase.
- **Two components sharing a state `id` share one slot**, not independent copies — matching
  the everyday "shared state" use case (Section 42) rather than requiring a host to lift
  state manually.
- **No dependency was added anywhere.** The serializer, token estimator, and compressor are
  all hand-written; none of them needed a third-party library (see [Implementation](Phase_4_Implementation.md)).
