# Phase 11 decisions

| ADR | Decision |
| --- | --- |
| [0016](../../adr/0016-telemetry-and-diagnostics-architecture.md) | One `TelemetryAdapter` port (no-op default, OpenTelemetry, recording); our own semantic conventions; a versioned internal diagnostics channel kept off the public protocol; duck-typed wrappers at runtime seams; safe redaction modes; span-only head sampling; audit is not trace |
| [0017](../../adr/0017-devtools-observes-the-runtime.md) | DevTools is a pure, viewer-scoped projection of recorded diagnostics; opt-in, authenticated, production-refusing, read-only transport; exports never looser than the recording; separate React app consuming the API or bundles |
| [0018](../../adr/0018-testing-harness-and-safe-replay.md) | Only the model is scripted in tests; fixtures use the real security, RAG, memory, approval, agent and workflow code; replay simulates every tool unless explicitly allowlisted, and then still passes the firewall |
| [0019](../../adr/0019-evaluation-model-and-security-hard-gates.md) | Versioned datasets; execution records derived from recordings; evaluator contract with evidence; security results are an unconditional hard gate; heuristics labeled; comparison, experiments and reports never hide failures |

## Smaller decisions

1. **No new protocol events** (Section 150-152). Everything DevTools needs travels on the
   diagnostics channel, so the protocol version is unchanged.
2. **Agent visibility as span attributes**, not new events: what an agent could see (tools,
   knowledge, memory, model, limits) is a fact about its run, recorded once when resolved.
3. **Workflow graph shape as a span attribute** (`id:type:deps`), so the DevTools graph and eval
   snapshots do not depend on having the workflow definition at hand.
4. **Approval waits are separate spans joined by run id**, since the human wait crosses request
   boundaries; they are not forced under the request trace.
5. **Resumed approval steps are projected as completed.** The engine completes an approved step
   inside `resume()` without a step event, and DevTools mirrors that; a rejection emits failure
   events instead.
6. **Raw view is gated on the recording mode**, not a UI permission: a `redacted` recording has
   nothing more to show safely.
7. **Manual tool execution is not implemented** (Section 164 made it optional). A DevTools
   execution console would be a second path to side effects.
8. **CLI deferred to Phase 12** (Section 130). `pnpm eval` in `examples/evals` is the foundation.
9. **Live eval mode uses real embeddings.** The first live run showed the deterministic test
   embeddings rank real-model queries poorly, so live mode indexes knowledge with OpenAI
   embeddings (Section 204: real configured sources in real-model mode).
10. **A positive-similarity floor on retrieval** in the examples, so a negatively related
    document (in the example, the one carrying a prompt injection) is not pulled into an
    unrelated answer.
