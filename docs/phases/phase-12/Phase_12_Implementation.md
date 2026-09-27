# Phase 12 implementation log

Written as work lands, batch by batch (plan: 18 batches). Each entry says what was built,
where, and how it was verified.

## Batch 1 — Baseline and status

Baseline recorded in [Testing](Phase_12_Testing.md). `docs/PROJECT_STATUS.md` marks Phase 12
IN PROGRESS.

## Batch 2 — Package readiness

- All 28 SDK packages: `private` removed; `repository`, `homepage`, `bugs`, `engines`
  (`node >=22.12.0`), `publishConfig` (`access: public`, `provenance: true`); `files` now
  excludes compiled specs, spec helpers and `tsbuildinfo` (several packages previously shipped
  their compiled tests). `checkpoint-postgres` and `vectorstore-pgvector` now ship their
  `migrations/` SQL. READMEs added for `agents`, `workflows`, `security`, `checkpoint-postgres`,
  `jobs`.
- **No `license` field**: the repository has no LICENSE. The owner subsequently chose
  proprietary distribution, then reversed that to MIT and public npm publication; see [Releasing](../../RELEASING.md).
- `tools/verify-packages.mjs`: `pnpm pack` every publishable package (the real publish
  transformation, `workspace:*` rewritten) and inspect the tarball in-process: no env files,
  tests, TypeScript sources, build caches, key material or secret-looking strings; every
  `exports`/`types`/`bin` target present; README present; no unresolved `workspace:`.
- Browser/server boundary enforced by lint: `platform:browser|neutral|server` tags on every
  package, `@nx/enforce-module-boundaries` constraints (browser → browser/neutral only,
  neutral → neutral only), and `no-restricted-imports` banning `node:*`, `fastify`, `pg`,
  `ioredis`, `bullmq`, `openai`, `drizzle-orm` in browser/neutral package sources. Verified by
  a probe file that both rules reject.
- ESM-only (ADR 0005 unchanged): every package ships ESM + `.d.ts` + source maps.

## Batch 3 — Angular SDK

- New `@gixcopilot/headless`: the React chat store (`createChatStore`), the framework-neutral
  chat types, composition helpers (`createCopilotParts`, resolvers) and
  `toGenerativeUIRequests`, moved out of `@gixcopilot/react` so Angular reuses them instead of
  forking them. `@gixcopilot/react` re-exports every moved type unchanged (no public API
  change); its 46 tests pass unchanged.
- New `@gixcopilot/angular` (Angular 21; Angular 22 requires TypeScript 6, the workspace is on
  5.9): `provideCopilot`, `CopilotService` (signals), `injectCopilot`, `injectCopilotContext`,
  `injectFrontendTool`, `injectCopilotState`, `injectGenerativeComponent`,
  `CopilotComponentRegistry`, `<aicopilot-generative-ui>`, `<aicopilot-chat>`. Built with
  ng-packagr (partial Ivy); published from `dist/` via `publishConfig.directory`. 11 tests (JIT
  under Vitest): provider, injection, streaming, cancellation, errors/retry, context (signal
  updates, cleanup), frontend tools (schema validation), state (store sync, patch tool, model
  context), generative UI (registered + valid only, no script), chat a11y/escaping/RTL, destroy
  cleanup, SSR-safe import.
- Finding: Angular JIT does not see signal `input()`/`viewChild()`; shipped components use
  decorator inputs feeding signals so JIT consumers and tests match AOT.
- `examples/angular-basic`: Angular app + mock-provider server; integration test over real
  HTTP/SSE; `ng build` production bundle measured (zod dominates, see README).
- New dependencies (approved in the plan): Angular 21.2.24 (`core`, `common`, `compiler`,
  `platform-browser`, `compiler-cli`, `build`, `cli`), `ng-packagr` 21.2.7, `rxjs` 7.8.2
  (Angular peer), `tslib`. `lmdb` build script allowed (Angular build cache).

## Batch 4 — Node SDK

- `@gixcopilot/server`: additive `defaultModel` option. A run request without `model` uses
  it (the server, not the browser, chooses the model); without the option, behavior is
  unchanged.
