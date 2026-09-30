# Universal Existing-Project Installer - Status

> Plan: [INSTALLER_PLAN.md](INSTALLER_PLAN.md). Handoff: [CODEX_PROMPT.md](CODEX_PROMPT.md).
> Installer verification recorded 2026-09-30. Authorized 0.2.4 coordinated release
> candidate; npm publication pending registry verification.

## Final Status: READY

READY means the handoff's mandatory fixture and security checks passed, not that every
detected framework's generated UI has been compiled. The original 69-section brief was
not found in this repository; this report follows the handoff's available requirements.

The SDK remains Experimental, not for production. READY is not a universal
production-readiness claim or proof of npm publication. The evidence below records the
installer handoff verification, not reruns by this documentation update. The main release
session owns release validation and the final publication-evidence update after registry
verification; those release results are pending here.

## Completion Report

| Requirement | Result | Evidence |
| --- | --- | --- |
| Classification and normalized discovery | PASS | Studio regression/integration suites |
| SDK install planning, selection, idempotency and refresh | PASS | 54 SDK tests across 5 files, zero failures/skips |
| Dry-run and failed-install safety, secret-free manifest and status | PASS | SDK fixtures snapshot application trees |
| Generated tool loading and generated server compilation | PASS | SDK tests; ESM/CommonJS/no-type compile and module-loading regressions |
| Application changes remain proposals until approval | PASS | Unit security tests and React/Express consumer refusal-before-approval checks |
| Safe approval excludes destructive, downgraded, review and conflicted tools | PASS | Studio safety regressions |
| Persisted proposals cannot carry approval authority | PASS | Schema validation, reapproval on restart, independent integration target validation |
| Proposal file symlinks cannot overwrite external targets | PASS | Persistence regressions; regular-file checks and atomic replacement |
| Installer metadata cannot redirect writes into source or secrets | PASS | 13 metadata regressions; link/parent rejection and atomic replacement |
| Multi-app isolation and SSR-safe integration | PASS | App integration regressions; unselected apps emit no files |
| Production has no Studio | PASS | Lazy-import SDK regression and all ten consumers: Studio/preview/API 404, health 200 |
| Documentation and API reference | PASS | Public guides updated; generated API reference covers 44 packages and check passes |
| Frozen dependency install | PASS | `pnpm install --frozen-lockfile`; no additional lockfile regeneration |
| Repository validation | PASS | `pnpm validate`: 72 projects, 286 tasks; 282 cached and 4 fresh in recorded final main run |
| Browser suite | PASS | `npx playwright test`: 23 passed |
| Secret scan | PASS | 1641 files checked, zero findings |
| Package verification | PASS | 44 packages packed, zero failures |
| Mandatory packed consumers | PASS | 10 passed, zero failures; coverage limits below |

Validation's aggregate test summaries contain 1569 passed and 53 skipped, including cached
results. This is not a claim of 1569 freshly executed tests. The recorded main run executed
54 SDK tests fresh; separate Studio runs executed 106 tests successfully. Skips cover
Docker-dependent infrastructure and optional live-provider tests; they are not installer
tests introduced to suppress failures.

## Packed Consumers

### 0.2.4 Release Candidate Validation

Fresh release validation on 2026-09-30, before publication:

- `pnpm install --frozen-lockfile`: passed.
- `REQUIRE_DOCKER=1 pnpm validate -- --skip-nx-cache`: all 72 projects and 286 tasks
  passed with no Nx task cache; 1617 tests passed, 6 optional OpenAI smoke tests skipped.
  All Docker-backed PostgreSQL/pgvector/Redis/BullMQ suites ran, with no infrastructure skips.
- Playwright: 23 passed. Secret scan: 1641 files checked, zero findings.
- API reference: generated for 44 packages and freshness check passed.
- Package verification: 44 packages packed to `.packs/release-0.2.4`, zero failures.
- Clean package consumers: 8/8 passed with bundled npm and 8/8 with npm 11.
- Installer consumers: 10/10 passed against the 0.2.4 tarballs, retaining the framework
  coverage limits below. Evidence:
  `C:\Users\afoud\AppData\Local\Temp\gix-installer-consumers-3U6VWb\results.json`.

