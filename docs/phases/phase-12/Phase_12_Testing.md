# Phase 12 testing

Every result below was produced by a command actually run in this session; nothing is assumed.

## Completion record check (2026-09-27)

After the owner confirmed credential revocation, rotation and exposure review,
`pnpm validate` passed for all 64 projects (254/254 tasks served from the Nx cache).
The documentation portal build passed, the current-tree secret scan checked 1,358 files
with zero findings, and `git diff --check` passed. Provider-side revocation is
owner-attested; these commands cannot independently verify it.

## Final internal candidate rerun (2026-09-27)

- Fresh `NX_SKIP_NX_CACHE=true pnpm validate`: lint, typecheck, test and build passed for
  all 64 projects with no cached tasks.
- `node tools/verify-packages.mjs --out <temporary directory> --keep`: 39/39 packages
  packed and verified. `node tools/consumer-test.mjs --packs <that directory>`: 8/8
  clean consumers passed, including Node, React, Angular and all four CLI starters.
- `pnpm exec nx release version prerelease --dry-run` passed and made no changes. The
  candidate workflow now has no public publish step or credential. A standalone
  `nx release changelog --dry-run` was found to require an explicit target version;
  that invalid step was removed from the workflow.
- `pnpm --filter @gixcopilot/docs build` passed after the release-documentation edits.
  `node tools/secret-scan.mjs` checked 1,358 current-tree files with zero findings.
- The owner subsequently confirmed that the previously committed real credential was
  revoked and rotated and its exposure reviewed. This is owner-attested; repository checks
  cannot independently verify provider-side revocation.

## Baseline before any Phase 12 change (Section 4)

`npx nx run-many -t lint,typecheck,test,build --skip-nx-cache` on the committed Phase 11 tree
(2026-09-27), with Docker running:
**47/47 projects passed lint, typecheck, test and build; 1,276 tests passed, 4 skipped, 0 failed.**
The Docker-gated Testcontainers suites (`checkpoint-postgres`, `jobs`, `vectorstore-pgvector`)
ran. The 4 skips are the optional real-OpenAI smoke tests in older examples (no key in the
environment). No previous-phase failures to record.

## Final validation rerun (2026-09-27)

- `pnpm validate`: **passed** lint, typecheck, test and build targets for 64 projects. The final post-upgrade run executed 235 of 254 tasks and reused cached output for 19 unchanged tasks. The first run found four failing targets; the affected targets were rerun after fixes.
- Focused real infrastructure reruns: `persistence-postgres` 10/10, `apps/worker` 3/3, `apps/api` 5/5. PostgreSQL, pgvector and Redis ran in Testcontainers. The API run verified a budget block, conversation persistence and tenant separation; the worker run verified indexing and dead letters.
- `pnpm test:e2e`: 11/11 Chromium tests passed, including the platform tenant/role journey, phone width and RTL, and a DevTools accessibility scan.
- `node tools/verify-packages.mjs`: 39/39 tarballs passed content and export checks. All 39
  lack a license field. The owner subsequently chose proprietary distribution with no public
  npm publication; this is now documented in [Releasing](../../RELEASING.md).
- Clean external consumer projects installed the initial packed tarballs and passed 8/8 checks: Node and HTTP/SSE, React with SSR, Angular AOT, packed CLI, and generated Node, enterprise, React and Angular starters. After the Drizzle upgrade, tarball inspection was repeated (39/39 passed), then the upgraded packed CLI and enterprise starter passed 2/2 checks.
- `node tools/bundle-report.mjs`: all five browser bundle budgets passed. `node tools/api-reference.mjs --check`: current. Final `node tools/secret-scan.mjs`: 1,358 files scanned, zero findings in the current tree.
- `pnpm exec nx release version prerelease --dry-run`: passed and proposed 0.1.1-0 for the fixed package group; no files, commit or tag were written. Nx printed an optional `swc-node`/`ts-node` warning before successfully executing its pre-version build.
- Docker smoke on rebuilt images after the Drizzle upgrade: **10/10 passed**. It verified database migration/readiness, the platform proxy, non-root users, no embedded `.env`, authenticated SSE with persistence, tenant isolation, usage/traces, queued worker reindex and duplicate suppression, protected metrics, and an API restart retaining durable data. The first attempt was blocked by host port 8080 on Windows; Compose now permits host port overrides and the smoke script selects available ports. A later attempt's worker check exposed an invalid empty JSON POST in the smoke client; removing that header made the real reindex flow pass. The final run reused the already built images (`--no-build`); the image build itself succeeded in the preceding attempt.
- `pnpm audit --prod --audit-level high` initially found a high-severity Drizzle ORM advisory. The three database adapters were upgraded from 0.44.7 to 0.45.3; the audit was rerun and reported **no known vulnerabilities**. See [GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9). Full validation was rerun after this dependency change.
- Optional real OpenAI smoke tests skipped because `OPENAI_API_KEY` was absent.

The first full run's failures were corrected: PostgreSQL error causes are decoded for duplicate-key conflicts; server run observers finish startup before dependent end writes; the development mock emits deterministic usage so budget enforcement can be tested; a worker test injects a trusted local fixture loader while production keeps the web SSRF guard; API assertions now reflect each tenant's own persisted conversation and close the migration pool.

## Local performance sample

`node apps/api/dist/benchmarks.js --streams 50 --json` on Windows 10.0.26200, Node 22.15.0, Ryzen 5 5600H (12 logical cores, 34 GB): 50 simultaneous 40-token mock streams completed with zero failures; first-byte p95 157.15 ms, completion p95 745.03 ms, RSS increase 22 MB. In-memory retrieval over 5,000 vectors: p95 3.76 ms (300 iterations). These values describe this machine and fixture only.
