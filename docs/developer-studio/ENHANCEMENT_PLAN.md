# Developer Studio Enhancement — Plan

> Source brief: [docs/prompts/developer_studio_Prompt.md](../prompts/developer_studio_Prompt.md)
> (90 sections). Created 2026-09-29. This is post-Phase-12 enhancement work, not a new
> phase: all 12 phases are complete (see [PROJECT_STATUS](../PROJECT_STATUS.md)). Progress is
> tracked in [ENHANCEMENT_STATUS.md](ENHANCEMENT_STATUS.md).
>
> Product principle: **AI proposes. The developer decides.** Nothing in discovery or
> generation writes to the consumer repository. Only the apply engine writes, and only
> after an explicit approval.

## 1. What exists and what is reused

| Need (prompt §)                          | Existing asset reused                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| OpenAPI parsing (§17, §36)               | `@gixcopilot/openapi`: `createOpenAPILoader`, `resolveLocalRefs`, `discoverOperations`, `deriveToolName` |
| Risk → approval mapping (§34)            | `@gixcopilot/security`: `createDefaultRiskPolicy` (read-only→none, write→user-confirmation, destructive→admin) |
| Generated tools (§35)                    | `@gixcopilot/tools` `defineTool` + `ToolSecurityManifest` (protocol): generated code is ordinary tool code |
| Generated policies (§39)                 | `@gixcopilot/security` `definePolicy` / `RolePermissionMap`: no Studio-only security system              |
| Generated context (§37)                  | `@gixcopilot/context` `ContextRegistry.register`                                                         |
| Generated UI (§38)                       | `@gixcopilot/generative-ui` `GenerativeComponentDefinition` (name, description, Zod props)               |
| Framework/package-manager detection (§14)| `@gixcopilot/create`'s `detectProject` logic, generalized into detectors                                 |
| Pure plan vs. execution split (§66)      | `@gixcopilot/create`'s `planProject` (pure) vs `run` pattern                                            |
| Production refusal (§6)                  | `@gixcopilot/devtools/server` plugin pattern (`NODE_ENV=production` → refuse)                            |
| Test connection (§9)                     | `@gixcopilot/provider` `ModelRuntime.stream`: the existing provider adapter, never a browser call       |
| DevTools (§80)                           | Linked from the Studio, not re-implemented                                                              |

## 2. Architecture

### 2.1 New package: `@gixcopilot/studio`

One new server-side, development-only package. Nx tags: `scope:studio`, `type:lib`,
`platform:server`. Allowed dependencies: `protocol`, `security`, `openapi`, `tools`,
`provider` (type-level only). Nothing in the application plane depends on it.

```text
packages/studio/src/
  planes.ts             Plane type, development capability catalog, application-plane guard
  workspace/            path guard (traversal, symlink escape, home/.ssh/system), secret-path
                        rules, bounded + cancellable + ignore-aware file walker, read-only view
  discovery/            detectors + project/api/component/context/auth/permission/knowledge
                        discovery -> one normalized DiscoveredProject; rescan comparison
  diagnostics.ts        lifecycle-aware health model (before/after discovery, generation, apply)
  proposals/            ChangeProposal model, state machine, store, selection + edit validation
  generators/           Generator contract + 8 generators (API, OpenAPI, context, UI,
                        policies, agents, skills, knowledge) and risk heuristics
  apply/                diff, secret scan, conflict detection, transactional apply engine,
                        post-apply validation (detected project commands, no shell)
  server/               Fastify plugin: /__gix page + /__gix/api/* (dev only)
```

### 2.2 The two planes (§1–4) — ADR 0023

- **Development plane**: `repo.*`, `project.*`, `api.*`, `ui.*`, `context.discover`,
  `auth.*`, `permission.*`, `config.inspect`, `diagnostics.*` plus development agents and
  skills. They are plain functions inside `@gixcopilot/studio`, catalogued with
  `plane: 'development'`. They are **never** `ToolDefinition`s in an application
  `ToolRegistry`.
- **Application plane**: the tools, context, UI, agents, skills and knowledge the
  application's users see. These come only from explicit application code, including code
  the Studio generated and a developer approved.
- **Guard**: `assertApplicationPlane(registry)` rejects any application tool whose name uses a
  reserved development namespace. The Studio plugin runs it against the host's registry at
  startup, and tests prove development capabilities never reach the application manifest.

### 2.3 Generate/apply separation is structural (§53, §65–66)

- Generators receive a `ReadonlyWorkspace`. The type has no write method, so a generator
  cannot write files even by mistake.
- Only `createApplyEngine` holds a `WorkspaceWriter`, and it accepts only a proposal in
  `approved` state together with a selection.
- Proposal states: `draft → ready-for-review → approved → applied | failed`, with
  `rejected` reachable from review. Any other transition throws. A second apply of the same
  proposal is refused.

### 2.4 Apply pipeline (§53–60)

```text
approved proposal + selection
  → re-validate edits (security floor: destructive stays disabled unless re-enabled, an
    approval level can never drop below the risk policy's level)
  → workspace guard on every path
  → secret scan of every generated file (block)
  → conflict check: current file hash == hash recorded at generation (else STOP that file)
  → stage all writes, back up originals, commit; roll back on write failure
  → post-apply validation with detected commands (typecheck/lint/test/build from
    package.json scripts and the detected package manager; spawned without a shell)
  → APPLY COMPLETE, or APPLIED WITH VALIDATION ERRORS (never claims success on failure)
```