- New `@gixcopilot/node`: `createCopilot({ model, providers | modelRuntime, tools, security,
  telemetry })` returns `{ app, client, run, stream, nodeHandler, listen, close }`. In-process
  `run`/`stream` use the real `@gixcopilot/client` with a `fetch` that dispatches into Fastify
  via `inject` (streamed), so in-process calls go through the same routes, authentication,
  Action Firewall and approvals as HTTP (no second execution path). `nodeHandler()` mounts in
  `node:http`/Express. Fastify stays inside `@gixcopilot/server`; no Express adapter was added
  (the node handler covers it). 4 tests: in-process run/stream, firewall + authentication
  (permitted caller executes, caller without permission does not), real `node:http` serving,
  cancellation.
- `examples/node-basic`: a plain Node program (mock provider by default, OpenAI when
  `OPENAI_API_KEY` is set); 2 integration tests.

## Batch 5 — Configuration

- New `@gixcopilot/config`: one zod schema for service, database, Redis, models/providers,
  security, telemetry, DevTools, management and feature flags. Precedence: defaults < JSON file
  < environment < code overrides (`sources` records which applied). Unknown keys are errors.
  Environment rules: staging/production require `DATABASE_URL`, required authentication, no
  `development-verbose` telemetry, no mock provider; production forbids DevTools; DevTools
  always needs a token; the default model's provider needs a key. `ConfigError` lists every
  issue by path, never values.
- Secret boundary: config holds references (`{ secret: NAME }`); `SecretProvider` (env,
  mounted files with traversal rejection, composition, or custom) resolves them into `Secret`
  objects that redact themselves in `String`, `JSON.stringify` and `util.inspect`;
  `describeConfig` gives a doctor/log-safe view. 8 tests.
- Feature flags: a plain `features` map + `isFeatureEnabled` (Section 173), no flag service.

## Batch 6 — Multi-tenancy

- `@gixcopilot/server` (additive): `requireAuthentication` (401 without an identity);
  `admission` (checked after authentication, before any model call; may reject with a
  structured error or, when a policy says so, choose the model); `runObservers`
  (`onRunStarted`/`onEvent`/`onRunEnded`, failures logged and never fatal, flushed before
  the response ends). Existing 51 server tests unchanged and passing.
- New `@gixcopilot/tenancy` (platform-neutral): `RuntimeScope` (tenant, project,
  environment) derived only from the authenticated `SecurityContext` (tenant from the
  authentication adapter, project/environment from trusted identity attributes; malformed ids
  rejected); `requireScope`, `assertTenantOwns`; the Tenant/Project/Environment/Membership
  model with ranked tenant roles; the `ConversationStore` port whose data is reachable only
  via `forTenant(scope)` (no method takes a tenant id, so a filter cannot be forgotten); an
  in-memory implementation; `createConversationRecorder` (a run observer; `retain:
  'metadata' | 'content'`). 3 tests.
- Existing runtime isolation reused, not rebuilt: workflow checkpoints (tenant mismatch on
  resume/cancel/read), RAG retriever tenant filter, memory owner+tenant checks, audit
  `tenantId`, telemetry correlation `tenantId`, DevTools viewer scoping.

## Batch 7 — PostgreSQL persistence

- New `@gixcopilot/persistence-postgres`: Drizzle schema (`tenants`, `threads`, `messages`,
  `runs`, `memory_records`, `audit_records`, `usage_events`) with `tenant_id`-leading
  indexes for every query pattern; migration generated by drizzle-kit, plus a hand-written
  message→thread cascade and an audit immutability trigger; a reviewed `.down.sql`.
- Migrator: ordered sources (checkpoints, pgvector, platform), advisory lock (concurrent
  instances serialize), one transaction per migration, checksums (tampering detected),
  rollback only via reviewed down files. Not run at application startup.
- Repositories: `ConversationStore` (keyset pagination), `MemoryStore` (same write policy and
  access checks as the in-memory store), append-only `AuditSink` with tenant-scoped search and
  a retention purge; `health()` for readiness (never leaks the connection string).
- 7 Testcontainers tests on `pgvector/pgvector:pg16` (Docker running): migrations
  (concurrent up, idempotent, tamper detection, rollback/refusal), and Tenant A/Tenant B across
  threads/messages/runs, memory (cross-tenant and cross-user), knowledge (real pgvector
  through the real retriever), workflows (Postgres checkpoints: resume/cancel/read refused),
  audit (scoped search, UPDATE/DELETE rejected by trigger), and a server end-to-end run
  persisted under the authenticated tenant with anonymous runs refused (401). All passed.

