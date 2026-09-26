# ADR 0019: Evaluation Model, Execution Records, and Security Hard Gates

## Status

Accepted (Phase 11).

## Context

Evals measure AI behavior across a dataset, which is different from unit tests. The main
dangers are averages hiding a single catastrophic security failure, evaluators trusting what
the system *said* it did, model-judged scores presented as ground truth, and a generic eval
core tied to one model provider.

## Decisions

1. **Versioned datasets.** `defineEvalDataset` requires an id, a version and unique case ids.
   Cases carry structured expectations (expected and forbidden tools, sources, agents,
   outcome, workflow path, memory ownership, budgets), never free-text judgments.
2. **Records come from recordings.** The runner gives each case a fresh recording telemetry
   adapter. The target wires it into the real runtime and returns only its answer. The
   `ExecutionRecord` (tool calls with their firewall decisions, approvals, retrievals, memory
   access, agents, workflow, usage, latency) is derived from the diagnostics, using the same
   projection DevTools uses. The eval core depends only on protocol, telemetry and devtools, so
   it has no agent or provider dependency.
3. **Evaluator contract.** `Evaluator.evaluate()` returns a metric, a value, evidence, an
   optional threshold and pass/fail, and flags for `security` and `heuristic`. There is no
   single magic score. Evaluators skip cases they have nothing to say about.
4. **Security is a hard gate.** Unauthorized execution, approval bypass (an execution whose last
   recorded firewall decision was still `approval` or `deny`), forbidden tool execution or
   exposure, restricted-knowledge retrieval or leakage, cross-user memory access, and forbidden
   agents are security results. `evaluateGates` fails on any single one, unconditionally.
   Application thresholds are layered on top, and no product thresholds are built in. A
   blocked attempt is evidence, not a violation: the system worked.
5. **Heuristics are labeled.** Groundedness uses deterministic evidence overlap and is marked
   heuristic. The optional LLM judge records its model and prompt version, is always
   heuristic, and cannot be a security evaluator. Cost is always an estimate from configured
   pricing.
6. **Reports never hide failures.** Summaries include per-case failures, worst cases, variance
   across repetitions, latency percentiles, tokens and estimated cost. `compareEvalRuns`
   flags metric drops, newly failing cases and new security violations, and warns when
   datasets differ. `runExperiment` compares models, prompts or configurations on one dataset.
7. **No CLI in Phase 11.** The API plus an example script (`pnpm eval`) are the foundation; the
   full CLI is Phase 12.

## Consequences

- An eval result and a DevTools inspection always describe the same facts.
- Adversarial datasets can use deterministic *worst-case* models that really attempt attacks,
  proving the system rather than the model refuses.
- Live evaluations reuse the application's own provider runtime inside the target; the eval
  core never constructs a provider client.
