---
name: git-workflow
description: Git conventions - conventional commits, small focused commits, branch and PR expectations, and changelog considerations. Load when committing, branching, or opening a PR.
---

# Purpose

Keep the project's history legible and reviewable as the SDK grows across many packages
and phases.

# When to Apply

Making a commit, creating a branch, or opening a pull request.

# Required Rules

- Commits follow Conventional Commits: `type(scope): subject`, e.g.
  `feat(protocol): add typed run events`, `fix(tool-system): validate args before dispatch`,
  `test(protocol): cover event serialization`, `docs(architecture): document protocol
  boundaries`. Common types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`.
- Commits are small and focused: one logical change per commit — do not bundle an
  unrelated formatting pass, dependency bump, and feature change into one commit.
- Commit messages explain *why* when the *why* isn't obvious from the diff, not just a
  restatement of the changed filenames.
- Scope in the commit type matches the affected package/skill area where practical
  (`protocol`, `tool-system`, `react-sdk`, etc.) so history is filterable.
- Branch names describe the work (`feat/tool-registry-namespacing`,
  `fix/context-token-budget`), not a generic `patch-1`.
- A PR description states what changed and why, references the relevant phase (see
  [[phase-gate]]) and any relevant ADR, and lists how it was tested (per [[testing]]).
- Changes affecting a public API note the change's compatibility impact per
  [[backward-compatibility]] in the PR description, so changelog generation stays accurate.
- Only commit what was asked; never bundle an unrelated fix into a commit without calling
  it out explicitly.

# Anti-Patterns

- `git commit -m "fixes"` with no type/scope and no explanation of what was fixed.
- One giant commit touching ten unrelated packages.
- A PR with no mention of testing performed, when [[testing]] requires it.
- Silently including a breaking API change in a PR without flagging it.

# Validation Checklist

- [ ] Commit messages follow Conventional Commits with an appropriate type/scope
- [ ] Each commit is a single, focused logical change
- [ ] PR description states what/why, phase context, and how it was tested
- [ ] Public API compatibility impact is called out where relevant
