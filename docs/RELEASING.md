# Releasing

The `@gixcopilot/*` SDK packages are published to the public npm registry under the
[MIT license](../LICENSE), from the npm account `gixtech`. All packages share one fixed
version (Nx fixed release group). Apps and examples stay `private` and are never published.

## Before every publish

```bash
pnpm install --frozen-lockfile
pnpm validate                                   # lint, typecheck, test, build
node tools/verify-packages.mjs --out .packs --keep
node tools/consumer-test.mjs --packs .packs     # clean npm consumers install the tarballs
```

`verify-packages.mjs` fails if a tarball lacks a README, LICENSE or `license` field, contains
tests, `.env` files or secret-shaped strings, or still has `workspace:` specifiers.

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

1. `pnpm exec nx release version <patch|minor|major|prerelease> --dry-run`, then without
   `--dry-run` to bump every package and create the release commit and tag.
2. Rebuild and run the checks above.
3. Publish as above, or run the [release workflow](../.github/workflows/release.yml) with
   `publish: true`. It uses the `NPM_TOKEN` repository secret (an npm automation token for
   `gixtech`) and publishes with provenance.

Prereleases go to the `next` dist-tag (`--tag next`). A published version can never be reused;
npm allows unpublishing only within 72 hours, so fix mistakes with a new patch version and
`npm deprecate` instead.

## Credential history

The owner confirmed revocation and rotation of the real credential that previously
appeared in `examples/react-generative-ui/.env.example` and completion of its exposure
review. The current tree contains a blank placeholder. This provider-side action is
owner-attested; repository checks cannot verify it.
