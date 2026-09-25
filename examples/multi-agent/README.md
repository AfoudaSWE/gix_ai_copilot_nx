# multi-agent

Phase 10 demonstration of multi-agent orchestration: a Support Orchestrator classifying a
request and delegating — in parallel, via the runtime's own same-turn fan-out — to
Application, Payment, and Knowledge specialists, each with a deliberately different tool.

## Run

```sh
pnpm --filter @gixcopilot/multi-agent-demo demo
```

Uses the deterministic mock model provider by default. For a real OpenAI run (every agent
then uses the same OpenAI model; tools, delegation, and permissions are unchanged):

```sh
MODEL_PROVIDER=openai OPENAI_API_KEY=sk-... pnpm --filter @gixcopilot/multi-agent-demo demo
```

`MODEL_NAME` optionally overrides the default `gpt-4o-mini`. Edit `main.ts`'s `securityContext` to a bare
`viewer` (no `payments.read` permission) to see the payment specialist's own tool call denied
while the orchestrator still completes.

## Test

```sh
pnpm --filter @gixcopilot/multi-agent-demo test
```

Includes the **mandatory security test** (Section 172, 186, 191): delegating to the payment
specialist never lets a caller without `payments.read` actually reach the payment tool's own
`execute()`, regardless of what the orchestrator or the specialist itself declares.
