# Management platform

`apps/platform` (UI) + `@gixcopilot/management` (`/management/v1`) configure and inspect the
system. They cannot bypass it.

| Role | Can |
| --- | --- |
| viewer | Read projects, environments, models, agents, tools, OpenAPI, MCP, knowledge, prompts, evaluations, security overview, usage |
| operator | + conversation metadata, traces, audit search, start evaluations, reindex knowledge |
| admin | + create and version resources, import OpenAPI, configure MCP, write secrets, promote prompts, archive projects, edit security policies, budgets and rate limits |
| owner | + memberships and tenant settings |
| platform admin | Create, suspend and activate tenants (no tenant data without a membership) |

Resources are versioned (every save is a new version; roll back by making an older version
current). Prompts move from draft to staging to production, never skipping staging. Runs use
a snapshot of current versions.

Invariants enforced server-side: tool approval overrides may only be stricter than the code
declares; agent tool lists may only shrink; unknown agents and tools are rejected; OpenAPI
operations import disabled; secrets are write-only; conversation *content* requires the
tenant security policy `conversationContentAccess: operators` (metadata is operator-visible);
every mutation is audited; costs are labelled estimated.

Identity stays in your identity provider: the platform stores memberships, not passwords.
