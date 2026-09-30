# Universal Existing-Project Installer — Plan

> Brief: the "Universal Existing-Project Installer" prompt (69 sections), received 2026-09-30.
> Progress: [INSTALLER_STATUS.md](INSTALLER_STATUS.md). Post-Phase-12 enhancement, not a phase.
> Builds on the Developer Studio ([ADR 0023](../adr/0023-development-and-application-planes.md)).

## Decisions taken with the owner

1. **Install, then one command.** `npm add @gixcopilot/sdk`, then `npx gix init`. The package's
   `postinstall` only prints that hint. It never edits the repository. Install scripts are not a
   reliable trigger: pnpm 10+ blocks dependency scripts by default, and CI often uses
   `--ignore-scripts`. `init` behaves the same with npm, pnpm, yarn and bun.
2. **Plan, then build**, with packed consumer tests and the brief's §69 completion report.

## Product rule (§2, §68)

> Installation may bootstrap GIX. AI-generated application modifications require developer
> approval.

`gix init` may, without asking:

- detect the project (read-only);
- install the GIX packages each selected application needs, through the project's own package
  manager;
- create **GIX-owned files** that do not exist yet: `gix/server.ts`,
  `gix/.env.example`, private ESM scopes (`gix/package.json`, `.gix/package.json`),
  `.gix/copilot.config.json`, `.gix/manifest.json`;
- run read-only discovery and **generate proposals**.

Everything that edits existing application source (root component, layout, Vite/Angular proxy,
package scripts) is a **proposal**. You review it at `/__gix` and it's applied only after you
approve it.

## What already exists (reused, not rebuilt)

