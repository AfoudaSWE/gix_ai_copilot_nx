# @gixcopilot/redis

> **Status:** Beta. See [stability levels](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/VERSIONING.md#stability-levels).

Redis coordination for multi-instance AI Copilot deployments (**Beta**). Redis holds
ephemeral, shared state only; durable state lives in PostgreSQL.

## Install

```bash
npm install @gixcopilot/redis
```

Requires Node.js >=22.12.0. ESM only.

| Export | Purpose |
| --- | --- |
| `createRedisRateLimiter(client)` | Distributed fixed-window limiter: one atomic Lua script per check, window derived from the Redis server clock (instances with skewed clocks share windows), weighted `cost` (e.g. tokens), rejected requests do not consume |
| `createMemoryRateLimiter()` | Same interface in-process (development, tests, single instance) |
| `createRedisLock(client)` | Lease lock (`SET NX PX` + token-checked release) for temporary coordination; work under it must still be idempotent |
| `redisHealth(client)` | Readiness check (PING with timeout), never throws |

```ts
const limiter = createRedisRateLimiter(new Redis(config.secrets.redisUrl.reveal()));
const decision = await limiter.consume(`tenant:${tenantId}:requests`, { limit: 100, windowMs: 60_000 });
```

Background jobs use BullMQ through `@gixcopilot/jobs`. Tested against real Redis with three
limiter instances sharing one limit. Server-only.

## Documentation

- [production guide](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/production.md)
- [Getting started](https://github.com/AfoudaSWE/gix_ai_copilot_nx/blob/main/docs/guides/getting-started.md)
- [Source](https://github.com/AfoudaSWE/gix_ai_copilot_nx/tree/main/packages/redis)

## License

MIT
