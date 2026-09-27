# Usage and cost

**Usage is accounting, not billing.** Per run, the usage recorder stores a request, the model
tokens (input/output/total with provider and model), and counts of tool calls, agent runs and
workflow runs. The worker adds embedding counts, and `createUsageMeter` records RAG queries or
other work. Every event carries tenant, project, environment and user, plus a run-derived id,
so recording is idempotent.

**Cost is an estimate.** `PricingTable` (per 1M input/output tokens per `provider/model`, flat
per tool or `rag`, a version and a currency) is **your configuration**; no prices ship with
the SDK. Unpriced usage has no estimate (never a guess). The platform labels every figure
"Estimated cost". Replace it with invoiced numbers only from your billing system.

**Aggregation**: by kind, model, provider, project, environment, agent, tool, user, day or
month (`/management/v1/usage?groupBy=...&from=...`).

**Budgets** (estimated cost per tenant or project per day or month), explicit actions only:

| Action | At 100% of budget |
| --- | --- |
| `warn` | Allowed; `onWarning` fires (also at `warnAt`, default 80%) |
| `throttle` | A stricter rate limit applies (`RATE_LIMITED`) |
| `block` | Rejected with `BUDGET_EXCEEDED` (HTTP 402) |
| `route-cheaper` | The configured `cheaperModel` is used; never silently |

Budgets are checked before a run, so the run that crosses the line completes. Configure them
in the platform (**Security → Budgets**). They reach the API through config snapshots within
the cache TTL.
