# Deployment

**Units**: `apps/api` (stateless API + management API; scale horizontally), `apps/worker`
(BullMQ consumers; scale by queue depth), `apps/platform` (static files + nginx), PostgreSQL 16
with pgvector, Redis 7, optionally an OpenTelemetry collector.

**Images** (`deploy/docker/`): multi-stage builds (frozen lockfile → Nx build → `pnpm deploy
--prod` → slim runtime). They run as non-root with a liveness HEALTHCHECK (`/health`).
Configuration and secrets arrive at runtime through environment variables or mounted secret
files; nothing sensitive is in the image (`.dockerignore`).

**Release sequencing** (expand/migrate/contract, see [DATABASE](DATABASE.md)):
1. Build and push images for the release.
2. Run migrations once: `node dist/migrate.js` (the compose `migrate` service), or
   `aicopilot db migrate`. Servers never migrate at startup.
3. Roll API instances. Probes: liveness `/health`, readiness `/ready` (database reachable,
   migrations applied, Redis reachable; it never calls a model provider).
4. Roll workers. On SIGTERM they stop taking jobs and finish or abort active ones within
   the grace period; interrupted jobs retry elsewhere.

**Liveness vs readiness**: liveness asks whether the process is alive, so restart only if not.
Readiness asks whether this instance can serve required traffic now, and routes traffic away
while dependencies, migrations or shutdown say no. `/ready` answers 503 as soon as shutdown
starts.

**Local production-like stack**: `docker compose --env-file deploy/.env up --build` (postgres,
redis, migrate, api, 2 workers, platform). `node tools/docker-smoke.mjs` builds, starts and
checks it end to end, using the mock provider and per-run generated secrets.

TLS terminates at your load balancer or ingress. Put the platform behind your identity-aware
proxy; the management API requires a bearer token either way.
