# Releasing

The `@gixcopilot/*` SDK packages are published to the public npm registry under the
[MIT license](../LICENSE), from the npm account `gixtech`. All packages share one fixed
version (Nx fixed release group). Apps and examples stay `private` and are never published.

## Before every publish

```bash
pnpm install --frozen-lockfile
REQUIRE_DOCKER=1 pnpm validate                  # lint, typecheck, test, build; Docker suites must run
node tools/verify-packages.mjs --out .packs --keep
node tools/consumer-test.mjs --packs .packs     # clean npm consumers install the tarballs
```

`verify-packages.mjs` fails if a tarball lacks a README, LICENSE, `license` or `keywords` field,
contains tests, `.env` files or secret-shaped strings, or still has `workspace:` specifiers.
`REQUIRE_DOCKER=1` turns the Testcontainers suites (Postgres, pgvector, Redis, BullMQ) from
"skip when Docker is unreachable" into a failure, so a release is never validated without them.

## First publish from a workstation

The `@gixcopilot` scope must be an npm organization owned by the `gixtech` account (create a
free organization named `gixcopilot` at <https://www.npmjs.com/org/create>). Then:

```bash
npm login                                       # as gixtech; 2FA prompts for an OTP
pnpm -r --filter "./packages/**" publish --access public --no-git-checks
```

pnpm publishes in dependency order, rewrites `workspace:*` to real versions, and publishes
`@gixcopilot/angular` from its ng-packagr `dist` directory (`publishConfig.directory`).
Provenance attestations need a CI OIDC token, so only the release workflow adds them (`NPM_CONFIG_PROVENANCE=true`).

## Later releases

1. Bump the hard-coded scaffolder versions to the new version: `VERSION` in
   `packages/cli/src/cli.ts` and `packages/create/src/plan.ts`, and the default SDK range in
   `packages/cli/src/templates.ts`. Their tests fail if these drift from `package.json`.
   After bumping and building, regenerate the API reference (`node tools/api-reference.mjs`);
   CI fails when `docs/reference/api.json` is stale.
1. `pnpm exec nx release version <patch|minor|major|prerelease> --dry-run`, then without
   `--dry-run` to bump every package and create the release commit and tag.
2. `pnpm exec nx release changelog <version>` prepends the entry to
   [CHANGELOG.md](../CHANGELOG.md), pushes, and creates the GitHub release (needs a
   `GITHUB_TOKEN` with `contents: write`). Add `--dry-run` first to preview.
3. Rebuild and run the checks above.
4. Publish as above, or run the [release workflow](../.github/workflows/release.yml) with
   `publish: true`. It uses the `NPM_TOKEN` repository secret (an npm automation token for
   `gixtech`) and publishes with provenance.
5. Confirm the registry matches: `node tools/check-npm-published.mjs` (the release workflow
   runs this after publishing and fails on any missing or stale package).

Prereleases go to the `next` dist-tag (`--tag next`; check with
`node tools/check-npm-published.mjs --tag next`). A published version can never be reused;
npm allows unpublishing only within 72 hours, so fix mistakes with a new patch version and
`npm deprecate` instead.

## Recovering from a partial publish

`pnpm -r publish` publishes packages one by one and does not roll back. If it stops midway
(expired or non-automation `NPM_TOKEN` hitting a 2FA prompt, `E429` rate limiting, a package
that fails to pack), npm is left with some packages at the new version and the rest behind.
0.1.0/0.1.1 ended up this way.

1. Read the *Publish to npm* step log (or the `pnpm-publish-summary` artifact) to find the
   first failing package and its error, and fix the cause.
2. Re-run the release workflow with `publish: true` for the **same** version. pnpm skips
   versions that already exist on the registry, so a re-run only publishes what is missing.
3. `node tools/check-npm-published.mjs` must report every package `ok`.

### What happened with 0.1.0 and 0.1.1

Reconstructed from `npm view @gixcopilot/<name> time` (the run logs were not available):

- **0.1.0** (2026-09-27, 15:20–15:22 UTC) was one `pnpm -r publish`: 25 packages about 1.5 s
  apart in dependency order, ending with `node`. It then stopped; `react`, `ui`, `rag`,
  `memory`, `workflows`, `jobs` and others already existed and were never published. A
  `pnpm -r publish --dry-run` of the same tree packs all 42 packages cleanly, so the failure
  was on the registry side, most likely npm's `E429` limit on creating many new package
  names in quick succession. It went unnoticed because nothing compared npm with the
  workspace afterwards.
- **0.1.1** (2026-09-28, 09:37–13:50 UTC) was not a workflow run: 15 packages published by
  hand over four hours, exactly `@gixcopilot/node` and its dependency closure.

Fix: publish only through the release workflow, which now uploads the publish summary and
fails on any missing or stale package (`tools/check-npm-published.mjs`). On `E429`, wait and
re-run the workflow for the same version.

If the fixed-version rule is already broken on `latest` (packages at different versions), cut
a new patch version for all packages and `npm deprecate` the mixed versions:
`npm deprecate "@gixcopilot/<name>@<version>" "Partial release; use >=<new version>"`.

## Credential history

The owner confirmed revocation and rotation of the real credential that previously
appeared in `examples/react-generative-ui/.env.example` and completion of its exposure
review. The current tree contains a blank placeholder. This provider-side action is
owner-attested; repository checks cannot verify it.