Publication and registry-backed installation remain pending; these are packed release
candidate checks, not proof that npm serves the packages.

| Fixture | Result | Coverage |
| --- | --- | --- |
| React + Vite | PASS | Installer/runtime plus explicit UI approval/apply, real typecheck/build |
| Angular | PASS | Installer/discovery/runtime only |
| Vue | PASS | Installer/discovery/runtime only |
| Express + React/Vite | PASS | Installer/runtime plus explicit UI approval/apply, real typecheck/build |
| Fastify | PASS | Installer/discovery/runtime only |
| Nx React + Node | PASS | Installer/discovery/runtime only |
| Nx Angular + Node | PASS | Installer/discovery/runtime only |
| Frontend-only | PASS | Installer/discovery/runtime only |
| Backend-only | PASS | Installer/discovery/runtime only |
| Full-stack | PASS | Installer/discovery/runtime only |

All ten check packed-only SDK dependencies outside the workspace, hint-only postinstall,
classification, owned files, proposal persistence, unchanged unapproved source, idempotent
init, development Studio/preview, token enforcement and production isolation. React and
Express additionally reject mismatched Origin with a valid token, refuse unapproved apply,
then approve/apply UI with the Studio API and compile/build the result.

Commands: `node tools/verify-packages.mjs --out .packs/installer-final --keep`, then
`node tools/installer-consumer-test.mjs --packs .packs/installer-final --keep`.
The fresh directory avoids older-version tarballs already present in `.packs`.
Consumer evidence is retained locally at
`C:\Users\afoud\AppData\Local\Temp\gix-installer-consumers-TBv3lm\results.json`.

## Fixes Found During Verification

- Created the previously skipped empty `gix/.env.example`; preserved existing files.
- Suppressed UI proposals when no application is selected.
- Prevented an environment option from overriding production isolation.
- Hardened persisted proposals, source targets, symlinks and safe selection.
- Compared structural API contracts and kept same-route pages separate across apps.
- Made React/Next initial render SSR-safe and documented unsafe proxy patch points.
- Installed generated-code imports directly for isolated dependency resolution.
- Created GIX-owned ESM scopes without changing the application's module type.
- Rejected linked manifest/discovery files and redirected parents before side effects;
  replaced metadata atomically rather than truncating linked source/secret targets.
- Fixed consumer Host/Origin handling: Node fetch ignored Host overrides; native HTTP now
  sends a genuine localhost authority. The security guard was not weakened.

Initial validation failures (Studio lint and normalized tool-order expectation) were fixed.
A Windows `EBUSY` docs-output copy failed once; the subsequent docs build passed unchanged.
The first consumer attempt failed React/Express on the harness's Host/Origin mismatch;
both and then all ten passed after the harness correction.

## Unverified And Designed Limits

- Angular/Vue approved UI compilation, Next.js real build/render and browser interaction
  in packed fixtures were not exercised. Detector/runtime passes do not certify these.
- No live model or packed pnpm/yarn/bun matrix ran. Isolated dependency planning has unit
  coverage, but the packed installer fixtures use npm on Node 22.15.0/Windows.
- Native file-symlink creation was denied by Windows (`EPERM`): six metadata cases use
  simulated link stat results, with real hardlink targets where applicable. Hardlink,
  directory-junction and atomic replacement tests use the real filesystem. Concurrent
  adversarial parent-directory swaps were not exercised.
- The server remains a dedicated process, not an Express/Fastify/Nest/Next server merge.
- Next proxy rewrites, Angular inline templates and unrecognized entry points need manual
  integration. Unsupported frontend frameworks get no automatic UI integration.
- Runtime approval/audit stores are in-memory. Persisted Studio approvals require
  reapproval on restart. Package-manager partial failure is not rolled back.
- The owner authorized the coordinated 0.2.4 release. npm publication remains pending
  registry verification; local versions and packed-consumer results do not prove publication.

FINAL STATUS: READY
