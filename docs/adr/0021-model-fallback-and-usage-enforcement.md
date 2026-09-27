# ADR 0021: Model fallback and usage enforcement

Status: Accepted for Phase 12

## Context

A production model can fail, but retrying indiscriminately can duplicate visible output or consequential tool calls. Budgets and quotas must be applied before a model request and must be scoped to a trusted caller.

## Decision

- Route model calls through `@gixcopilot/model-router`, which uses an explicit catalog, capability requirements, policy, and per-model health. Fallback is allowed only for classified transient failures before any output or tool request is emitted.
- Keep the server tool loop and Action Firewall outside model-level fallback. A failed model call after a completed tool action may invoke a backup model to continue the same run, but the tool action is not replayed.
- Admit runs using `@gixcopilot/usage` policies keyed by authenticated tenant, project and user. Deny an anonymous request when a scoped policy requires identity. Use Redis for distributed rate limits.
- Record token usage and estimated cost separately. Prices are application configuration, not an assertion of provider billing; an unpriced model has no cost estimate.

## Consequences

Some failures end a run even if a backup model exists. This is deliberate when replay could alter what the user sees or duplicate a side effect. Budget and quota decisions depend on the freshness and durability of usage data, so operators must monitor and reconcile it.
