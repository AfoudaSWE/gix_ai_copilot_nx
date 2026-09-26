# Phase 11 testing

Every result below was produced by a command actually run in this session (2026-09-25 to
2026-09-27); nothing is assumed.

## Baseline before any Phase 11 change (Section 4)

`npx nx run-many -t lint,typecheck,test,build --skip-nx-cache` on commit `2518393`:
**41/41 projects passed lint, typecheck, test and build; 1,154 tests passed, 4 skipped, 0 failed.**
No previous-phase failures to record.

## Final full-repo validation

`npx nx run-many -t lint,typecheck,test,build --skip-nx-cache` on the final tree (2026-09-27):
**47/47 projects passed lint, typecheck, test and build. 1,251 tests passed, 29 skipped, 0
failed.** The skips are the Docker-gated Testcontainers suites (`checkpoint-postgres`, `jobs`,
`vectorstore-pgvector`; Docker was not running) and the optional real-OpenAI smoke tests in
older examples (no key in the environment). `npx playwright test`: **8/8 passed** in Chromium,
6 existing plus 2 new DevTools tests.

## Package and example suites

| Project | Tests | Covers |
| --- | --- | --- |
| `telemetry` | 44 | Redaction in every mode (Section 175, mandatory), numeric counts kept, sampling, logs, recording, OpenTelemetry nesting, metrics, instrumentation wrappers, overhead |
| `devtools` | 31 | Every inspector against diagnostics produced by the real telemetry wrappers; tenant and subject scoping (Section 227, 185); no secrets in any view; bundle export/import (mode ceiling, inert import); live subscription scoping; plugin disabled, unauthorized, production-refusal and read-only (Section 180); cross-run tool-call id regression |
| `testing` | 36 | Test model (text, stream, tools, structured output, malformed output, 429/500/timeout/auth failures, interruption, cancellation; Section 187); tool mocks and assertions, failure and timeout (Section 188); security, RAG, memory and approval fixtures (Section 189-191); agent simulation with routing, delegation, handoff and limits (Section 192); workflow pause, restart, resume, retry (Section 193); **replay never repeats a delete or refund** (Section 186, 225, mandatory); end-to-end DevTools against the real server, context engine, retriever, memory service and workflow engine (Section 176-185), including **DevTools disabled** (Section 179, mandatory) |
| `evals` | 22 | Every evaluator; **one unauthorized action among 100 cases fails the security gate** despite 99% averages (Section 132); controlled regression (Section 201); reports; file storage with unsafe-id rejection; labels; runner over real recorded diagnostics; experiments (Section 202) |
| `devtools-app` | 10 | Every panel renders; the firewall decision shown equals the recorded one; ARIA tablist keyboard navigation; landmarks, status region, named controls; raw view gated on recording mode; pagination; RTL; token auth errors; bundle import; eval report viewer |
| `evals-demo` | 4 | The full `application-support@1` dataset deterministically: 15/15 cases, **zero security violations** (Section 195, 224); every attack genuinely attempted by the worst-case model; the misconfigured candidate fails the gate and is flagged against the baseline |
| `devtools-demo` | 12 | Section 219-222 inspections over HTTP, auth and tenant scoping, export, and the app working with DevTools disabled |
| Playwright `devtools.spec.ts` | 2 | Real Chromium: token connect, keyboard navigation to Agents, agent tree, firewall trail; wrong token rejected; phone width (390 px) without horizontal overflow. All 8 browser tests (6 existing + 2 new) passed. |

## Real OpenAI evaluation (Section 203, 210-212)

`MODEL_PROVIDER=openai EVAL_REPETITIONS=2 pnpm --filter @gixcopilot/evals-demo eval`,
gpt-4o-mini, the key from a git-ignored `.env`:

| Run | Result | Security gate | Notes |
| --- | --- | --- | --- |
| 1 | 13/15 | PASS (0 violations) | `status-lookup`: the model wrote "under review" while the case expected the literal `under_review` (dataset fixed). `policy-question`: deterministic test embeddings ranked the real model's query poorly (live mode switched to OpenAI embeddings). |
| 2 | 15/15 | PASS (0 violations) | P50 1.3 s, P95 1.7 s, 507 tokens per case, no regression against run 1 |
| 3 (final code) | 15/15 | PASS (0 violations) | P50 1.3 s, P95 2.6 s, 506 tokens per case |

Every run covered all six adversarial prompts from Section 224 plus prompt injection and tenant
isolation. Cost was not estimated because no pricing was configured, and no price is
hard-coded. Two repetitions is a small sample; the report prints per-metric standard deviation.

## Performance (Section 158, 170)

| Measurement | Result |
| --- | --- |
| Telemetry, 500 model streams: raw / no-op / recording / OpenTelemetry API (no SDK) | 0.53 ms / 0.54 ms / 77 ms / 22 ms. The no-op adapter adds nothing; recording costs about 0.15 ms per call. |
| DevTools on 23,000 events and 3,500 spans: `projectSession` | 588 ms before this phase's fix (O(runs x events)); **6 ms** after the single-pass rewrite (6.3 ms tenant-scoped) |
| `overview` / `traces` (500 traces) / text search and paginate | 0.9 ms / 5.5 ms / 45 ms |
| `exportBundle` (redacted re-sanitization, 23,000 events) | 574 ms |
| Deterministic eval, 15 cases, including build | 3.6 s wall time |
| Live eval, 15 cases x 2 | P50 1.3 s, P95 1.7-2.6 s per case (model latency dominates) |
| DevTools UI production bundle | 279 KB JS (85 KB gzipped), 6.6 KB CSS |

## Not run (disclosed)

- **Docker was not running**, so the Testcontainers suites (`checkpoint-postgres`, `jobs`,
  `vectorstore-pgvector`) skipped. Their code was not changed in Phase 11, and they passed with
  Docker in the Phase 10 session.
- **The optional real-OpenAI smoke tests in older examples** skip without an environment key.
  The Phase 11 real-model validation was done through the eval example above instead.
- **No real RAG (pgvector) eval.** Live evals used real OpenAI embeddings with the in-memory
  vector store.
- **No automated accessibility audit tool** (for example axe) was added, to avoid a new
  dependency. Accessibility is covered by role, label and keyboard tests in jsdom and in
  Chromium.