| Brief need | Existing |
| --- | --- |
| Discovery, OpenAPI 3, TS-AST routes/clients/Nest controllers, components, context, auth, permissions | `@gixcopilot/studio` `discoverProject` |
| Proposal → preview/diff → approval → apply → validate | `@gixcopilot/studio` |
| API → tools, security policies, dev/app plane isolation, production isolation | `@gixcopilot/studio` + ADR 0023 |
| Framework/package-manager detection, Vite/Angular proxy patches | `@gixcopilot/create` (patch logic reused in the Studio's UI-integration generator) |
| Copilot server | `@gixcopilot/node` `createCopilot` + `attachStudio` |
| Framework UI and context | `@gixcopilot/react` + `ui`, `@gixcopilot/angular`, `@gixcopilot/vue` |

## New work

### A. Studio discovery (§4-5, §16-22, §29-30)

- **Classification**: `classifyProject()` → `FRONTEND_ONLY | BACKEND_ONLY | FULL_STACK | MONOREPO |
  NX_MONOREPO | MULTI_APP | UNKNOWN`, with each application's role (frontend/backend) and framework.
- **Swagger 2.0** documents (currently only reported) and **Postman v2.x collections**
  (folders, requests, methods, URL variables, query, headers, body, examples) as API sources.
- **Next.js**: app-router pages (`app/**/page.tsx`), route handlers (`app/**/route.ts`, exported
  `GET`/`POST`/…) and pages-router API routes.
- **Normalized operations** (§17, §21): one list across sources, deduplicated by method + path
  (ignoring `/api` and version prefixes and parameter names). Each operation carries its sources,
  a confidence level (`high`/`medium`/`review`), and conflicts. Precedence: OpenAPI 3 > Swagger >
  backend routes > Postman > frontend calls. Conflicting schemas are reported, never merged silently.
- **Page analysis** (§30): route → page component → API calls in that component and in the files
  it imports within the app (one level), → context candidates (route params, entity).

### B. Studio generators (§23-40, §44)

- **API → Tools** switches to the normalized operations. Conflicted and review-level operations
  are proposed but unselected, with a "needs review" warning.
- **Routes → Page Context** (new): `.gix/context/page-context.ts` with global context (user,
  tenant, permissions, locale) and one entry per route (params, entity context, relevant tools),
  plus a framework-neutral `resolvePageContext(pathname)` and `watchPathname()`. Relevance is
  context for the model, **not** a security boundary.
- **UI integration** (new, per selected frontend app): creates a framework-correct component
  (React `CopilotProvider` + `CopilotPopup`; Angular `provideCopilot` + `aicopilot-chat`; Vue
  `provideCopilot` + `CopilotChat`) that publishes page context through the framework's own context
  API. It patches one high-level integration point (React entry, Angular root component, Vue
  `App.vue`) and the dev proxy. Where no safe patch point is found, it gives a manual instruction
  instead of editing.
- **Approve Safe Changes** (§44): a selection that includes read-only tools, non-sensitive
  context, configuration and UI bootstrap, and never destructive, conflicted, review-level or
  permission-less write items.
- Security review: source files outside `.gix/` may be written **only** by the UI-integration
  generator, only for files inside a selected application, and always flagged.

### C. Persistence (§57-60)

- File-backed proposal store (`.gix/proposals/*.json`), so proposals `gix init` generates are
  what `/__gix` shows. Conflict detection already works across processes (hashes).
- `.gix/manifest.json`: SDK version, classification, detected and selected apps, server, UI
  integrations, generated/modified files, API sources, discovery summary. No secrets.

### D. `@gixcopilot/sdk` (§3, §10-13, §57)

- Umbrella package: depends on `node`, `studio`, `provider-openai`, `provider-mock`, `tools`,
  `security`, `openapi`, `context`. Re-exports the server API as `@gixcopilot/sdk/server`, so
  generated code imports from one place. It does not collapse the modular packages.
- `gix` CLI:
  - `gix init [--apps a,b] [--yes] [--skip-install] [--dry-run]`: detect, report, choose apps
    (all frontends when there is only one, otherwise `--apps` or a prompt), install packages per
    app, write GIX-owned files, run discovery, generate proposals, write the manifest, print the
    §41 summary.
  - `gix dev`: start `gix/server.ts` (via `tsx`) with the Studio at `/__gix`.
  - `gix status`: show the manifest vs a fresh discovery (§57, §59).
- **Idempotent**: a second `init` reads the manifest, creates only missing GIX-owned files, and
  adds no duplicate dependencies, proposals or files. Changes become a repair proposal.
- The server always runs as a dedicated GIX server (`gix/server.ts`) that the frontends reach
  through a dev proxy. Integrating into an existing Express or Next.js backend is offered as a
  proposal. Other backends (Fastify, NestJS) use the dedicated server, which is reported.
- Keys: `.env.example` gets `OPENAI_API_KEY=` and `OPENAI_MODEL=` only. Nothing reaches frontend
  configuration.

### E. Tests (§61-65)

- Unit: classification, Swagger 2, Postman, Next.js routes, normalization/dedup/conflicts, page
  analysis, page-context and UI-integration generators, Approve Safe, file store, manifest,
  idempotency, SDK planning.
- **Packed consumer fixtures** (`tools/installer-consumer-test.mjs`): pack every package, then in
  clean directories outside the monorepo run `npm add @gixcopilot/sdk` (tarballs) and
  `npx gix init`. Fixtures: React+Vite, Angular, Vue, Express, Fastify, Nx React+Node, Nx
  Angular+Node, frontend-only, backend-only, full-stack. Per fixture: classification, files,
  proposals, idempotent re-run, server start with `/__gix` 200 and production 404. React+Vite and
  Express also get real framework installs plus a typecheck/build after the UI proposal is applied.
  Any fixture that can't be fully verified is reported as such, never as passing.

### F. Docs (§66)

README Quick Start becomes `npm add @gixcopilot/sdk` then `npx gix init`, with `/__gix` for
review. `npm create @gixcopilot` stays as a documented compatibility path. Guides go in
`docs/installer/`.

## Out of scope

- Publishing: a separate, owner-approved step, as for 0.2.3.
- Generating a new frontend app for backend-only repos. Only on explicit request (§7).
- Merging GIX into an existing Fastify/NestJS server process.
