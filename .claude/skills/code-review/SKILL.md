---
name: code-review
description: Mandatory self-review checklist before reporting any development task complete - requirements, architecture, types, tests, security, performance, public APIs, docs, compatibility, dependencies, dead code, lint, and build. Forbids claiming untested success. Load before reporting any task as done.
---

# Purpose

Provide the mandatory self-review pass Claude runs before ever telling the user a
development task is complete, so completion claims are backed by actual verification.

# When to Apply

Before reporting any implementation task as complete, and as part of the phase-completion
protocol in [[phase-gate]].

# Required Rules

Before reporting a task complete, verify each of the following, and only report a passing
result if it was actually checked:

- **Requirements**: the implemented change actually matches what was asked, no more, no
  less (see [[phase-gate]] on scope).
- **Architecture**: no violation of [[project-architecture]] (framework leakage, wrong
  dependency direction, missing adapter boundary).
- **Types**: `tsc` strict-mode passes for touched packages; no new `any` (see
  [[typescript-standards]]).
- **Tests**: relevant tests were run (not just written) and pass; new behavior has coverage
  (see [[testing]]).
- **Security**: any consequential action still goes through [[action-firewall]]; no new
  trust placed in model output or a system prompt (see [[security]]).
- **Performance**: no obviously introduced regression on a hot path (see [[performance]]);
  measured if performance was a stated goal.
- **Public APIs**: no unreviewed breaking change to an exported signature (see
  [[sdk-design]], [[backward-compatibility]]).
- **Documentation**: required docs were updated (see [[documentation]]) — README, ADR,
  migration guide if applicable.
- **Backwards compatibility**: protocol/schema changes are additive or explicitly flagged
  as breaking (see [[backward-compatibility]], [[protocol-design]]).
- **Unnecessary dependencies**: no dependency was added without going through
  [[dependency-policy]].
- **Dead code**: no leftover unused code, commented-out blocks, or abandoned experiments
  left in the diff.
- **Formatting/lint**: the linter/formatter was actually run and passes.
- **Build**: the build was actually run for affected packages where a build step exists.

**Claude must not claim tests, lint, typecheck, or build passed unless they were actually
executed in this session and their output observed.** If a check couldn't be run, say so
explicitly.

# Architecture / Patterns

Run the checklist as a literal pass over the `git diff` before writing the completion
report — do not rely on memory of what was changed across a long session.

# Anti-Patterns

- Reporting "all tests pass" from memory of having written passing tests earlier, without
  re-running them after subsequent edits.
- Skipping the review because the change "felt small."
- Reviewing only the files Claude remembers touching instead of the actual `git diff`.

# Validation Checklist

- [ ] Every item above was checked against the actual diff, not assumed
- [ ] Every check reported as passing was actually executed and observed in this session
- [ ] Any check that could not be run is explicitly disclosed, not silently omitted
- [ ] Dead code and unrelated changes were removed from the diff before reporting done
