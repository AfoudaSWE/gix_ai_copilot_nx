---
name: security
description: General security principles for the AI Copilot SDK - zero trust for model output, authn/authz, RBAC/ABAC, tenant isolation, PII, prompt injection, and audit. Load for any security-relevant design or review. Tool-execution-specific rules live in action-firewall.
---

# Purpose

Establish the security posture that every other skill assumes: model output is untrusted,
authorization is enforced in code, and sensitive data is handled deliberately.

# When to Apply

Any feature touching authentication, authorization, tenant data, PII, external input, or
model output that influences behavior. For the specific tool-call security pipeline, see
[[action-firewall]]; for approval workflows, see [[hitl]].

# Required Rules

- **Zero trust for model output**: text, tool-call arguments, and generated UI requests
  from the model are treated as untrusted input, validated the same way user input from an
  API request would be — never treated as inherently safe because "the model produced it."
- **Never rely on a system prompt as a security boundary.** Instructions to the model
  ("don't do X", "only access Y") are not enforcement; enforcement happens in code
  (schema validation, authorization checks, the firewall pipeline).
- Authentication is established once at a well-defined boundary (the server/session layer)
  and propagated explicitly through context — never re-derived or assumed deep in
  business/tool logic.
- Authorization combines RBAC (role-based) and ABAC (attribute-based, e.g. tenant, resource
  ownership, data sensitivity) — a role check alone is insufficient wherever attribute
  context (which tenant, which record) matters.
- Tenant isolation is enforced at the data-access layer (queries scoped by tenant id), not
  only in application logic that could be bypassed by a different code path — see
  [[database]].
- Secrets (API keys, provider credentials, connection strings) are never hardcoded, never
  logged, and never included in context sent to a model.
- PII is identified and classified; PII must not be persisted, logged, or included in model
  context/memory without an explicit, reviewed policy decision — see [[memory]] for
  storage-specific rules.
- Prompt injection is treated as an expected adversarial input class: content retrieved
  from tools, RAG, or external systems is not automatically granted the same trust as
  direct user/developer instructions, and cannot elevate a tool call's permissions.
- All input (user messages, tool arguments, retrieved documents, OpenAPI/MCP responses) is
  validated at the boundary where it enters the system; all output (tool results,
  generated UI, generated text shown as fact) is validated/sanitized before use.
- Rate limiting applies per user/tenant/API key at the boundary layer, independent of any
  model-level throttling.
- Every consequential action is auditable: who/what initiated it, what was authorized, and
  what executed — see [[action-firewall]] for the pipeline that produces this audit trail.
- Apply least privilege by default: a user, agent, or tool gets the minimum access needed,
  never a broad default that is narrowed later.

# Anti-Patterns

- "The system prompt tells it not to delete records" used as the only safeguard against a
  destructive tool call.
- Trusting a tenant id supplied by the model or client request body instead of deriving it
  from the authenticated session.
- Logging full tool-call arguments that include PII at info level.
- Treating a RAG-retrieved document's embedded instructions as equivalent to a user
  instruction.
- A role check (`if user.role === 'admin'`) with no attribute check for resource ownership
  or tenant boundary.

# Validation Checklist

- [ ] No security boundary relies on prompt wording alone
- [ ] Tenant/authorization context is derived from the authenticated session, not from
      model or client-supplied input
- [ ] PII handling was explicitly considered (not stored/logged/sent to model by default)
- [ ] Content from tools/RAG/external systems cannot elevate privileges via injected text
- [ ] Consequential actions produce an audit record per [[action-firewall]]
