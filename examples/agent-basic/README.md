# agent-basic

Phase 10 demonstration of a single `@gixcopilot/agents` agent: a model, a real backend tool
(`applications.get`), real knowledge retrieval (`knowledge.search`, backed by
`@gixcopilot/rag`'s in-memory vector store), real durable memory (`memory.recall`/
`memory.save`, backed by `@gixcopilot/memory`'s in-memory store), and a trusted
`SecurityContext` — never taken from model output.

## Run

```sh
pnpm --filter @gixcopilot/agent-basic-demo demo
```

Uses the deterministic mock model provider by default. For a real OpenAI run:

```sh
MODEL_PROVIDER=openai OPENAI_API_KEY=sk-... pnpm --filter @gixcopilot/agent-basic-demo demo
```

## Test

```sh
pnpm --filter @gixcopilot/agent-basic-demo test
```

Deterministic end-to-end coverage (no credentials required): a real tool call, a real
knowledge retrieval, a real memory save/recall round trip, and a mandatory security test
proving one user's memory is never visible to another (Section 132, 188).
