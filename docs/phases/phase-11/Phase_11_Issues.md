# Phase 11 issues and limits

## Bugs found and fixed this phase

| Finding | Fix and evidence |
| --- | --- |
| Redaction masked numeric token counts on spans (`copilot.tokens.input` was recorded as `[REDACTED]`), blanking every token metric in DevTools and evals | Numbers under "token" keys are counts; regression test in `redaction.spec.ts` |
| Redaction masked `authorizedCount` on every retrieval (the "auth" secret pattern), blanking the RAG inspector's ACL stage | Numbers under "auth" keys and all booleans are not secrets; numeric passwords, CVVs and card numbers still masked; test extended |
| Agents and workflows did not record their protocol events, so no agent tree or workflow graph could be built | Both runtimes forward emitted events to diagnostics (additive, no-op when telemetry is disabled) |
| DevTools showed an approved workflow step as still "waiting" after resume (the engine completes it inside `resume()` without a step event) | Projection completes the waiting step on resume after an approval pause; covered in devtools and testing tests |
| Firewall-blocked tool calls were missing from the tool inspector (they never reach the tool runtime) | Built from the recorded firewall decision; covered by the server end-to-end test |
| Tool-call ids are unique only within a run; DevTools joined by id alone, so one run's call could be matched to another run's firewall decision (found as a React duplicate-key warning in the browser test) | All joins key on run id plus call id; regression test in `inspectors.spec.ts` |
| `DevToolsSession` for a delegated agent showed empty knowledge sources in the demo | Not a bug: Phase 10's least-privilege intersection. The demo orchestrator now declares its knowledge ceiling. DevTools made this visible. |

## Found in real-model runs

- First live OpenAI eval run: **13/15**. `status-lookup` expected the literal `under_review`,
  while the model wrote "under review" (dataset too literal, fixed). `policy-question`
  retrieved only the escalation note, because the deterministic test embeddings rank the real
  model's query text poorly. Live mode now uses OpenAI embeddings, and the second run scored
  **15/15**. In both runs the security gate passed with zero violations.

## Known limits (disclosed, not hidden)

- **A tool timeout does not abort the tool.** The Phase 5 tool runtime rejects the call on
  timeout but does not abort the signal passed to `execute`, so a timed-out tool keeps running
  in the background. Found through `@gixcopilot/testing`'s mocks (the call stays `pending`).
  This is Phase 5 behavior and was not changed here; see technical debt.
- **Approval-wait spans are separate traces**, joined to the run by run id, because the human
  wait spans requests (and, for workflows, processes). They are not nested under the request
  span.
- **Tenant-scoped live streaming re-projects the session per event.** That is O(session) per
  event: fine for a development tool, not meant for high-volume production streaming.
- **The recording adapter is an in-memory ring buffer** (default 5,000 entries; the demo uses
  20,000). Older events are dropped and counted. It is not durable storage and not audit
  retention.
- **Groundedness is lexical evidence overlap**, labeled heuristic. It reliably flags
  unsupported claims but is not proof of support. The optional LLM judge is also heuristic.
- **Recorded replay needs payloads.** `metadata-only` recordings are refused. Model responses
  are replayed per provider in recorded order, so a replay that takes a different path
  (different tool results) can diverge; the result reports whether the tool sequence matched.
- **The eval example's live mode** uses gpt-4o-mini. Results for other models may differ, and
  two repetitions per case is a small sample (the report shows variance).
- **No Phase 11 CLI.** `pnpm eval` in `examples/evals` is the foundation; `aicopilot eval` is
  Phase 12.
- **Manual tool execution from DevTools is intentionally not implemented** (Section 164 made it
  optional, and it would be a second path to side effects).
- **Cost** is an estimate only, and only when pricing is configured. No prices ship with the SDK.

## Out of scope (Phase 12)

Production SaaS management, tenant administration UI, billing and usage billing, budget
enforcement, marketplace, Angular SDK, the full CLI, npm release automation, and a multi-tenant
control plane.
