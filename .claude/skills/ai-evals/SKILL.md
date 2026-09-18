---
name: ai-evals
description: AI-specific evaluation principles - datasets, expected/forbidden tools, groundedness, task completion, permission compliance, and honest reporting of subjective model-judged results. Load when building or running evaluations of model/agent behavior.
---

# Purpose

Define how model and agent behavior is evaluated with rigor, distinct from deterministic
software testing ([[testing]]), and how results are reported honestly.

# When to Apply

Building eval datasets, writing eval harnesses, comparing models/prompts, or reporting eval
results.

# Required Rules

- Evals are dataset-driven: each case has an input, an expected outcome class (not
  necessarily an exact string), and machine-checkable assertions wherever possible.
- Tool-use evals check both **expected tools** (the correct tool was called with correct
  arguments) and **forbidden tools** (a tool that must not have been called, e.g. one
  outside the case's permission scope, was not called) — both directions are checked, not
  just the positive case.
- Groundedness (for RAG/knowledge-backed answers) is checked against retrieved source
  content, not just plausibility — an ungrounded but plausible-sounding answer is a
  failure.
- Task completion is measured against an explicit success criterion defined per case, not
  a generic "did it respond reasonably" judgment.
- Permission compliance is evaluated explicitly: a case where the acting user/agent lacks
  permission for an action must show the system correctly denying/requiring approval (see
  [[action-firewall]], [[hitl]]), not just that the model "chose" not to call the tool.
- Regression evals run automatically when prompts, models, or tool definitions change, so
  behavior drift is caught before release.
- Model and prompt comparisons report latency, token usage, and cost alongside quality
  metrics — a "better" result that costs 10x is a tradeoff to surface, not hide.
- **Where an LLM is used as a judge, its verdicts are reported as a heuristic signal, not a
  mathematically certain result.** Report inter-rater agreement or spot-check human
  verification where feasible; never phrase LLM-judged scores as ground truth accuracy.
- Eval datasets are versioned; a changed dataset invalidates direct comparison to prior
  runs unless explicitly noted.

# Architecture / Patterns

```text
Eval Dataset (versioned cases: input, expected outcome, expected/forbidden tools)
        ↓ run against
Agent/Model under test
        ↓ scored by
Deterministic assertions (tool calls, structured output) + LLM-judge (groundedness, quality)
        ↓ reported as
Score + latency + token/cost, with LLM-judge results clearly labeled as heuristic
```

# Anti-Patterns

- Reporting an LLM-judge score as a precise accuracy percentage with no caveat.
- An eval suite that only checks the model called the right tool, never that it avoided a
  forbidden one.
- Comparing two model versions' quality without also reporting cost/latency deltas.
- Running evals against an unversioned, silently-changing dataset.
- Treating "the model sounded confident" as a groundedness signal.

# Validation Checklist

- [ ] Eval cases assert both expected and forbidden tool calls where relevant
- [ ] Groundedness is checked against actual retrieved sources, not plausibility alone
- [ ] Permission-compliance cases are included and check firewall/approval behavior
- [ ] LLM-judge results are labeled as heuristic, not reported as certain
- [ ] Latency/token/cost are reported alongside quality comparisons
