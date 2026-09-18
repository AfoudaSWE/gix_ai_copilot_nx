---
name: memory
description: Memory architecture - distinguishing conversation history, working memory, session memory, durable memory, and semantic memory, with expiration, user control, and tenant isolation. Load when building any feature that stores information across turns or sessions.
---

# Purpose

Prevent memory features from becoming an uncontrolled, unbounded, or accidental persistent
data store, by keeping memory kinds explicitly distinct.

# When to Apply

Building or modifying anything that stores information beyond the current model call:
conversation history, working memory, session state, durable user memory, or semantic
memory.

# Required Rules

- Five memory kinds are kept distinct and never silently merged:
  - **Conversation History** — the raw message log of the current thread.
  - **Working Memory** — scratch state for the duration of a single run (not persisted
    beyond it).
  - **Session Memory** — persists for a user session, cleared on session end.
  - **Durable Memory** — explicitly persisted across sessions, subject to the strongest
    controls below.
  - **Semantic Memory** — derived/summarized knowledge about a user or domain, distinct
    from raw history.
- Nothing is promoted from a shorter-lived memory kind (working/session) to Durable Memory
  automatically — promotion is an explicit, auditable operation.
- Durable Memory is never written without a defined policy for what is eligible to be
  stored — PII and sensitive content are excluded by default per [[security]] unless an
  explicit, reviewed exception applies.
- Users have visibility into and control over their own Durable Memory: it must be
  possible to view, edit, and delete stored memory items — a silent, opaque memory store is
  not acceptable.
- Every memory kind has an explicit expiration/retention policy; Durable Memory without any
  retention policy is treated as a bug, not a feature.
- Tenant isolation applies to all memory kinds identically to [[database]]/[[security]] —
  memory for one tenant/user is never retrievable by another.
- Semantic memory (summaries, extracted facts) is generated through a reviewable process
  (not opaque black-box compression) so incorrect derived "facts" can be identified and
  corrected.

# Architecture / Patterns

```text
Conversation History ──► (per-run) Working Memory
                     ──► (per-session) Session Memory
                     ──► (explicit promotion, policy-gated) Durable Memory
                     ──► (derived, reviewable) Semantic Memory
```

Each kind is backed by its own storage scope/table with its own TTL and access-control
rules — not one generic "memory" table with a type column and no differentiated policy.

# Anti-Patterns

- Persisting every conversation turn into Durable Memory by default "in case it's useful."
- No user-facing way to see or delete what's been remembered about them.
- Storing raw PII in semantic memory because it appeared in a message.
- A memory store with no expiration, growing unbounded per user.
- Cross-tenant memory leakage because a lookup key omitted the tenant scope.

# Validation Checklist

- [ ] The correct memory kind is used and not conflated with another
- [ ] Durable Memory writes are explicit, policy-gated, and exclude PII by default
- [ ] Users can view, edit, and delete their own Durable Memory
- [ ] Every memory kind has a defined expiration/retention policy
- [ ] Tenant isolation is enforced identically to [[database]]
