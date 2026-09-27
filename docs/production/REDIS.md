# Redis

Redis holds ephemeral, shared coordination state, never the source of truth:

| Use | Package | Notes |
| --- | --- | --- |
| Distributed rate limits | `@gixcopilot/redis` `createRedisRateLimiter` | Atomic Lua fixed window on the Redis clock; rejected requests do not consume |
| Background jobs | `@gixcopilot/jobs` (BullMQ) | Stable job ids, retries, dead-letter set |
| Lease locks | `createRedisLock` | Temporary coordination; guarded work stays idempotent |

Losing Redis loses in-flight rate-limit windows and queued jobs that have not started. Durable
state (conversations, checkpoints, approvals, audit, usage, configuration) is in PostgreSQL.
Use a managed Redis with persistence (AOF) and authentication (`REDIS_URL` as a secret).
Readiness (`/ready`) checks Redis with a short timeout.
