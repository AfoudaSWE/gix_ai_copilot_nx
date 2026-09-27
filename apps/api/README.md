# Reference API server (`apps/api`)

The production server for AI Copilot (**Beta**): the data plane (chat runs, tools behind the
Action Firewall, usage policies, conversation and usage persistence) and, when enabled, the
control plane (`/management/v1`), in one horizontally scalable, stateless process. Durable
state lives in PostgreSQL; rate limits and job queues use Redis.

```sh
pnpm --filter @gixcopilot/api build
AICOPILOT_ENV=production DATABASE_URL=... REDIS_URL=... AICOPILOT_REQUIRE_AUTH=true \
AICOPILOT_JWT_SECRET=... AICOPILOT_MODEL_PROVIDER=openai AICOPILOT_MODEL=gpt-4o-mini \
OPENAI_API_KEY=... node apps/api/dist/main.js
```

- **Startup**: `loadConfig()` validates everything first and exits with code 78 and a list of
  problems (no values) when configuration is invalid. Migrations are *not* applied at startup;
  run `aicopilot db migrate` as a deployment step. `/ready` reports pending migrations.
- **Endpoints**: `/runs` and the rest of the Copilot protocol; `/health` (liveness);
  `/ready` (database, migrations, Redis; never calls a model provider); `/metrics`
  (Prometheus text, opt-in, bearer token); `/management/v1/*`.
- **Authentication**: reference HS256 JWT (`AICOPILOT_JWT_SECRET`, issuer, audience; claims
  `sub`, `tenant_id`, `project_id`, `environment`, `roles`, `permissions`), or pass your own
  `AuthenticationAdapter` to `createApiServer`.
- **Policies from the control plane**: budgets and rate limits configured in the platform are
  read from the tenant's config snapshot (15 s cache, last-good fallback) for the next run.
- **Logs**: JSON lines with `service`, `environment`, request ids; authorization and cookie
  headers are redacted.
- **Shutdown**: on SIGTERM, `/ready` answers 503, in-flight streams finish, then Redis and the
  pool close; a deadline (`AICOPILOT_SHUTDOWN_GRACE_SECONDS`) bounds it.

Applications add their own tools and providers with `createApiServer({ config, tools,
providers })` (see `examples/production`).