## Batch 8 — Redis and workers

- `@gixcopilot/jobs` (additive): serializable named jobs for separate worker processes.
  `createJobQueue().enqueue(kind, payload, { idempotencyKey, tenantId, attempts, backoffMs })`
  uses stable job ids (`kind__key`) and keeps completed jobs for 24h, so a duplicate enqueue
  (queued, active or recently completed) resolves to the same job; bounded exponential
  retries. `createJobWorker({ handlers })`: `PermanentJobError`, non-retryable `CopilotError`s
  and unknown kinds dead-letter immediately (`UnrecoverableError`); exhausted retries
  dead-letter (inspect/replay with the existing `createDeadLetterInspector`); per-job
  `AbortSignal` (`cancel(jobId)`); `close(timeoutMs)` drains, then aborts stragglers. The
  existing in-process `createBullMQJobExecutor` is unchanged.
- New `@gixcopilot/redis` (`ioredis` 5.11.1, already in the tree through BullMQ):
  distributed rate limiter (atomic Lua, Redis server clock), memory limiter with the same
  interface, lease lock, health check.
- Tests on real Redis (`redis:7-alpine`): two workers sharing a queue (each job ran exactly
  once across 20 jobs, both workers used), duplicate suppression before and after completion,
  retry then success, permanent/validation/unknown/exhausted jobs dead-lettered with the right
  attempt counts, cancellation via abort signal, graceful close; three limiter instances
  sharing one limit (exactly 10 of 30 concurrent requests allowed), per-tenant keys, weighted
  cost; lock exclusivity and holder-only release.

## Batch 9 — Model routing and fallback

- New `@gixcopilot/model-router`: capability catalog, deterministic strategies (fixed,
  fallback, capability, policy) with reasons, explicit `preferTier`, requested model honored
  only when catalogued; per-model health (window, minimum samples, failure ratio, cooldown);
  `createRoutedModelRuntime` implementing `ModelRuntime` so it plugs into the existing server
  and Node SDK unchanged. Fallback is per model call, only before any text/tool call was
  emitted, only for eligible errors, never after cancellation.
- 6 tests: strategies, capability filtering, policy rules, health thresholds and
  per-model scope, error classification, Section 183 (429 on primary → backup answers, one
  call each), Section 184 (invalid request, auth error, mid-stream failure, cancellation →
  backup never called), Section 185 through the real server tool loop with the Action
  Firewall and an authenticated caller: model A requests a refund, the refund executes, model A
  fails transiently, the backup completes. Refund executed exactly once; one
  `execution.completed` audit record.

## Batch 10 — Usage, cost, budgets, quotas, rate limits

- Protocol (additive): `QUOTA_EXCEEDED`, `BUDGET_EXCEEDED` codes + `CopilotError.quotaExceeded`
  / `budgetExceeded`. Admission errors travel as HTTP error bodies, which the client passes
  through unvalidated, so older clients receive the code string unchanged. Protocol tests: 34
  pass.
- New `@gixcopilot/usage`: `UsageEvent`/`UsageStore` (tenant-scoped reads), in-memory store,
  `createUsageRecorder` (run observer), `createUsageMeter`, `PricingTable` +
  `estimateCostMicros` (no shipped prices; unpriced → no estimate), `createUsageAdmission`
  (budgets warn/block/throttle/route-cheaper, quotas, rate limits by tenant/project/user;
  anonymous callers refused when policies exist).
- 6 tests end to end through the real server: accounting per tenant/project/model with the
  estimated cost arithmetic, Section 187 budget warn → block (402 `BUDGET_EXCEEDED`, other
  tenant unaffected, no infrastructure names), route-cheaper switching model only by policy,
  throttle, quota vs rate limit, anonymous refusal.
- Multi-instance rate limiting on real Redis is covered in batch 8 (three instances, one limit).

## Batch 11 — Management API (control plane)

