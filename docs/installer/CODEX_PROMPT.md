# Codex task: finish the GIX Universal Existing-Project Installer

You are continuing work that another agent started in this repository. The work is half
built and **uncommitted**. Finish it, verify it, and stop. Do not publish anything.

## 1. Read first (in this order)

1. `AGENTS.md`, then `CONSTITUTION.md`. Their rules override this prompt.
2. `docs/installer/INSTALLER_PLAN.md`: the agreed design. Two owner decisions are final:
   - `npm add @gixcopilot/sdk`, then `npx gix init`. `postinstall` only prints a hint and never
     edits the repository.
   - Plan, then build, with packed consumer tests and the §69 completion report.
3. `docs/installer/INSTALLER_STATUS.md`: what is done and verified, and what is not.
4. `docs/adr/0023-development-and-application-planes.md` and `docs/developer-studio/`: the
   Studio this builds on.
5. The original brief, if present: `docs/prompts/` (Universal Existing-Project Installer).

Run `git status` first. Everything under `packages/sdk/`, `docs/installer/` and the studio
changes listed in INSTALLER_STATUS.md are yours to finish. Nothing else in the working tree is
unexpected.

## 2. Non-negotiable rules

- **Installation may bootstrap GIX. Changes to existing application source are proposals.**
  `gix init` may create missing GIX-owned files (`gix/server.ts`, `gix/.env.example`, `.gix/*`),
  install packages, run read-only discovery, and generate proposals. It must never edit an
  existing application file directly. Those edits go through Studio proposals
  (preview → approval → apply).
- Development-plane capabilities (`repo.*`, `project.*`, `api.discover`, …) never become
  application tools (ADR 0023). Production registers no Studio and no discovery.
- Model keys are server-only. Generate empty templates only (`OPENAI_API_KEY=`). Never real
  values.
- Destructive tools are never enabled or preselected. Needs-review/conflicted operations are
  never preselected or "safe".
- Reuse existing packages. Do not create a second tool runtime, config store, or security
  system. Do not collapse the modular packages into the SDK.
- A new dependency needs justification (`.claude/skills/dependency-policy`). `tsx@4.23.13` is
  already justified (it's in the lockfile; generated TS imports use `.js` specifiers).
- Never claim a check passed unless you ran it in this session and saw the output. A framework
  whose packed consumer test fails is reported as not supported.
- Match the surrounding code: strict TypeScript, ESM `.js` imports, no `any`, the existing
  comment style (short doc comments citing brief sections like `(§57)`).
- Windows is the dev machine. Spawning package managers uses `shell: process.platform ===
  'win32'` with fixed, allowlisted arguments only (repo convention).

## 3. Remaining work

### 3.1 `@gixcopilot/sdk` tests (`packages/sdk/src/*.spec.ts`)

Build temporary fixtures (copy the pattern of `packages/studio/src/fixtures.spec-helper.ts`;
don't import across packages' `src/`). Use a fake `io.run` that records install steps and
returns 0 (or 1 for the failure test). Cover:

- Classification-driven behavior: Nx React + Fastify (integration only for the React app),
  `client/` + `server/` full-stack, Angular frontend-only, backend-only (no UI proposal, report
  says no frontend), multi-frontend (no apps selected without `--apps`; `prompt` answer respected).
- `planInstalls`: right packages per framework, installed in the app that has its own
  `package.json` (else root), nothing already listed, `-w` for pnpm workspace root,
  `GIX_SDK_TARBALLS` override.
- GIX-owned files are created only when missing. A second `runInit` creates nothing, installs
  nothing already present, and generates no new proposals while earlier ones are pending
  (`--refresh` overrides). The report says "Existing GIX installation detected".
- `--dry-run` writes and installs nothing (snapshot the tree). A failed install writes nothing
  and returns the exit code.
- The manifest has no secrets. `.gix/discovery.json` is written. `runStatus` reports new APIs
  after a route is added.
- `loadGeneratedTools` registers `create*Tools` (with `baseUrl`) and `register*Tools` exports
  from `.gix/tools/`, and skips HTTP tools without a base URL with a logged reason.
- The generated `gix/server.ts` type-checks against `@gixcopilot/sdk/server` (same technique as
  `packages/studio/src/generated-code.spec.ts`).
- `attachStudio` from `@gixcopilot/sdk/server` returns `false` in production without importing
  the Studio.

Fix any bug the tests find in the SDK or Studio code. Don't weaken a test to make it pass.

### 3.2 Packed consumer tests: `tools/installer-consumer-test.mjs`

Follow `tools/consumer-test.mjs` (read it): run outside the monorepo, install **packed
tarballs** (`node tools/verify-packages.mjs --out .packs --keep` first), pass them with npm
`overrides` plus `GIX_SDK_TARBALLS`.

For each fixture: create the source tree, then `npm add @gixcopilot/sdk` (tarball), then
`npx gix init --apps …`. Assert:
- classification;
- created files;
- proposals in `.gix/proposals`;
- a second `gix init` is idempotent;
- `npx gix dev` starts, `/__gix` returns 200 and `/__gix/preview/` returns 200 (Host `localhost`);
- with `NODE_ENV=production`, `/__gix` returns 404 while `/health` returns 200.

Fixtures: React+Vite, Angular, Vue, Node+Express, Node+Fastify, Nx React+Node, Nx Angular+Node,
frontend-only, backend-only, full-stack.

React+Vite and Express also get real framework installs. For those, approve and apply the UI
proposal through the Studio API (token from the `/__gix` page, `Origin` header), then run the
app's typecheck/build. Report per fixture: PASS, FAIL, or "partially verified" with the reason.
Add a `package.json` script only if the repo has a pattern for it.

### 3.3 Docs

- `README.md` Quick Start: `npm add @gixcopilot/sdk`, `npx gix init`, `npx gix dev`, open
  `/__gix`. Keep `npm create @gixcopilot` as a documented compatibility path.
- `packages/sdk/README.md`: public API and **non-responsibilities** (Constitution Article V).
- `docs/installer/README.md`: the flow, classifications, what `init` creates vs proposes,
  idempotency, manifest, limits.
- `docs/VERSIONING.md`: sdk is Experimental. `CHANGELOG.md`: an Unreleased entry.
  `docs/PROJECT_STATUS.md`: a short section.
- Update `docs/installer/INSTALLER_STATUS.md` with real results.

### 3.4 Validation (run all of it, report exact numbers)

```sh
pnpm install --frozen-lockfile        # if the lockfile changed, pnpm install and say so
pnpm validate
npx playwright test                   # stop leftover servers from this repo first if ports are busy
node tools/secret-scan.mjs
node tools/verify-packages.mjs --out .packs --keep
node tools/installer-consumer-test.mjs --packs .packs
node tools/api-reference.mjs && node tools/api-reference.mjs --check
```

Never stop processes that don't belong to this repository.

## 4. Deliverables and stop condition

1. Commit in small conventional commits (see `.claude/skills/git-workflow`), ending each
   message with the repo's attribution line. **Do not push. Do not bump versions. Do not
   publish.**
2. End with the brief's §69 report (PASS/FAIL per line) and `FINAL STATUS: READY / NOT READY`.
   READY only if every mandatory fixture and security test passed. List anything unverified.
3. Stop. Publishing is a separate, owner-approved step.
