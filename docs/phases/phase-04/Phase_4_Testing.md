# Phase 4 Testing

All commands below were actually executed in this session from the repository root; output
was observed, not assumed (per the testing/code-review skills).

## Previous-phase regression gate

Before any Phase 4 change, and again at the end, the full workspace suite (which *is*
Phase 1–3's regression suite — no Phase 1–3 test was modified, skipped, or removed) was run.
Result: **PASS** both times — see "Final full-workspace validation" below for the final run's
exact counts.

## New Phase 4 coverage

### `@gixcopilot/context` (`packages/context`)

```text
pnpm --filter @gixcopilot/context test
```

```text
src/context-serializer.spec.ts (13 tests)
src/context-compressor.spec.ts (3 tests)
src/token-estimator.spec.ts    (3 tests)
src/state-store.spec.ts        (9 tests)
src/context-registry.spec.ts   (10 tests)
src/context-engine.spec.ts     (12 tests)

Test Files  6 passed (6)
Tests       50 passed (50)
```

Covers: registration/update/patch/remove/dispose/clear, explicit-id vs. omitted-id identity
(Section 18), scope/enabled filtering, subscription notify/unsubscribe, multiple independent
registries (Section 68); primitive/object/array/`Date`/`bigint`/`undefined`/function/
DOM-like-node/circular-reference/class-instance/`toJSON`/oversized-string/oversized-array/
max-depth serialization, never throwing on adversarial input (Section 69); token estimation
determinism; truncating-compressor fit/shrink/zero-budget behavior; engine collection,
disabled/sensitivity-policy/serialization-failure/duplicate/budget exclusion with real
reasons, priority ordering, budget enforcement with high-priority-included/low-priority-
excluded, per-item compression before exclusion, `inspect()` projection, empty-registry
behavior (Section 70); state register/get/set/update/subscribe/unsubscribe/validation-
rejection/remove/list/multiple-store isolation (Section 71).

### `@gixcopilot/react` additions (`packages/react`)

```text
pnpm --filter @gixcopilot/react test
```

```text
src/context-hooks.spec.tsx            (6 tests)
src/context-model-integration.spec.tsx (3 tests)
src/provider.spec.tsx                  (7 tests)  <- unmodified Phase 3 suite
src/state-hooks.spec.tsx               (7 tests)

Test Files  4 passed (4)
Tests       23 passed (23)
```

`provider.spec.tsx` is the **exact, unmodified Phase 3 test file** — all 7 of its tests pass
unchanged, confirming Phase 3 chat behavior (StrictMode isolation, stop/retry/regenerate,
provider isolation, SSR) is untouched by the Phase 4 wiring (Section 72, 76).

New coverage: `useCopilotContext` registration/StrictMode-single-registration/value-update-
without-re-registration/unmount-cleanup/disabled-exclusion/provider-isolation (Section 72);
`useCopilotState` initial value/functional update/multi-component shared id/no-automatic-
model-exposure/explicit `exposeToModel` exposure-and-update/controlled mode/validation
rejection (Section 72); and the **mandatory model-integration test** (Section 73):
`context-model-integration.spec.tsx` proves a real `client.run()` call receives a leading
`system` message containing the resolved, formatted context — including a dynamic-update
case where changing the registered value changes what the *next* request contains (Section
53), and a no-context case proving zero behavior change from Phase 3 (Section 64).

### `examples/react-context` (mandatory E2E, Section 74)

```text
pnpm --filter @gixcopilot/react-context test
```

```text
src/integration.spec.tsx (3 tests)

Test Files  1 passed (1)
Tests       3 passed (3)
```

Real React UI → `useCopilotContext`/`useCopilotState` → context registry/engine → a real
`@gixcopilot/client` over real HTTP/SSE → a real (in-process) `@gixcopilot/server` → the
model runtime → a deterministic, non-network `context-aware` `ModelProvider` whose answer is
derived entirely from the request it received (`examples/react-context/src/backend.ts`).
Covers: selecting an application changes the resolved context and the model's next answer
(Section 74's exact required flow, including a `Regenerate` round-trip after changing the
selection); a status-filter (state) change reflected as exposed context; the "nothing
selected" fallback answer. No UI response is hardcoded independently of the request — the
answer text is parsed back out of what the provider actually received.

### Budget/size determinism (Section 56, 75)

Covered by `context-engine.spec.ts`'s "enforces the token budget" and "compresses an item
that nearly fits" tests (deterministic, no live model): with `maxContextTokens: 40`, a
`critical`-priority item and a `high`-priority item are included and a `low`-priority item is
excluded with `reason: 'budget'`; with a slightly-over-budget single item, the item is
included truncated rather than excluded.

## Final full-workspace validation

```text
pnpm lint        -> PASS (16 projects: protocol, core, context, client, server, react, ui,
                          provider, provider-mock, provider-openai, react-basic,
                          react-custom-ui, react-context, protocol-demo,
                          model-streaming-demo, react-e2e)
pnpm typecheck   -> PASS (same 16 projects)
pnpm test        -> PASS (15 projects with a `test` target)
pnpm build       -> PASS (15 buildable projects)
```

`pnpm test` totals: **228 tests passed, 1 pre-existing optional OpenAI smoke test skipped**
(no `OPENAI_API_KEY` set — the same, unmodified Phase 2 skip condition), **zero failures**,
across (project: tests passed):

```text
protocol 22 · core 29 · provider 28 · client 14 · context 50 · react 23 · server 13 · ui 17
provider-mock 9 · provider-openai 9 · react-basic 3 · react-custom-ui 1 · react-context 3
model-streaming-demo 3 (+1 skipped) · protocol-demo 4
```

(Read directly from each project's own Vitest summary line in this run's output, not
recomputed by hand.)

`pnpm build` succeeded for all 15 buildable projects; the pre-existing "use client module
directive may not be preserved when bundling" Rolldown/Vite warnings appear for
`@gixcopilot/react`'s and `@gixcopilot/ui`'s example bundles exactly as they did before
Phase 4 (new source files carry the same directive) — not a new warning class.

## Not run in this session

- **Playwright/Chromium browser suite** (`pnpm test:e2e`) — blocked by a pre-existing local
  process already bound to port `4318` (the fixed port `examples/react-basic`'s demo server
  and the Playwright config's `webServer` both use), not started by this session. It was not
  stopped without asking first. See [Issues](Phase_4_Issues.md) for detail. This suite
  exercises `@gixcopilot/ui`'s DOM/accessibility/keyboard behavior, which Phase 4 did not
  modify; Phase 4's own React-level and example-level tests above (30 new tests) exercise the
  new `useCopilotContext`/`useCopilotState` surface directly.
- No live/paid LLM provider was used anywhere in Phase 4 (per the testing skill's
  determinism requirement); the OpenAI smoke test's skip is pre-existing Phase 2 behavior,
  unrelated to this phase.
