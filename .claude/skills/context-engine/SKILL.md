---
name: context-engine
description: Context management architecture - system/user/application/page/component/session/conversation/RAG/tool context, prioritization, token budgeting, compression, and sensitivity. Load when building or modifying anything that assembles model context.
---

# Purpose

Define how application-aware context is collected, prioritized, budgeted, and safely
assembled before it reaches a model call.

# When to Apply

Building or modifying anything that registers, collects, ranks, compresses, or serializes
context for a model call.

# Required Rules

- Context sources are explicitly typed and scoped: System, User, Application, Page,
  Component, Session, Conversation, RAG, Tool. Each carries its own scope/lifetime — do not
  merge them into a single untyped blob.
- Context assembly is token-budgeted: given a model's context window and a reserved budget
  for history/output, the engine selects and truncates context deterministically by
  priority, never by silently dropping content with no accounting.
- Priority order between context sources is explicit and configurable, not implicit based
  on registration order.
- Deduplication is required: identical or near-identical context items from different
  sources (e.g. the same entity mentioned in both Page and Application context) are merged
  before being sent to the model.
- Compression/summarization of lower-priority or older context (e.g. long conversation
  history) is an explicit, testable step — not an unbounded string concatenation that
  eventually overflows the context window.
- Context sensitivity is tracked: context items can be marked sensitive/PII and are
  redacted or excluded per [[security]] policy before serialization, especially for
  RAG-sourced context which must additionally respect retrieval-time ACLs (see [[rag]]).
- Context serialization into the model prompt is a single, well-defined step — application
  code registers structured context; it does not hand-format prompt strings itself.
- Context scopes are debuggable: it must be possible to inspect exactly what context was
  sent for a given run (see [[devtools]], [[observability]]) after the fact.

# Architecture / Patterns

```text
Context Sources (System, User, Application, Page, Component, Session, Conversation, RAG, Tool)
        ↓ registered into
Context Engine (priority ranking, dedup, sensitivity filtering, token budgeting, compression)
        ↓ serialized into
Model Prompt / Protocol Context payload
```

Each context item carries: `{ source, scope, priority, sensitivity, content, tokenEstimate }`
so the engine can make budgeting decisions without re-deriving metadata ad hoc.

# Anti-Patterns

- Concatenating every available context string into the prompt with no budget or priority.
- Sending raw RAG chunks into context without applying retrieval-time authorization first.
- No way to inspect what context was actually sent for a given run after the fact.
- Treating "Application Context" and "RAG Context" as interchangeable when they have
  different trust/sensitivity properties.

# Validation Checklist

- [ ] New context source is typed with an explicit scope and priority
- [ ] Token budgeting is applied deterministically, not via silent truncation
- [ ] Sensitive/PII context is filtered per [[security]] before serialization
- [ ] RAG-sourced context passes authorization per [[rag]] before inclusion
- [ ] Assembled context for a run is inspectable/debuggable after the fact
