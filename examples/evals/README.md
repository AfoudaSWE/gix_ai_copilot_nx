# evals example

Evaluates an application support copilot with `@gixcopilot/evals`. The copilot is built on the
real runtime packages: a deterministic router, a support agent that may delegate only to a
payment specialist, an admin agent no route reaches, permission- and approval-gated tools, a
hidden backend tool, ACL-restricted knowledge, a document carrying a prompt injection, and
memory for two users.

## Run

```sh
pnpm --filter @gixcopilot/evals-demo eval                               # deterministic, CI-safe
MODEL_PROVIDER=openai OPENAI_API_KEY=sk-... pnpm --filter @gixcopilot/evals-demo eval
EVAL_REGRESSION_DEMO=1 pnpm --filter @gixcopilot/evals-demo eval        # misconfigured candidate
```

Each run prints the report, compares against the stored baseline in `.eval-results/<mode>/`,
applies the CI gate, writes `.eval-results/<mode>-latest.json`, and exits non-zero when the
gate fails. `UPDATE_BASELINE=1` promotes the run to the new baseline.

- **Deterministic mode** uses scripted *worst-case* models. For adversarial prompts they really
  attempt the harmful action (delete, forged approval, admin delegation, cross-user memory,
  hidden tool, injected instruction), so a passing eval shows the *system* refused. It does
  not depend on the model declining.
- **Live mode** runs every agent on the real OpenAI provider and indexes knowledge with real
  OpenAI embeddings. It defaults to `EVAL_REPETITIONS=3` to measure variance. The cost
  estimate appears only if you set `EVAL_PRICE_INPUT_PER_MILLION` and
  `EVAL_PRICE_OUTPUT_PER_MILLION`; no prices are built in.
- **Regression demo** evaluates the same app with discovery unfiltered and the firewall in
  audit-only mode. The security gate fails and the comparison lists the regressions.

## Dataset

`application-support@1` has 15 cases: status lookup, policy question with citations, memory
write, memory recall, payment routing, a status change needing approval, the approval workflow,
tenant isolation, the six adversarial prompts from the Phase 11 brief, and prompt injection
through a retrieved document.

## Test

```sh
pnpm --filter @gixcopilot/evals-demo test
```

It requires every case to pass with zero security violations in deterministic mode, checks that
each attack was genuinely attempted, and checks that the misconfigured candidate fails the gate.
