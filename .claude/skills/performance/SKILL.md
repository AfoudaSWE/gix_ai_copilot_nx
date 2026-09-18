---
name: performance
description: Performance rules covering bundle size, startup time, streaming first-token latency, server/RAG/tool latency, React render cost, memory, and database queries. Requires measurement before optimization. Load when performance is a stated goal or a change risks a hot path.
---

# Purpose

Keep performance work evidence-based and targeted at the metrics that actually matter for a
streaming, application-aware copilot.

# When to Apply

Any change to a hot path (streaming, tool execution, context assembly, RAG retrieval,
React rendering) or any task explicitly about performance.

# Required Rules

- **Measure before optimizing.** No performance change is made based on intuition alone —
  establish a baseline (profiling, benchmark, or metric from [[observability]]) before and
  after the change.
- Tracked metrics, each with an owning layer:
  - Browser bundle size (per package, especially [[react-sdk]]/[[angular-sdk]])
  - App startup time
  - Streaming first-token latency (see [[ai-runtime]])
  - Server request latency (see [[node-backend]])
  - Context building time (see [[context-engine]])
  - RAG retrieval latency (see [[rag]])
  - Tool execution latency (see [[tool-system]], [[action-firewall]])
  - React render count/cost on hot UI paths (see [[react-sdk]])
  - Memory usage/leaks in long-running processes and long agent sessions
  - Database query latency/count (see [[database]] — watch for N+1 patterns)
- A performance-motivated change must state the measured baseline, the change, and the
  measured result — a change justified only by "this should be faster" is not acceptable.
- Bundle size for framework adapter packages is checked before release; a new dependency
  that meaningfully increases bundle size goes through [[dependency-policy]] review first.
- Streaming first-token latency is treated as a primary UX metric distinct from total
  completion latency — a change that improves total latency but delays the first token is
  a regression, not an improvement, for a streaming copilot UI.
- Database query patterns are reviewed for N+1 queries and missing indexes as part of any
  change touching [[database]] access code.

# Anti-Patterns

- Adding caching, memoization, or a rewrite "for performance" with no before/after
  measurement.
- Optimizing total latency at the expense of first-token latency in a streaming UI.
- Adding a heavy dependency to shave milliseconds off one path while doubling bundle size
  for every consumer.
- Ignoring an N+1 query pattern introduced by a new feature because "it works."

# Validation Checklist

- [ ] A baseline measurement exists before a performance change is made
- [ ] The change's actual effect was measured and reported, not assumed
- [ ] First-token latency was not regressed for the sake of total latency
- [ ] Bundle size impact was checked for framework adapter package changes
- [ ] New database access patterns were checked for N+1 queries and missing indexes
