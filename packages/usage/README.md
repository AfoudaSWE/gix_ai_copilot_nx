# @gixcopilot/usage

> **Status:** Beta. See [stability levels](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/VERSIONING.md#stability-levels).

Usage accounting, configurable cost estimation and usage policies (**Beta**). Usage is
accounting, not billing. A billing system may consume the events later.

## Install

```bash
npm install @gixcopilot/usage
```

Requires Node.js >=22.12.0. ESM only.

```ts
const store = createInMemoryUsageStore();            // or the PostgreSQL usage store
const server = createServer({
  ...,
  runObservers: [createUsageRecorder({ store, pricing })],
  admission: createUsageAdmission({
    store,
    limiter: createRedisRateLimiter(redis),           // shared across instances
    rateLimits: [{ name: 'per-user', scope: 'user', limit: 60, windowMs: 60_000 }],
    quotas: [{ name: 'tokens', scope: 'tenant', metric: 'tokens', limit: 5_000_000, period: 'month' }],
    budgets: [{ name: 'monthly', scope: 'tenant', limitMicros: 200_000_000, period: 'month', warnAt: 0.8, action: 'block' }],
  }),
});
```

- **Accounting**: `createUsageRecorder` is a server run observer. Per run it records one
  request, the run's tokens with provider and model, and tool, agent and workflow counts,
  under the authenticated tenant, project and environment. Ids derive from the run, so
  recording is idempotent. `createUsageMeter` records usage outside chat runs (RAG queries,
  embeddings).
- **Aggregation**: `forTenant(scope).aggregate({ from, to, kinds, groupBy })`, grouped by
  kind, model, provider, project, environment, agent, tool, subject, day or month.
- **Cost**: `PricingTable` is your configuration. No prices ship with the SDK, and an
  unpriced model has no estimate (never a guess). Always shown as "estimated".
- **Policies** (checked in order after authentication and before the model call):
  - Budgets: `warn`, `block` (`BUDGET_EXCEEDED`), `throttle` (a stricter rate), or
    `route-cheaper` (only when configured).
  - Quotas: tokens or requests per day or month (`QUOTA_EXCEEDED`).
  - Rate limits: per tenant, project or user (`RATE_LIMITED`).
  - Error metadata names the policy, never the infrastructure. Quotas and budgets are checked
    before a request, so one in-flight request can overshoot by its own size.

## Documentation

- [production guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/production.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/usage)

## License

MIT
