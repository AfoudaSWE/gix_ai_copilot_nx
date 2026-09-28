# @gixcopilot/security

> **Status:** Stable. See [stability levels](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/VERSIONING.md#stability-levels).

Enterprise security layer for the AI Copilot SDK (Phase 7): identity and tenant context from a
trusted `AuthenticationAdapter`, RBAC permissions, ABAC policies, risk classification, the
**Action Firewall** that every tool call passes through, human-in-the-loop approvals with an
approval store, PII redaction data policies, audit sinks and rate limiting.

```sh
pnpm add @gixcopilot/security
```

| Export | Purpose |
| --- | --- |
| `SecurityContext`, `AuthenticationAdapter`, `createStaticAuthenticationAdapter` | Who is calling, for which tenant (never taken from model output) |
| `resolvePermissions`, `hasPermission`, `RolePermissionMap` | RBAC |
| `definePolicy`, `createPolicyRegistry`, `allow` / `deny` / `requireApproval` | ABAC policies |
| `createDefaultRiskPolicy` | Unclassified tools fail closed to approval |
| `createActionFirewall`, `createActionFirewallMiddleware`, `createPermissionAwareToolResolver` | Enforcement point for tool calls and tool visibility |
| `createInMemoryApprovalStore`, `applyDecision`, `canApprove` | HITL approvals |
| `createInMemoryAuditSink`, `createSafeAuditSink` | Audit (append-only; use a durable sink in production) |
| `createFieldRedactionDataPolicy`, `defaultRedactor` | PII handling |
| `createFixedWindowRateLimiter` | In-process rate limiting (distributed: `@gixcopilot/redis`) |

Model output is data, not authority: approvals come from recorded decisions, tenant identity
from authentication. See ADR 0012 and [the security guide](../../docs/guides/security.md).

## Documentation

- [security guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/security.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/security)

## License

MIT
