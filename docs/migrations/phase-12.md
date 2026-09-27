# Migrating to the Phase 12 packages

**Breaking changes: none.** Every Phase 12 change to an existing package is additive.

| Package | Change | Action |
| --- | --- | --- |
| `@gixcopilot/react` | The chat store and chat types moved to the new `@gixcopilot/headless`; React re-exports every type unchanged | None. Types may now show `@gixcopilot/headless` as origin |
| `@gixcopilot/server` | New optional `defaultModel`, `requireAuthentication`, `admission`, `runObservers`; `logger` also accepts Fastify logger options; new `registerOperationalRoutes`, metrics helpers | None. Set `requireAuthentication: true` in production |
| `@gixcopilot/protocol` | New error codes `QUOTA_EXCEEDED`, `BUDGET_EXCEEDED` (returned on HTTP errors; clients pass unknown codes through) | Handle them in custom UIs if you surface admission errors |
| `@gixcopilot/memory` | `memoryExpiry` exported | None |
| `@gixcopilot/jobs` | New serializable `createJobQueue` / `createJobWorker` beside the unchanged `createBullMQJobExecutor` | Optional |
| All packages | Publish metadata (`repository`, `engines: node >=22.12.0`, `publishConfig`); tarballs no longer contain compiled tests | None |
| `checkpoint-postgres`, `vectorstore-pgvector` | `migrations/` now shipped; apply through `aicopilot db migrate` | Run migrations as a deployment step |

**New packages**: `headless`, `angular`, `node`, `config`, `tenancy`, `persistence-postgres`,
`redis`, `model-router`, `usage`, `management`, `cli`.

**Database**: new platform migrations `platform/0000_platform`, `0001_control_plane` and
`0002_approvals` are additive (new tables only) and each ships a reviewed down file. Existing
`checkpoints` and `vectors` migrations are unchanged. Order: `aicopilot db migrate` → deploy
API → deploy workers.

**Configuration**: new optional variables (see [CONFIGURATION](../production/CONFIGURATION.md)).
In staging and production, `DATABASE_URL` and `AICOPILOT_REQUIRE_AUTH=true` are now required
when you use `@gixcopilot/config`.