- New `@gixcopilot/management`: versioned resources with zod specs per kind (model, agent,
  tool, openapi, mcp, knowledge-source, prompt, security-policy, budget, rate-limit);
  `ControlPlaneStore` (in-memory + PostgreSQL); write-only `SecretStore`
  (`createEncryptedSecretStore`, AES-256-GCM, tenant+name AAD, key versions);
  `createManagementService` (authorization, validation, audit, security invariants, OpenAPI
  import via Phase 8 `inspectOpenAPI` with every operation stored disabled, knowledge reindex
  and eval start as idempotent jobs, Phase 11 DevTools traces and eval store/compare as
  tenant-scoped views, audit search, usage with "Estimated cost" label, security overview,
  config snapshots); `createSnapshotCache` (TTL + last-good fallback); Fastify plugin at
  `/management/v1` (authentication required, `cache-control: no-store`).
- `@gixcopilot/persistence-postgres`: control-plane tables (projects, environments,
  memberships, resources, resource_versions, secrets ciphertext) as migration
  `0001_control_plane` (+ reviewed down file, hand-written unique index and FKs);
  `createPostgresControlPlaneStore` (version creation under a row lock);
  `createPostgresSecretRepository`; `createPostgresUsageStore` (SQL aggregation over
  whitelisted dimensions).
- 10 management API tests (all pass); Postgres suite extended with usage and control-plane
  cases (to run when Docker is available).

## Batch 12 — Management platform UI

- New `apps/platform` (React 19 + Vite, existing versions): all Section 82 sections over the
  management HTTP API only (local client types, lint rule forbidding SDK/server imports in
  `src`). Admin actions appear by role; the server enforces them anyway.
- 6 jsdom tests against the REAL management service and plugin served in-process: sign-in
  (bad token rejected), full navigation/landmarks/skip link/focus/aria-current, project
  creation with default environments (audited), viewer read-only (and server 403 on a direct
  call), secret write-only (value never rendered), tool approval weakening rejected (422),
  RTL. Production bundle: 249 kB JS / 77 kB gzip, no zod or server code.

## Batch 13 — Production server and worker

- `@gixcopilot/server` (additive): `registerOperationalRoutes` (`/ready` with per-check
  timeouts and non-critical checks, 503 while shutting down; opt-in token-protected
  Prometheus `/metrics`), `createMetricsRegistry`, `createRunMetricsObserver` (no tenant or
  user labels); `logger` accepts Fastify logger options. 3 tests (54 server tests pass).
- `@gixcopilot/config`: JWT settings, metrics token, platform secret key, retention periods;
  new fail-fast rules.
- `@gixcopilot/persistence-postgres`: worker-only maintenance (expired memory, conversation
  and usage retention).
- New `apps/api`: `createApiServer({ config, tools, authentication, providers, pricing })`
  composing persistence, Redis limiter and job queue, routed model runtime (router + health),
  telemetry (OpenTelemetry API + redacted recording for platform traces), reference HS256 JWT
  authentication, firewall with durable audit, snapshot-driven budgets and rate limits,
  conversation/usage/metrics observers, management API, readiness/metrics, structured redacted
  logs, graceful shutdown; `main.ts` exits 78 on invalid configuration. JWT unit tests (2):
  forged, expired, not-yet-valid, wrong issuer/audience, `alg: none`, tampered tenant claim all
  rejected. Postgres + Redis end-to-end suite written (to run with Docker).
- New `apps/worker`: `createWorker` with `knowledge.index`, `maintenance.memory-expiry`,
  `maintenance.retention`, application handlers, daily idempotent scheduling, graceful
  shutdown. Postgres + Redis + two-worker suite written (to run with Docker).
- Durable approvals: `createPostgresApprovalStore` (migration `0002_approvals`, reviewed down
  file) implements the Phase 7 `ApprovalStore` with the same pure transition functions,
  row-locked revision compare-and-swap, expiry on read, and polling `awaitDecision`, so a
  decision posted to any API instance releases the run paused on another. `apps/api` uses it.

## Batch 14 — CLI

- New `@gixcopilot/cli` (bin `aicopilot`, `node:util.parseArgs`, no new dependency beyond the
  workspace's `yaml`): `init` (node, react, angular and enterprise templates; conflict
  detection, `--force`, `--dry-run`, `--sdk-path` tarball overrides for consumer tests), `add
  tool`, `add agent`, `add mcp` / `mcp list`, `import-openapi`, `dev`, `test`, `eval`,
  `doctor`, `db status|migrate|rollback --yes`, help with examples for every command.
