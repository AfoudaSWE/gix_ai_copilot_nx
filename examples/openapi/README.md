# Phase 8 OPENAPI example

A real local HTTP API supplies generated canonical tools. The server uses the existing Action Firewall, authentication and approval store. Read operations run under the demo identity; writes wait for human confirmation. The primary CLI uses the configured real OpenAI provider.

From the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @gixcopilot/example-openapi test
```

Copy this example's `.env.example` to `.env`, set your local OpenAI credentials, then run:

```powershell
pnpm --filter @gixcopilot/example-openapi demo "What is the status of application APP-1001?"
```

Do not commit `.env`. The CLI reads it only in the Node process and asks y/N when a write requires approval. Demo credentials and data are local test fixtures, not production authentication.

Deterministic integration tests use a test-only model provider and real local transports. Live tests additionally require `RUN_OPENAI_SMOKE=1` and `OPENAI_API_KEY` in the test process. See the [handoff](../../docs/phases/phase-08/Phase_8_Handoff.md) for exact commands and the [testing record](../../docs/phases/phase-08/Phase_8_Testing.md) for actual results.

The OpenAPI example explicitly selects four of five operations; DELETE remains inactive. The MCP example explicitly configures three tools. Both return generation reports and share the canonical registry/runtime; neither implements a second approval engine.
