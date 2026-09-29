# Discovery

Discovery is **read-only**: `Repository → Discovery → Normalized model → Report`. It reads through
`ReadonlyWorkspace`, which has no write method. A test proves the repository is byte-identical
after discovery.

## Safety

- Stays inside the workspace root; symbolic links are never followed.
- Skips `node_modules`, `.git`, build output (`dist`, `build`, `out`, `.next`, `coverage`, ...)
  and paths matched by the root `.gitignore` (plain names, `*`, `**`, `?`, anchors; no `!`).
- Never reads secret files: `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`,
  `id_ed25519`, `credentials.*`, `secrets.*`, `.npmrc`, `.netrc`.
- Bounded: 20,000 files and 512 KiB per file by default. Hitting a bound yields a diagnostic.
- Cancellable with an `AbortSignal`.

## Project (`POST /__gix/api/discovery/project`)

Workspace kind (Nx, pnpm/npm workspaces, single), package manager (lockfile first), language,
applications and libraries (Nx `project.json` or workspace packages), frameworks with evidence,
routes, tests, build tooling, detected `typecheck`/`lint`/`test`/`build` scripts, and existing
GIX packages and config.

Detectors are adapters (`ProjectDetector`): Nx, React, Angular, Vue, Next.js, Vite, Node.js,
Fastify, Express, NestJS and TypeScript, with JavaScript as the fallback. Pass `detectors` to add
more.

## APIs

- **OpenAPI 3.x** files, read with `@gixcopilot/openapi`: method, path, operationId, summary,
  input schema (path/query params and body), success output schema, security schemes, and
  `x-permissions`/`x-required-permissions`. Swagger 2.0 is reported, not parsed.
- **Backend routes** via the TypeScript AST: Fastify/Express-style `app.get('/x', handler)`,
  `fastify.route({ method, url })` and NestJS `@Controller`/`@Get` decorators. Authentication
  is inferred from guards and pre-handlers; permissions from permission-shaped identifiers in the
  route.
- **Frontend clients**: `fetch`, axios-style clients and Angular `HttpClient`, including
  template-literal paths (`/applications/${id}` → `/applications/{id}`).

## Components

React function components (TSX), Angular `@Component` classes (`@Input()` and `input()`), and Vue
SFCs (`defineProps`). A component is a generative-UI **candidate** when it is exported, isn't a
layout/page/provider, and takes only data props (no callbacks or `children`). Discovery
recommends; it never registers.

## Context

Candidates for `currentUser`, route, tenant, permissions, selected/current entities and state
containers (React contexts, Pinia, Redux slices, Zustand, NgRx), found from hooks, variables, class
members and `ActivatedRoute` injection. Discover ≠ register.

## Authentication and permissions

Mechanisms and libraries (Passport, JWT libraries, Auth.js, Auth0, MSAL, Keycloak, Firebase,
Supabase, Clerk, sessions), auth-related files, token-handling facts (for example "Token kept in
localStorage"), and the user model type. Values are never captured.

Permissions come from permission-named enums, objects and union types, `UPPER_SNAKE_VERB`
constants, and route-level references. They become candidates for generated policies and are not
trusted automatically.

## Knowledge

README files, root Markdown, `docs/**` Markdown/MDX/PDF/DOCX/TXT, and discovered OpenAPI documents.
Nothing is indexed.

## Re-scan (`POST /__gix/api/discovery/rescan`)

Compares the previous discovery with the current repository: new, changed and removed APIs; new
and changed components; new permissions; new context candidates.