- Found while testing: OpenAPI inspection dropped deny-by-default methods (DELETE) from the
  listing. The CLI and the management import now list every operation for review (still
  stored disabled).
- 9 unit tests: help/version/unknown commands, every template, overwrite protection, tarball
  overrides, tool/agent generation and registration, OpenAPI (nothing exposed), MCP (nothing
  exposed, bad URL rejected), doctor (failing checks, no secret values), rollback refused
  without `--yes`, eval JSON output and gate exit code. End-to-end generation + install + build
  runs in the package consumer tests (batch 18).

## Batch 15 — Deployment

Final smoke review: Compose host ports are overrideable (defaults 4000/8080); the smoke script chooses available loopback ports on Windows and can reuse prebuilt images with `--no-build`. The smoke client's empty-body reindex POST no longer sends a JSON content-type header, so it reaches the management route. Rebuilt images plus the corrected smoke request passed all 10 checks.

- `deploy/docker/Dockerfile.node` (api and worker via `APP` build arg): multi-stage, frozen
  lockfile install, Nx build, `pnpm deploy --prod --legacy` into an isolated production tree,
  runtime on `node:22.15.0-bookworm-slim` as the non-root `node` user, liveness HEALTHCHECK.
  `deploy/docker/Dockerfile.platform`: static build served by `nginx-unprivileged` (port
  8080, non-root) with security headers and a same-origin `/management/` proxy.
  `.dockerignore` excludes `.env*`, keys, build output and VCS data.
- `docker-compose.yml`: postgres (pgvector), redis (AOF), one-shot `migrate`, api (readiness
  health check), two worker replicas, platform; secrets come from `deploy/.env` (git-ignored;
  `deploy/.env.example` has placeholders only).
- `tools/docker-smoke.mjs`: builds and starts the stack with per-run generated secrets
  (AICOPILOT_ENV=test + mock provider, no paid API) and checks readiness, non-root containers,
  no `.env` in images, tenant creation, authenticated streaming chat with persistence, tenant
  isolation, usage and traces, worker dead-lettering, protected metrics, restart persistence.
- Verified without Docker: the `pnpm deploy` production tree for `apps/api` resolves all
  modules and exits 78 with a clear list on empty production configuration. NOTE: running
  `pnpm deploy --prod` inside the dev workspace re-links the root `node_modules` in production
  mode (dev tools disappear); it belongs in image/CI builds only (`CI=true pnpm install`
  restores a dev tree).

## Batch 16 — CI, release and security review

Final production audit found [GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9) in the existing Drizzle ORM 0.44.7 used by three PostgreSQL adapters. Updated them to 0.45.3, above the patched 0.45.2 boundary. The application uses static/allowlisted identifiers, but the high-severity advisory still made the production audit gate fail. The same ORM remains in the same adapter packages; no new dependency was introduced. `pnpm audit --prod --audit-level high` then found no known vulnerabilities.

- `.github/workflows/ci.yml`: affected (PR) / full (main) lint, typecheck, test, build with
  Testcontainers; security job (secret scan, `pnpm audit --prod --audit-level high`, security
  and tenant suites); deterministic eval gate; package verification + clean consumers + bundle
  budgets; Playwright; Docker smoke; docs build. No paid API anywhere.
- `.github/workflows/release.yml`: manual internal candidate validation, packed-artifact
  checks, and a dry-run `nx release version` preview. The owner chose no public
  npm publication, so the workflow has no publish step or registry credential. `nx.json` `release`:
  fixed version group for all SDK packages, conventional commits, workspace `CHANGELOG.md`,
  disk fallback for the first release; `@gixcopilot/angular` publishes from `dist/`. `nx release
  version prerelease --dry-run` verified (all packages 0.1.0 → 0.1.1-0, nothing written).
- `tools/secret-scan.mjs`: heuristic scan of tracked/unignored files, reports locations only.
  **Finding: `examples/react-generative-ui/.env.example` contained a value shaped like a real
  OpenAI project key (committed in `364ace6`, 2026-09-19).** The value was replaced with an
  empty placeholder; it remains in git history. The owner subsequently confirmed
  revocation, rotation and exposure review. No other commit adds such a key.

