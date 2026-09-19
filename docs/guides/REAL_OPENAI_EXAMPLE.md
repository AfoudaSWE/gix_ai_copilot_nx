# Guide: running an example against a real OpenAI model

This is a short pointer, not a new architecture doc. It exists because `examples/react-
generative-ui` is (as of this writing) the one example whose *default, real* server entry
point (`pnpm server`) always talks to a real OpenAI model rather than a mock provider - other
examples in this repository (`react-basic`, `model-streaming`, `protocol-demo`) either always
use `@gixcopilot/provider-mock` or offer a live provider as an opt-in alongside the mock.

See `examples/react-generative-ui/README.md` for the full setup, security notes, and
troubleshooting for that example specifically.

## What this proves architecturally

Nothing about `@gixcopilot/provider`, `@gixcopilot/provider-openai`, `@gixcopilot/server`,
`@gixcopilot/core`, `@gixcopilot/tools`, `@gixcopilot/generative-ui`, or `@gixcopilot/react`
changed to make this possible. The example's `src/backend.ts` builds a `ModelRuntime` with
`createOpenAIProvider({ apiKey })` as its sole registered `ModelProvider` and passes it to the
exact same `createServer()` call the mock-backed test suite uses with
`createMockGenerativeUiProvider()` instead. Swapping providers is the intended integration
point (see the Phase 2 provider-architecture docs); no other layer needed to change, and none
did.

## The pattern, if you want to do this in another example or app

1. Add `@gixcopilot/provider-openai` as a dependency.
2. Read `OPENAI_API_KEY` (and any other config) **only** in server-side code, and fail fast
   with a clear error if it's missing - never fall back to a mock silently in what's meant to
   be the real path.
3. Build the `ModelRuntime` with `createOpenAIProvider({ apiKey })` and pass it to
   `createServer()` exactly as you would any other provider.
4. If the browser needs to display the model name, forward only that string through your
   bundler's env mechanism (e.g. Vite's `loadEnv` + `define`) - never the API key. Verify
   after a production build by grepping the output bundle for the key/its env var name.
5. Keep a separate, deterministic, credential-free mock path for your own automated tests;
   do not let them depend on network access or a real key.
6. Optionally add a `describe.skipIf(!apiKey)` real-provider smoke test for local/manual runs
   - it should never fail CI when no key is configured, only report as skipped.

## Related docs

- `packages/providers/openai/README.md` - the provider package itself.
- `docs/phases/phase-02/` - the provider-runtime architecture this relies on.
- `docs/phases/phase-05/` - the tool-calling pipeline the example's tools ride on.
- `docs/phases/phase-06/` - the generative-UI/state-patch reserved-tool mechanism the example
  demonstrates.
