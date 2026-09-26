# Phase 11 architecture

## Package boundaries

```text
protocol ← telemetry ← devtools ← apps/devtools (React; API or bundle only)
                           ↑   ↖ devtools/server (Fastify plugin, subpath export)
                         evals            (generic core: no agents, no provider)
all runtime packages + telemetry + devtools ← testing (test-only leaf)
```

Enforced by Nx module-boundary tags: `scope:devtools` may depend only on protocol and
telemetry; `scope:evals` on protocol, telemetry and devtools; `scope:devtools-app` on those
plus evals (type-only); `scope:testing` may compose runtime packages, but nothing depends on it.
No runtime package imports DevTools, testing or evals.

## Observability model

```text
Runtime (server, model runtime, tools, firewall, approvals, context, RAG, memory, state, agents, workflows)
   │
   ├── Spans ─────────┐
   ├── Diagnostics ───┤     (versioned, internal; never the public CopilotEvent protocol)
   ├── Metrics ───────┤
   └── Logs ──────────┘
                      ▼
               TelemetryAdapter  ── redaction policy applied before storage
                      │
          ┌───────────┼──────────────┐
          ▼           ▼              ▼
   OpenTelemetry   Recording      No-op (default)
   (OTLP, any      (DevTools,
    backend)        tests, evals)
```

### Trace model

`SpanHandle`s are passed explicitly (parent to child); correlation (`runId`, `threadId`,
`rootRunId`, `parentRunId`, `tenantId`) rides on every span, diagnostic and metric. A copilot
request produces:

```text
copilot.run
 ├── context.resolve
 ├── rag.retrieve
 ├── model.call
 ├── tool.execute
 │    └── security.evaluate            (the firewall's own decision)
 ├── agent.run
 │    ├── agent.delegate
 │    │    └── agent.run (child) ── model.call / tool.execute
 │    └── agent.handoff
 └── model.call
approval.wait                           (own span, joined by run id: the human wait crosses requests)
workflow.run ── workflow.step (+ compensation phase) ── approval.wait (retroactive)
```

### Metric model

`METRICS` names cover runs, model calls, latency, first chunk, retries, tokens, tool calls and
latency, agent runs, iterations, delegations, handoffs, depth, workflow runs, steps, retries,
checkpoints, compensations, approvals and wait time, RAG retrievals, candidates, inclusions,
citations, memory operations, context resolutions and tokens, security decisions, errors,
timeouts and cancellations. `createMetricsCollector` summarizes histograms (p50/p95).

### Redaction

`off` records nothing. `metadata-only` keeps ids, counts and timings and drops every payload
(including protocol events and logs). `redacted` (the default) keeps payloads with secrets
and PII masked. `development-verbose` keeps PII but still masks secrets. Secret detection works
on keys (`password`, `token`, `apiKey`, `authorization`, ...) and values (API-key, bearer, JWT,
AWS and GitHub token shapes). Numbers under token or auth keys are counts, and booleans are never
secrets.

## DevTools

```text
Runtime ─► RecordingTelemetry ─► createDevTools(source)
                                      │ projectSession(snapshot, viewer)   (tenant + subject scoping)
                                      ▼
                                DevToolsSession
     ┌──────────┬──────────┬──────────┼──────────┬──────────┬───────────┐
  overview  conversation  context   toolTimeline  retrievals  agentTree  workflow  traces  errors ...
                                      │
            GET /devtools/session │ /runs/:id │ /export │ /stream (SSE)      (opt-in, auth, read-only)
                                      ▼
                            apps/devtools (React)  ◄── or an imported debug bundle
```

- **Context inspector**: the engine's own `context.resolved` diagnostic (budget, used,
  remaining, per-scope tokens, priority, sensitivity, truncation, exclusions with reasons),
  never a re-resolution.
- **Tool inspector**: phase timeline (requested, validation, authorization, execution,
  completed/failed) plus the recorded firewall decision. Calls the firewall blocked before
  execution are built from the decision itself.
- **Security inspector**: the firewall's stage trail (authentication, RBAC, rate limit, policy,
  risk, approval), identity, roles, tenant and final state.
- **RAG inspector**: retrieved, ACL-authorized, excluded, reranked, in-context and cited counts;
  candidates with score, selection, exclusion reason and citation.
- **Agent inspector**: tree from `agent.run.*` events and span attributes; why each agent ran
  (routing, delegation, handoff), model, visible tools, knowledge and memory scope, limits,
  calls, denials, tokens, latency.
- **Workflow inspector**: step graph from the run span's step and dependency attribute, status
  per step including waiting and compensated, retries, checkpoints, pauses and approvals.
- **State**: revision timeline with AI patches and conflicts; a reconstruction of recorded
  values, labeled as a debug view that does not roll anything back.

## Replay

```text
Recorded session / debug bundle
            │  createReplay(mode)
   ┌────────┼─────────────────────┐
   ▼        ▼                     ▼
Recorded   Test / live model   Tool stubs (recorded results; nothing executes)
responses                        └─ explicit allowlist → real tool behind resolver + firewall
            └────────┬────────────┘
                     ▼
         Simulated run  ── labeled "REPLAY (simulated)" ──► compare / eval
```

## Testing harness

```text
createTestModel (scripted)  ─┐
createToolMocks / real tools ├─► createCopilotTestHarness ─► real agent runtime
createSecurityFixture ───────┤        + real tool runtime + real Action Firewall
createKnowledgeFixture ──────┤        + real retriever/ACL + real memory service
createMemoryFixture ─────────┘        + recording telemetry ─► DevTools session for assertions
createAgentSimulation / createWorkflowSimulation (no Redis/Postgres) / createApprovalFixture
```

## Evaluation framework

```text
Dataset (versioned cases, structured expectations)
   │
   ▼
Eval runner ── fresh RecordingTelemetry per case ──► target (your real runtime)
   │
   ▼
Execution record (derived from diagnostics: tools, firewall, approvals, RAG, memory, agents, workflow, usage)
   │
   ▼
Evaluators ── task, tools, forbidden tools, permission compliance, groundedness, citations,
   │          retrieval, ACL, structured output, context, memory, routing, delegation,
   │          handoff, planner, workflow, UI, latency, tokens, cost, errors (+ optional LLM judge)
   ▼
Summary (per-case failures, worst cases, variance, security counts) ─► report / JSON
   │
   ▼
compareEvalRuns (baseline) ─► evaluateGates (security gate always on) ─► CI exit code
```

## Audit vs trace

Audit records (Phase 7) are compliance evidence and are unchanged. Traces and diagnostics are
engineering data: bounded, droppable, exportable, deletable. DevTools local storage is not
audit retention. They join on run id, tool-call id and approval id.
