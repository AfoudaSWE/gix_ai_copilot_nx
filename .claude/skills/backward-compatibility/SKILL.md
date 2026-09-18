---
name: backward-compatibility
description: SemVer, public API and protocol compatibility, schema evolution, deprecation, and migration paths. Load before changing any public API, protocol shape, or event schema.
---

# Purpose

Keep the SDK's public surface and wire protocol evolvable without breaking consumers
silently, across packages that version independently in the Nx monorepo.

# When to Apply

Changing a public API signature/return shape, a protocol message/event schema, a config
default, or removing/renaming an exported symbol.

# Required Rules

- Semantic Versioning is followed per package: patch = bug fix with no API change, minor =
  additive/backward-compatible change, major = breaking change. A breaking change without a
  major bump is not acceptable.
- Public API compatibility: a released function signature, exported type shape, or default
  value is a contract (see [[sdk-design]], [[typescript-standards]]) — changing it requires
  either a compatible, additive change or an explicit major-version breaking change with a
  migration guide (see [[documentation]]).
- Protocol versions (see [[protocol-design]]) are explicit; a new required field or changed
  event shape is introduced as an additive, versioned change so older clients/servers can
  detect and handle the mismatch rather than silently misinterpreting data.
- Schema evolution (tool schemas, protocol schemas, database schemas) prefers additive
  changes (new optional fields) over renaming/removing fields; a removal/rename goes through
  a deprecation period where practical.
- Deprecation: a deprecated API is marked as such (TSDoc `@deprecated` with guidance) for at
  least one minor version cycle before removal, unless a security issue forces immediate
  removal — in which case that reasoning is documented explicitly.
- Feature detection is preferred over version sniffing where a consumer needs to adapt to
  capability differences (e.g. checking whether a capability/tool exists rather than
  branching on an SDK version number).
- Adapters (provider adapters, framework adapters) are the seam where a breaking upstream
  change (e.g. a provider SDK's API change) is absorbed without forcing a breaking change
  on the SDK's own public API, wherever feasible.
- **Breaking changes require explicit justification** stated in the PR/commit — "it's
  cleaner this way" is not sufficient justification on its own; state the concrete problem
  the break solves and why an additive path wasn't viable.

# Anti-Patterns

- Renaming an exported function or changing its return shape in a patch release.
- Adding a new required (non-optional) field to an existing protocol event without
  versioning it.
- Removing a deprecated API in the very next release with no deprecation window.
- Silently changing a default config value that changes behavior for existing consumers.

# Validation Checklist

- [ ] Version bump matches the actual nature of the change (patch/minor/major)
- [ ] Breaking changes are justified explicitly and ship with a migration guide
- [ ] New protocol/schema fields are additive and versioned, not silently required
- [ ] Deprecated APIs are marked and given a deprecation window before removal
- [ ] Provider/framework-specific breaking changes are absorbed at the adapter boundary where feasible
