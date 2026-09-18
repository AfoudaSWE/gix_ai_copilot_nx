---
name: action-firewall
description: The AI Action Firewall - the mandatory pipeline every consequential tool call passes through (auth, RBAC/ABAC, schema validation, business policy, PII policy, rate limit, approval, audit, execution). Load when implementing or reviewing any tool execution path.
---

# Purpose

Define the single, mandatory pipeline that every consequential agent tool call passes
through before it executes, so security enforcement is centralized rather than reimplemented
per tool.

# When to Apply

Implementing tool execution, wiring a new tool (frontend, backend, MCP, or OpenAPI-derived)
into the runtime, or reviewing whether a tool call path is safe.

# Required Rules

- Every consequential tool request passes through this pipeline, in this order, with no
  stage skippable by tool origin:

```text
Tool Request
    ↓
Authentication
    ↓
Authorization
    ↓
RBAC / ABAC
    ↓
Schema Validation
    ↓
Business Policies
    ↓
PII / Data Policy
    ↓
Rate Limit
    ↓
Approval Policy
    ↓
Audit
    ↓
Execution
```

- A tool call originating from MCP or OpenAPI-derived tools (see [[mcp]], [[openapi-tools]])
  is not exempt from any stage — remote/dynamic tool origin is not a bypass.
- Each stage produces one of a fixed set of outcomes: **allow**, **deny**, **require
  approval**, or **dry-run**. A stage that cannot make a confident decision defaults to
  deny or require-approval, never to allow.
- Tools/actions declare a side-effect class: **reversible**, **compensatable** (can be
  undone via a follow-up action), or **irreversible**. Irreversible actions default to a
  stricter approval policy (see [[hitl]]) unless explicitly configured otherwise.
- "Explain-before-execute" is supported: the pipeline can be asked to produce a human-
  readable explanation of what a tool call would do before it actually executes, without
  performing side effects (a dry-run).
- Every completed pipeline run — allowed, denied, or approved — produces an audit record
  (who/what, request, decision at each stage, outcome) before execution, not only after.
- Schema validation in this pipeline is the same validation defined in [[tool-system]] —
  do not duplicate a separate, divergent validation implementation here.
- PII/data policy checks reference the classification rules in [[security]]; this stage
  can redact, deny, or require approval based on the sensitivity of data the action would
  touch or expose.
- Rate limiting in this pipeline is scoped per user/tenant/tool, independent of general API
  rate limiting in [[node-backend]]/[[api-design]].

# Anti-Patterns

- An MCP tool call that executes directly without passing through authorization/approval
  because it "came from a trusted server."
- A stage that fails open (defaults to allow) when it cannot evaluate a policy.
- Marking an irreversible action (e.g. `deleteAccount`) as requiring no approval by default.
- Producing an audit record only after a failure, but not for successful executions.
- Reimplementing argument validation inside the firewall instead of reusing the tool's
  declared schema from [[tool-system]].

# Validation Checklist

- [ ] Every new tool call path goes through all nine pipeline stages, regardless of origin
- [ ] Ambiguous/unavailable policy decisions default to deny or require-approval, not allow
- [ ] Side-effect class (reversible/compensatable/irreversible) is declared per tool
- [ ] Audit record is produced for every decision outcome, not only denials
- [ ] Explain-before-execute/dry-run is available for actions where it's meaningful
