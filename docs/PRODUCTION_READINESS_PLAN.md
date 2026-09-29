# Production Readiness Plan

> Created 2026-09-28 from a readiness audit of the published `@gixcopilot/*` packages.
> This is post-Phase-12 hardening, not a new phase. Items marked **(decision)** need an
> explicit go-ahead before implementation (see the `phase-gate` skill): they add behavior
> rather than fix it.

## Audit baseline (2026-09-28)

| State on npm              | Count | Packages                                                                                                                                                                         |
| ------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Published at 0.1.1        | 15    | client, config, context, core, generative-ui, headless, node, openapi, protocol, provider, provider-openai, security, server, telemetry, tools                                   |
| Published, stale at 0.1.0 | 10    | agents, angular, devtools, evals, integrations, knowledge, mcp, provider-mock, redis, tenancy                                                                                    |
| Never published           | 17    | checkpoint-postgres, cli, connectors, create, jobs, management, memory, model-router, persistence-postgres, rag, react, testing, ui, usage, vectorstore-pgvector, vue, workflows |

- `pnpm validate`: all 68 projects pass, except that `react-generative-ui:test` fails when
  `OPENAI_API_KEY` is set locally (optional real-OpenAI smoke test).
- The Docker-backed integration suites (Postgres, pgvector, Redis, BullMQ) were skipped
  locally because Docker wasn't available.
- `pnpm audit --prod --audit-level high`: clean.
- Every published package's `@gixcopilot/*` dependencies resolve on npm.

---

## Stage 1 — Diagnose the partial publish

**Goal:** know why the 0.1.1 publish stopped before re-running it.