Generated application files go under `.gix/` (`.gix/tools/*.ts`, `.gix/security/*.ts`,
`.gix/context/*.ts`, `.gix/ui/*.ts`, `.gix/agents/*.ts`, `.gix/skills/*.md`,
`.gix/knowledge/sources.json`). The host application imports them explicitly. Nothing is
auto-registered.

### 2.5 Development API (§6, §67–68)

`createStudioPlugin(options)` registers `/__gix` (HTML) and `/__gix/api/*`:

- Refuses to register when `NODE_ENV=production`, so both routes return 404. There is no
  override: production exposure would need a separately designed feature (§4).
- Every request checks the `Host` header and `Origin` against an allowlist (default: the
  loopback origin the server listens on). A mutation (POST) also needs a per-process CSRF
  token that the Studio page embeds. localhost alone is not trusted (§68).
- The API key is write-only: `GET /config/model` returns `{ provider, model, configured }`
  and never the key. Resolved config is shown with secret values redacted (§63).
- Test Connection runs through the existing `ModelRuntime` and returns only
  `{ success, provider, model, latencyMs, error? }`, with the error normalized (§9).

### 2.6 Studio UI (§5, §7, §69–71, §79)

- **Iteration 1 (this plan, M5)**: a self-contained, accessible page served by the plugin
  (no build step). It covers Overview, Configuration (model + test connection, copilot,
  security view, appearance values), Discovery, Generators, Review (proposal, per-file diff,
  selective approval, edit, reject, approve, apply), Diagnostics as a persistent side panel,
  a DevTools link, and a Ctrl/Cmd+K command palette. It uses the GIX palette (charcoal,
  black, steel gray, white, GIX red).
- **Iteration 2 (M8, deferred)**: a React Studio app that embeds the real `@gixcopilot/ui`
  `CopilotChat` as the live appearance preview (§7 forbids a fake preview). Until then the
  appearance section edits values and does **not** claim a live preview.

## 3. Milestones

| #  | Milestone                                                                                 | Prompt §                 |
| -- | ----------------------------------------------------------------------------------------- | ------------------------ |
| M0 | Plan, status, ADR 0023 (two planes), DECISIONS index                                      | 1–4, 83                  |
| M1 | Package scaffold, Nx tags + module boundaries, workspace guard, secret rules, safe walker | 24, 54                   |
| M2 | Discovery: detectors, project, APIs (OpenAPI + TS AST routes/clients), components, context, auth, permissions, knowledge, normalized model, rescan | 12–24, 61 |
| M3 | Diagnostics lifecycle model                                                               | 25–29, 78                |
| M4 | Proposals, generator contract, 8 generators, risk heuristics, edit validation             | 30–45, 47–52, 64–65      |
| M5 | Apply engine: diff, secret scan, conflicts, transactional apply, post-validation          | 53–60, 66                |
| M6 | Studio server plugin + development API + page UI + plane guard + test connection          | 5–11, 46, 62–63, 67–71   |
| M7 | Documentation `docs/developer-studio/*`, README facts, package README                     | 82–84                    |
| M8 | React Studio app with real `@gixcopilot/ui` live preview + Playwright E2E                 | 7, 79, 87 (E2E)          |
| M9 | `createCopilot({ studio })` wiring + example app                                          | 85–86 boundary           |

Out of scope (§85, §90): `npx gixcopilot init` changes, publishing, and consumer install
changes. Those belong to the next task.

## 4. Decisions

1. **One new package, not many.** The Studio is one cohesive development-time control plane.
   Splitting discovery, generators and apply into separate published packages would add
   release surface without any consumer that needs them independently.
2. **AST via the consumer's own `typescript`.** API/component/permission discovery parses
   TS/TSX with the TypeScript compiler API, loaded with a dynamic `import('typescript')`
   (optional peer dependency). If it is missing, discovery falls back to file-level
   heuristics and reports a diagnostic. It never pretends AST analysis ran. No new parser
   dependency is added (dependency policy).
3. **No AI in the default generators.** The eight generators are deterministic. An
   AI-assisted generator can implement the same `Generator` contract later and is bound by
   the same proposal → approval → apply path (§31, "no exceptions").
4. **The API key lives in server memory for the dev session only.** It is used for Test
   Connection and never written to generated source or returned to the browser. Persisting
   it stays the developer's job (`.env`), because writing secrets to disk from a web UI
   conflicts with §55.
5. **Appearance and Copilot settings are proposals.** Saving them creates a `ConfigChange`
   proposal against `.gix/copilot.config.json`, which goes through the same review/apply path.
   No second config store is written silently (§63).

## 5. Test plan (§72–78)

- Planes: dev plane is available in development and refused in production (404 for
  `/__gix` and `/__gix/api/*`). Repo tools never appear in the application tool manifest.
  Development agents and skills are not application ones.
- Discovery fixtures: Nx + React + Fastify, Angular, Vue, plain Node/Express, and a NestJS
  controller. Also secret exclusion, ignored paths, bounds, cancellation, and a check that
  the repository is byte-identical after discovery.
- Generators: each generator's analyze → generate → validate works, and `generate()`
  leaves the repository unchanged (hash of every file before and after).
- Approval: generated → unchanged; rejected → unchanged; partial selection → only selected
  files written; approved → applied; duplicate apply refused.
- Security: path traversal, absolute and home paths blocked; secret files unreadable;
  secret-bearing output blocked; cross-origin and CSRF-less mutations blocked; destructive
  tools disabled by default; an edit cannot lower approval below the risk floor.
- Conflicts: file edited after generation → apply stops that file, no overwrite.
- Diagnostics: correct at every lifecycle point, including after a validation failure.
- Gate: `pnpm validate` (lint, typecheck, test, build across the workspace).
