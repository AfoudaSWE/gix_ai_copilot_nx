# Universal Existing-Project Installer

**Experimental, unreleased and not published to npm.** This post-Phase-12 enhancement
builds on the [Developer Studio](../developer-studio/README.md), not a new phase. The
[plan](INSTALLER_PLAN.md) describes intent; this guide describes current source behavior.
The owner maintains final verification evidence in [INSTALLER_STATUS.md](INSTALLER_STATUS.md).
Detection and generation are not proof that a framework's packed consumer passes.

## Flow

The intended release workflow below requires a future published SDK or locally packed
packages today. Run at the repository root containing `package.json`:

```sh
npm add @gixcopilot/sdk
npx gix init
npx gix dev
```

Open `http://localhost:4000/__gix`:

```text
Install -> Init -> Discover -> Propose -> Preview/Diff -> Select -> Approve -> Apply -> Validate
```

Installing the package only prints a hint, never initializes the repository. `init` uses
read-only discovery, plans missing dependencies with the detected npm/pnpm/yarn/bun manager,
creates missing GIX-owned bootstrap files and persists proposals. Installing dependencies
can update `package.json` and lockfiles through the package manager; this is distinct from
editing application source. Frontend packages go in the selected app's own `package.json`
when present, otherwise the root (including typical Nx layouts).

The published compatibility path remains `npm create @gixcopilot@latest`; see
[Getting started](../guides/getting-started.md). It is a separate installer, not the new
proposal-first `gix init` flow.

## Classifications

Applications have `frontend`, `backend`, `full-stack` or `unknown` roles with detected
framework evidence. Repository classification follows this precedence:

| Classification | Meaning |
| --- | --- |
| `NX_MONOREPO` | Nx workspace, regardless of app count |
| `MONOREPO` | npm/pnpm workspace containing multiple applications |
| `MULTI_APP` | More than one frontend or more than one backend outside the above cases |
| `FULL_STACK` | A full-stack app (including Next.js), or both frontend and backend apps |
| `FRONTEND_ONLY` | Frontend detected without a backend |
| `BACKEND_ONLY` | Backend detected without a frontend; no UI or page-context scaffold |
| `UNKNOWN` | Insufficient framework evidence; not permission to invent an app |

UI generation targets React, Next.js, Angular and Vue; backend discovery includes Node,
Express, Fastify and NestJS. One supported frontend is selected by default. With multiple
frontends, choose interactively or use `npx gix init --apps apps/web,apps/admin` (paths or
names). Without a selection in a noninteractive run, none are selected. Previous manifest
selection is reused when `--apps` is omitted. Check reported selections before applying.
Other frontend frameworks receive no automatic UI integration.

## Created vs Proposed

| Created by `init` | Handling |
| --- | --- |
| `gix/server.ts` | Dedicated GIX server; create only if missing, never overwrite |
| `gix/package.json`, `.gix/package.json` | Private ESM scopes for generated code, including in CommonJS applications; create only if missing |
| `gix/.env.example` | Empty server-only key/model/API URL template and default port; create only if missing |
| `.gix/.gitignore` | Ignore local `proposals/` and `discovery.json`; create only if missing |
| `.gix/copilot.config.json` | Initial copilot name; create only if missing |
| `.gix/manifest.json` | Installation inventory, rewritten after a successful non-dry-run init |
| `.gix/discovery.json` | Fresh discovery snapshot, rewritten for subsequent status comparisons |
| `.gix/proposals/*.json` | Local proposal state, consumed by the same Studio opened with `gix dev` |

Proposed, not immediately applied: frontend copilot components, page-context resolvers,
root component/layout integration, development proxy edits, API tool modules and security
policies. Only the app-integration generator can propose writes outside `.gix/`, scoped to
the selected app and flagged as application-source changes. Unsupported patch points yield
manual instructions. Package scripts are not directly added by the current `init`.

Discovery combines OpenAPI 3, Swagger 2, Postman v2 collections, backend routes, Next.js
route handlers and frontend calls into normalized operations. Deduplication uses method and
normalized path; precedence is OpenAPI 3, Swagger, backend routes, Postman, frontend calls.
Conflicting schemas are reported rather than silently merged. Conflicted/review-level
operations are unselected; destructive tools start disabled and unselected. **Approve Safe
Changes** is a selection aid, not an authorization bypass. Inspect warnings, permissions
and diffs before approval. See [review/apply](../developer-studio/PROPOSALS_AND_APPLY.md).