1. Open the latest _Release_ workflow run in GitHub Actions and find the last
   `+ @gixcopilot/...` line in the _Publish to npm_ step, plus the error that follows it.
   Likely causes, in order:
   - `NPM_TOKEN` expired, or it's a non-automation token that hit a 2FA/OTP prompt.
   - A package failed `prepublishOnly`/pack (for example `angular` publishing from `dist`
     that wasn't built in that job).
   - npm rate limiting from 42 publishes in a row (E429).
   - The 0.1.0 set was published from a workstation, and 0.1.1 from a second, partial run.
2. If the log is gone, reproduce locally without publishing:
   `pnpm -r --filter "./packages/**" publish --dry-run --no-git-checks`.
3. Record the cause in `docs/RELEASING.md` under a "Known failure modes" heading.

**Done when:** the root cause is written down and fixed in the workflow or in the token.

## Stage 2 — Harden the release workflow

**Goal:** a publish can never again silently leave npm in a mixed state.

1. Add `tools/check-npm-published.mjs`. For every non-private package under `packages/`,
   it compares `npm view <name> version` with the local version, prints a table, and exits
   non-zero on any mismatch or 404. The `--expect <version>` flag makes it assert one
   fixed version.
2. In `.github/workflows/release.yml`:
   - Add `--report-summary` to the publish command and upload
     `pnpm-publish-summary.json` as an artifact.
   - Add a final step, `node tools/check-npm-published.mjs --expect <version>`, that runs
     after publishing (`if: inputs.publish`). A partial publish then turns the run red.
3. Document in `docs/RELEASING.md` that re-running the workflow is the recovery path.
   pnpm skips versions that already exist on npm, so a re-run is idempotent.

**Done when:** a dry run of the workflow passes and the check script reports the current
mixed state (expected to fail today).

## Stage 3 — Publish all 42 packages at one version

> **Superseded (2026-09-28):** the owner chose to skip 0.1.2 and release 0.2.0 directly
> (Stage 7), deprecating every earlier version. The deprecation step below applies to 0.2.0.

**Goal:** every package is on npm at the same version.

A published version can't be republished, so publish **0.1.2** (not 0.1.1) for all
packages. That brings the 10 stale and 17 missing packages up to match the others.

1. Push CI-green `main`, including the Docker suites that were skipped locally (see
   Stage 4, step 1).
2. `pnpm exec nx release version patch` creates the release commit and the `v0.1.2` tag.
3. Run the release workflow with `publish: true` and `tag: latest`.
4. `node tools/check-npm-published.mjs --expect 0.1.2` must print 42 matches.
5. Deprecate the mixed prior versions so nobody pins them:
   `npm deprecate "@gixcopilot/<pkg>@<0.1.2" "Partial release; use >=0.1.2"`
   (per package, or scripted).

**Done when:** all 42 packages report `0.1.2` on npm.

## Stage 4 — Verify like a real consumer

**Goal:** prove the published packages work outside the monorepo.

1. **Docker suites.** Confirm the CI `validate` job ran the Testcontainers suites
   (checkpoint-postgres, persistence-postgres, vectorstore-pgvector, redis, jobs,
   tenancy) and that they _executed_ rather than skipped. If they skip in CI too, make
   skipping a failure there (for example a `REQUIRE_DOCKER=1` env var that turns the skip
   into an error).
2. **Scaffolder, end to end.** From a clean directory outside the repo:
   ```sh
   npm create @gixcopilot@latest my-app      # try each template: react, vue, angular, node
   cd my-app && npm install && npm run build && npm test
   ```
3. **Install matrix.** Test with npm, pnpm and yarn, on Node 22 LTS and Node 24.
4. **Fix the local smoke-test failure.** Either unset `OPENAI_API_KEY` for `pnpm validate`,
   or make `examples/react-generative-ui/src/openai-smoke.spec.ts` opt-in through a
   dedicated flag (for example `RUN_OPENAI_SMOKE=1`), so a shell key doesn't break local
   validation.

**Done when:** every template installs, builds and tests cleanly from npm on both Node
versions.

## Stage 5 — Fix production risks

### 5.1 Tool timeout must abort the tool (bug fix)

`packages/tools/src/tool-runtime.ts`: `raceWithDeadline` rejects on timeout, but
`tool.execute` still receives the run's `context.signal`, which never fires. The tool keeps
running, and can cause side effects, after the caller has been told it failed.

- Create a per-call `AbortController` linked to `context.signal` (abort it when the parent
  aborts, and remove that listener in cleanup).
- Pass `{ ...context, signal: controller.signal }` to `tool.execute`.
- Call `controller.abort(new ToolTimeoutSignal())` when the timer fires.
- Regression test: a tool that awaits its signal sees `aborted === true` after the
  timeout, and the parent run signal is **not** aborted.
- Move the Phase 11 note in `docs/TECHNICAL_DEBT.md` to _Resolved_.

### 5.2 Multi-instance deployments **(decision)**

The run registry, `FrontendToolBridge`, approval store, audit sink and rate limiter are
process-local.

- **Short term (docs only, no decision needed):** in `docs/production/SCALING.md` and
  `deploy/`, require sticky routing by `runId`/`threadId` for cancel and frontend
  tool-result requests. Ship a sample nginx/ingress config. Point multi-instance users to
  the Postgres/Redis-backed approval store, audit sink and limiter where those exist.
- **Long term (new feature, needs an explicit go-ahead):** a Redis-backed run registry
  and bridge using `@gixcopilot/redis` pub/sub, so any instance can route a cancel request
  or a tool result.
- **Decision (2026-09-28): no, not for 0.2.0.** Sticky routing is documented and required
  for multi-instance deployments. Revisit when a user needs deployments without affinity.

### 5.3 Document the known limits for users

Add a "Known limitations" section to the READMEs of `mcp`, `workflows` and `evals`, taken
from `docs/TECHNICAL_DEBT.md`:

- MCP resource/prompt discovery reads only the first page.
- Workflow `parallel` steps can't abort other branches early.
- Groundedness scoring is a lexical heuristic.

### 5.4 Changelog

- Generate `CHANGELOG.md` with `pnpm exec nx release changelog <version>` (already
  configured in `nx.json` → `release.changelog.workspaceChangelog`) and commit it.
- Include the changelog step in the Stage 3 release from then on (`nx release` runs it
  automatically when not skipped).

## Stage 6 — Tidy the repo and add metadata (nice to have)

1. **Package discoverability.** Add a `keywords` array to all 41 packages that lack one,
   for example `["ai", "copilot", "agent", "llm", "sdk", "<package topic>"]`. Also add a
   check to `tools/verify-packages.mjs` so new packages can't omit it.
2. **Stability labels.** Each package README gets a status badge: `stable`, `beta` or
   `experimental`. Suggested split:
   - stable: protocol, core, client, server, provider*, tools, security, react, ui
   - beta: the rest
   - experimental: management, model-router, usage

   Record the policy in `docs/VERSIONING.md`.

3. **The private flag stays as is.** `testing`, `cli` and `create` are public products
   (the testing SDK, the CLI and the scaffolder), so they stay publishable. Only mark a
   package `"private": true` if it's internal only.
4. **Repo-root hygiene.**
   - Move `GIX_Quotation_Kit/` and `GIX_Quotation_Kit.zip` out of the repo (or add them
     to `.gitignore`). They're unrelated to the SDK.
   - Delete the empty `tsconfig.jso/` directory (it's a typo).
   - `*.log`, `.packs/` and `test-results/` are already ignored, so no action is needed.

## Stage 7 — 0.2.0: first production-ready release

Run it once Stages 1–6 are done.

1. Run `pnpm validate` and CI green (all jobs, with the Docker suites actually executing).
2. `pnpm exec nx release version minor`, then generate the changelog, then run the
   release workflow with `publish: true`.
3. `node tools/check-npm-published.mjs --expect 0.2.0` must print 42 matches.
4. Repeat the Stage 4 consumer checks against 0.2.0.
5. Update `docs/PROJECT_STATUS.md` and the root `README.md` with the release and the
   stability policy.

---

## Checklist

- [x] 1 — Root cause of the partial publish recorded (`docs/RELEASING.md`, from npm
      publish timestamps)
- [x] 2 — `check-npm-published.mjs` and a release workflow post-publish check
- [x] 3 — Superseded by Stage 7 (owner decision 2026-09-28: no 0.1.2; release 0.2.0)
- [x] 4 — Docker suites run green in CI (`REQUIRE_DOCKER=1`); `RUN_OPENAI_SMOKE=1` opt-in;
      consumers tested with npm 10 and npm 11 in CI. Verified from npm (0.2.1): all four
      templates with npm 10 and 11; node and react with pnpm, yarn 1 and Node 24. Found and
      fixed: npm 10 install crash (0.2.1), yarn 1 missing `vite` peer (0.2.2).
- [x] 5.1 — Tool timeout aborts the tool (with a regression test)
- [x] 5.2 — Sticky-routing docs shipped; Redis registry decided: no (for now)
- [x] 5.3 — Known limitations in the READMEs
- [x] 5.4 — `CHANGELOG.md` generated
- [x] 6 — Keywords, stability labels, repo cleanup
- [ ] 7 — 0.2.x released and verified. _0.2.0 and 0.2.1: all 42 packages on npm. 0.2.2
      (yarn 1 fix): tagged, waiting on the Release run. Open: deprecate 0.1.x
      (`bash tools/deprecate-old-versions.sh`, needs the owner's npm 2FA code)._