## Batch 18 — Packaging, consumers and bundles

- `tools/verify-packages.mjs`: all 39 publishable packages packed and inspected: 0 failures
  (after fixing: tenancy README; `@gixcopilot/angular` publishes `dist/` without a `files`
  filter and without top-level `types`/`module` that ng-packagr would copy with wrong paths).
- `tools/consumer-test.mjs` (clean projects outside the monorepo, tarballs only): Node
  (typecheck against shipped `.d.ts`, build, run in-process and over HTTP/SSE), React (typecheck,
  Vite build, SSR render, no server code in the 519 kB bundle), Angular (`ng build` AOT with
  `provideCopilot`, 623 kB, no server code), packed CLI install, and CLI end to end for all four
  templates (init + add tool + add agent + install + typecheck + build + generated tests): 7/7
  pass (in two runs: 2/2, then 5/5 after the fixes below).
- Found: npm 10.9.2 crashes installing `vitest` 4 or 5 in ANY project (arborist `#loadPeerSet`,
  npm bug); npm 11 works. Generated READMEs say npm 11+ or pnpm, `doctor` warns on npm < 11,
  the consumer test installs with npm 11. The Angular template pins Vitest 4.1.11 because
  `@angular/build` 21 declares an optional Vitest 4 peer.
- `tools/bundle-report.mjs` (workspace Vite, React external, minified; gzip): protocol single
  export 0.1 kB (tree shaking), client 33.8 kB, headless 10.4 kB, react hooks 43.2 kB, styled UI
  chat 60.0 kB; no server modules in any bundle. Budgets set at about 1.2x measured.

## Batch 17 — Documentation

- New `apps/docs` portal (Vite + React + the existing `react-markdown`; no new docs stack):
  renders `docs/guides`, `docs/production`, `docs/reference`, `docs/migrations`, VERSIONING,
  RELEASING, ARCHITECTURE_OVERVIEW and ROADMAP with sectioned navigation, search, in-app link
  handling, skip link, focus management and RTL-safe layout. Build fails on broken relative
  links. Tests: every `<!-- snippet -->` quickstart block equals a type-checked file in
  `apps/docs/snippets` (compiled against the real packages), IA coverage, accessible
  navigation. 3 tests pass; build 494 kB JS.
- Guides (`docs/guides`): getting-started, concepts, react, angular, node, models,
  context-and-state, tools, generative-ui, openapi, mcp, rag, memory, agents, workflows,
  security, multi-tenancy, devtools, testing, evaluations, production, deployment, cli,
  platform, examples.
- Production (`docs/production`): CONFIGURATION, DEPLOYMENT, DATABASE, REDIS, WORKERS,
  SCALING, SECURITY, OBSERVABILITY, RATE_LIMITING, USAGE_AND_COST, BACKUP_RECOVERY, OPERATIONS.
- `docs/VERSIONING.md`, `docs/RELEASING.md`, `docs/migrations/` (Phase 12: no breaking
  changes), `docs/ARCHITECTURE_OVERVIEW.md`, `docs/ROADMAP.md`.
- `tools/api-reference.mjs` generates `docs/reference/api.md` (39 packages) from the shipped
  `.d.ts` files, with a `--check` mode.

## Platform browser E2E and accessibility

- `apps/api/src/dev-backend.ts`: development-only backend (refuses production) running the
  real management service and plugin over in-memory stores, plus a real copilot server (mock
  model, labelled) whose runs seed conversations, usage and traces, and a real eval run.
- `tests/browser/platform.spec.ts` (Playwright, Chromium): project creation with
  environments, write-only secret, model resource, tool security view, knowledge source and
  reindex job, agents, evaluations (list + start), traces, audit, usage with estimated cost;
  viewer restrictions, skip link, keyboard navigation, RTL, 390 px width, tenant isolation
  (another tenant sees no conversations); axe-core (no serious/critical violations) on the
  platform and on DevTools. Full suite: 11/11 pass.
- Bugs found and fixed by these tests: the Knowledge reindex list did not refresh after adding a
  source; the skip link's `#fragment` collided with hash routing (platform and docs portal);
  the off-screen skip-link technique created 10,000 px of horizontal scroll in RTL; grid
  tracks overflowed at phone width (`minmax(0, 1fr)` + `min-width: 0`).
