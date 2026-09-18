---
name: dependency-policy
description: Strict dependency-addition policy - justify the problem, check the platform, check maintenance/bundle/security, avoid duplication, prefer adapters, keep core minimal. Load before adding any new package dependency.
---

# Purpose

Prevent uncontrolled dependency growth, especially inside the framework-independent core,
which must stay minimal per [[project-architecture]].

# When to Apply

Before adding any new npm dependency to any package in the workspace.

# Required Rules

Before adding a dependency, work through and be able to answer all of the following:

1. **What problem does it solve?** State it concretely — not "might be useful."
2. **Does the platform (Node.js, the browser, TypeScript itself) already solve this?**
   Prefer a native/standard solution over a library if one genuinely covers the need.
3. **Maintenance implications**: is it actively maintained, reasonably popular, and not a
   single-maintainer package with no bus-factor for something load-bearing?
4. **Bundle size**: for anything reachable from [[react-sdk]]/[[angular-sdk]], what's the
   actual size impact, and is it tree-shakeable?
5. **Security**: does it have a clean-ish vulnerability history; does it pull in a large,
   risky transitive dependency tree?
6. **Duplication**: does the workspace already have a package that solves this (e.g. a
   second HTTP client, a second date library, a second schema validator)? Reuse the
   existing one unless there's a documented reason not to.
7. **Core minimalism**: `@gixcopilot/core` (and other core/protocol packages) carry the
   fewest possible dependencies; anything optional or provider-specific is pushed into an
   adapter package instead of the core.
8. **Prefer adapters** for optional functionality (a specific LLM provider, a specific
   database driver, a specific vector store) rather than making it a hard dependency
   anywhere upstream of the adapter layer.
- Do not add a major framework or heavyweight library merely for convenience on a small
  task — solve it with existing tools/idioms first.
- This applies equally to build/dev tooling, not only runtime dependencies — a second test
  runner, linter, or bundler needs the same justification.

# Anti-Patterns

- Adding a whole date-formatting library for one date computation `Intl.DateTimeFormat`
  already covers.
- Adding a second state-management library because it's "nicer" than what's already used.
- Pulling a provider SDK into `@gixcopilot/core` "just for this feature," instead of behind
  an adapter.
- Adding a dependency with no maintenance activity in years for a load-bearing feature.

# Validation Checklist

- [ ] The problem the dependency solves was stated concretely
- [ ] A platform-native or already-present solution was ruled out first
- [ ] Maintenance, bundle size, and security were considered, not just "does it work"
- [ ] No existing package in the workspace already solves this
- [ ] The dependency lands in the correct layer (adapter, not core) per [[project-architecture]]
