# Phase 2 Handoff

For whoever picks up the next phase that touches the model runtime, or Phase 3 (React
Copilot UI) if it needs to know what's underneath it.

## What Exists Now

- A real, provider-independent model runtime (`@aicopilot/provider`) with retry, timeout,
  cancellation, usage, latency, and normalized errors — proven against both a deterministic
  mock provider and a real OpenAI adapter.
- `@aicopilot/server` can run a request against either the Phase 1 default executor or a
  named model, decided per-request by the presence of a `model` field.
- `@aicopilot/client` passes `model` through opaquely; it has no idea what a `ModelRuntime`
  is and doesn't need to.
- Two example apps: `protocol-demo` (Phase 1, no AI) and `model-streaming` (Phase 2, mock
  by default, optional real OpenAI).

## What Phase 3 (React Copilot UI) Can Rely On

- `@aicopilot/client`'s public API (`createCopilotClient`, `RunOptions`, `ClientRun`) is
  unchanged in shape from a consumer's perspective except for the additive `model` field —
  a hook wrapping this client does not need to know whether a given run is model-backed.
- Every `CopilotEvent` a UI might render is exactly the same set as Phase 1, plus the
  optional `finishReason` on `run.completed` — no new event types were introduced.

## What Phase 3 Should NOT Assume

- There is no tool-calling, no function-calling, no structured output support yet — a
  `tool`-role message is explicitly rejected by the OpenAI adapter with a clear
  `VALIDATION_ERROR` (Phase 5's territory).
- There is no model selection UI/logic beyond a caller explicitly naming
  `{ provider, model }` — no routing, no fallback, no cost awareness (Section 35/36,
  intentionally deferred).
- `usage` may be `undefined` on `run.completed` for any run (model-backed or not) — never
  assume it's populated.

## Extending the Provider Set

Adding a new real provider (Anthropic, Gemini, Ollama) is a new package,
`@aicopilot/provider-<name>`, depending only on `@aicopilot/provider`, `@aicopilot/protocol`,
and that provider's own SDK, implementing `ModelProvider`, tagged `scope:provider-adapter`
in its `project.json`. No change to `@aicopilot/core`, `@aicopilot/server`, or
`@aicopilot/client` is needed — register the new provider alongside existing ones in
whichever `createModelRuntime({ providers: [...] })` call constructs the runtime being used.

## Known Limitations Carried Forward

See `docs/architecture/overview.md`'s "Known Limitations" section and
`docs/TECHNICAL_DEBT.md` — nothing blocking, but worth knowing before building on top:
process-local run registry, real-timer retry backoff in tests, plain-string (not branded)
IDs.

## Do Not

Per the phase-gate skill: do not start Phase 3 (React Copilot UI), do not create React SDK
packages, do not implement Copilot UI components or hooks, in this or any follow-on work
unless the user explicitly requests Phase 3.