## Re-runs and Status

- `npx gix init --dry-run` discovers and reports without installing or writing anything.
- `npx gix init --skip-install` writes bootstrap/proposal state but prints the skipped
  install commands; run them before attempting `gix dev`.
- Existing bootstrap files are kept. Dependencies already declared in dependencies or
  devDependencies are not added again; this is not version reconciliation.
- Pending installer proposals in `draft` or `ready-for-review` are reused instead of
  generating another batch. `--refresh` overrides this. Once no pending installer proposal
  remains, a re-run can generate fresh proposals; idempotency does not mean no new proposal
  forever or byte-identical metadata (timestamps and snapshots are refreshed).
- Persisted Studio proposals that were approved require review and explicit reapproval
  after a Studio restart. Disk content is not trusted evidence of approval: restored
  proposals return to review, and approval rebuilds the preview and reruns validation and
  security checks before Apply is allowed.
- A failed package install returns its exit code before bootstrap/proposal/manifest writes.
  Earlier package-manager steps may already have changed dependency files; no install
  rollback is promised.
- `npx gix status` performs fresh read-only discovery and compares it with the saved
  snapshot, reporting new/changed/removed APIs and other candidates. It does not apply
  changes; use Studio Sync Copilot to review them.

## Manifest

`.gix/manifest.json` records SDK source version and timestamps, workspace/package manager/
classification, detected and selected apps, dedicated-server file and port, selected UI
integration proposal references, generated/proposed-modified paths, API sources and counts,
discovery summary and proposal ids. It contains no model keys or credentials.

The inventory is not proof of approval or application: `modifiedFiles` lists proposed edits,
and `uiIntegrations` references selected proposal entries. Check persisted proposals and
apply results for actual outcome. Server port `4000` is bootstrap metadata; runtime
`GIX_PORT` can override it. `parseManifest` performs only minimal shape checks, not a full
schema migration or validation service.

## Server and Security

`gix dev` runs the dedicated `gix/server.ts` using `tsx` and loads a root `.env` if present.
The template reads server-only `OPENAI_API_KEY`, `OPENAI_MODEL`, `GIX_API_BASE_URL` and
`GIX_PORT` (default 4000). Without an API key it uses the deterministic mock provider.
Keep real values only in private server configuration, exclude `.env` from version control,
and never copy them into frontend configuration, generated proposals or the manifest.

The server loads applied modules from `.gix/tools` on startup. Set a trusted
`GIX_API_BASE_URL` for HTTP `create*Tools` exports; otherwise they are skipped with a reason.
Restart after applying tool modules. The loader imports ordinary executable code, not
sandboxed model output: review generated files and configure authentication, identity,
permissions and policies before exposing consequential actions. The generated server wires
the existing Action Firewall and an in-memory audit sink, not production security storage.

Studio is development-only. With `NODE_ENV=production`, SDK `attachStudio` returns false
without importing the Studio; `/__gix` is not registered. Discovery capabilities such as
`repo.*`, `project.*` and `api.discover` never become application tools. Page-context tool
relevance is a model hint, never an authorization boundary. See
[ADR 0023](../adr/0023-development-and-application-planes.md) and
[Studio security](../developer-studio/SECURITY.md) for Host/Origin/token checks, workspace
guards, secret scanning and firewall enforcement.

## Limits and Evidence

- The server strategy is always a dedicated process, not an in-place Express, Fastify,
  NestJS or Next.js server merge. Backend-only repositories do not get a new UI.
- Next.js proxy rewrites are a manual step. Angular inline templates and root entries
  without recognized React/Angular/Next.js/Vue insertion points can require manual work.
- Discovery is bounded and heuristic. TypeScript is needed for AST analysis; missing
  evidence or diagnostics must be reviewed rather than treated as an empty API surface.
- Vue SFC output needs `vue-tsc` in a real consumer; Angular integration needs a real
  Angular consumer. No framework is declared supported solely because its detector exists.
- `GIX_SDK_TARBALLS` is a JSON package-name-to-spec map for packed consumer tests, not a
  production configuration option or a registry-release claim.
- This documentation update does not certify consumer fixtures, browser checks, live
  providers, package publication or installer readiness. The owner-maintained
  [status](INSTALLER_STATUS.md) holds final evidence; the [handoff](CODEX_PROMPT.md) lists
  required validation. See the [SDK README](../../packages/sdk/README.md) for public APIs.
