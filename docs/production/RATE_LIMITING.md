# Rate limits and quotas

Two different things:

| | Rate limit | Quota |
| --- | --- | --- |
| Question | How fast? | How much this period? |
| Example | 60 requests / minute / user | 5,000,000 tokens / month / tenant |
| Mechanism | Redis fixed window, shared across instances | Recorded usage in PostgreSQL |
| Error | `RATE_LIMITED` (retryable, `retryAfterMs`) | `QUOTA_EXCEEDED` |

Configure per tenant in the platform (**Security → Rate limits**, versioned resources), or in
code with `createUsageAdmission({ rateLimits, quotas, limiter, store })` on the server's
`admission` hook. Scopes: tenant, project (with environment), user. Checks run after
authentication and before any model call. Errors are structured SDK errors whose metadata
names the policy, never the infrastructure.

Tool-level limits inside the Action Firewall (`createFixedWindowRateLimiter`) remain
per-process; request-level limits are the distributed ones. Tested: three API instances share
one Redis limit (exactly 10 of 30 concurrent requests admitted).
