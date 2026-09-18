---
name: testing
description: Testing standards using Vitest, Playwright, MSW, and Testcontainers where justified - unit, integration, protocol, contract, browser, security, and regression tests. Requires deterministic tests and forbids false success claims. Load before writing tests or reporting test results.
---

# Purpose

Define the testing stack and standards, and the non-negotiable rule that Claude never
reports a test/build/lint result that wasn't actually executed.

# When to Apply

Writing any test, modifying test infrastructure, or reporting the result of running tests,
lint, typecheck, or a build to the user.

# Required Rules

- Preferred stack: Vitest (unit/integration), Playwright (browser), MSW (HTTP mocking),
  Testcontainers where a real dependency (Postgres, Redis) is genuinely needed for
  confidence — do not introduce a second test runner or mocking library without a
  documented reason (see [[dependency-policy]]).
- **Tests must be deterministic.** No reliance on real wall-clock timing races, unseeded
  randomness, or external network calls that aren't explicitly part of an integration test
  against a controlled environment (Testcontainers/MSW).
- Test categories are used deliberately, not interchangeably:
  - **Unit** — pure logic, no I/O, fully isolated.
  - **Integration** — real or Testcontainers-backed dependencies (DB, Redis) exercising a
    real code path end to end within a package.
  - **Protocol/contract** — verifying protocol message/event shapes and cross-package
    contracts don't silently drift (see [[protocol-design]]).
  - **Browser** — Playwright, for React/Angular UI behavior a unit test can't verify.
  - **Security** — verifying [[action-firewall]]/[[hitl]] deny/require-approval paths
    actually block what they claim to block.
  - **Regression** — added alongside every bug fix, reproducing the original failure.
- Mocking the database/cache is acceptable for unit tests of logic; it is not acceptable as
  the only coverage for code whose correctness depends on real query/transaction behavior
  — use Testcontainers for that.
- **Claude must not claim a test suite, lint run, typecheck, or build passed unless it was
  actually executed in this session and the output was observed.** If a check could not be
  run (missing tooling, environment constraint), say so explicitly rather than assuming
  success.
- A failing test is investigated and fixed at the root cause, or explicitly reported as a
  known failure — never silently skipped, commented out, or deleted to make a suite pass.
- New functionality ships with tests covering its behavior; a bug fix ships with a
  regression test reproducing the original bug.

# Anti-Patterns

- Reporting "tests pass" without having run the test command in this session.
- `test.skip`/`it.skip` added to silence a failing test instead of fixing it.
- A "unit test" that makes a real network call to a live third-party API.
- Asserting on implementation details (internal function call counts) instead of observable
  behavior, causing brittle tests that break on harmless refactors.
- Deleting a flaky test instead of fixing its nondeterminism.

# Validation Checklist

- [ ] Correct test category used for what's being verified
- [ ] Tests are deterministic (no unseeded randomness, no real network calls in unit tests)
- [ ] New behavior has test coverage; bug fixes include a regression test
- [ ] Test/lint/typecheck/build results reported to the user were actually executed and observed
- [ ] No test was skipped/deleted to force a suite to pass
