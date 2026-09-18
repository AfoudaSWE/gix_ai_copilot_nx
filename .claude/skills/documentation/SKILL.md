---
name: documentation
description: Documentation requirements - READMEs, API docs, architecture docs, ADRs, examples, migration guides, and troubleshooting/security notes, built with Next.js + MDX. Load when shipping a feature or package that needs documentation.
---

# Purpose

Ensure the SDK is usable and maintainable by people other than its original authors, with
documentation that stays accurate over time.

# When to Apply

Shipping a new package, a public API change, an architecture decision, or any feature a
consumer needs to learn to use.

# Required Rules

- Every publishable package has a README covering: what it does, install, minimal usage
  example, and a link to fuller docs.
- Public API surfaces are documented (generated API reference where practical, e.g. from
  TSDoc comments per [[typescript-standards]]) — not left to "read the source."
- Architecture-level decisions (a new abstraction boundary, a chosen tradeoff, a rejected
  alternative) are recorded as an ADR (Architecture Decision Record) so the reasoning
  survives beyond the PR that made it.
- The documentation site is built with Next.js + MDX; do not introduce a second docs
  toolchain without a documented reason.
- Code examples in documentation must compile/run wherever practical — prefer examples
  extracted from or verified against real, tested source files over hand-typed snippets
  that can silently drift out of date.
- A breaking public API change ships with a migration guide describing what changed and how
  to update calling code, per [[backward-compatibility]].
- Security-relevant behavior (what the [[action-firewall]] does, how [[hitl]] approval
  works, PII handling per [[security]]) is documented explicitly for consumers who need to
  configure it correctly — not left implicit in code.
- Troubleshooting notes are added for known sharp edges (common misconfiguration, common
  error messages) as they're discovered, not written speculatively in advance.

# Anti-Patterns

- A package with no README, requiring consumers to read source to learn basic usage.
- A hand-typed code example in docs that no longer matches the actual current API.
- A breaking change shipped with no migration guide.
- Security-relevant configuration (approval levels, PII policy) documented nowhere.
- A second documentation framework introduced alongside Next.js + MDX for one page.

# Validation Checklist

- [ ] New/changed package has an accurate README with a working usage example
- [ ] Public API changes are reflected in generated/reference docs
- [ ] Architecture decisions of consequence are captured as an ADR
- [ ] Breaking changes ship with a migration guide
- [ ] Security-relevant behavior is documented for consumers, not left implicit
