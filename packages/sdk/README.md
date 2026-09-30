# @gixcopilot/sdk
Experimental. 0.2.4 coordinated release candidate; npm publication pending registry verification. Not for production.

An umbrella installer and server entry point for adding GIX to an existing project. It
composes the modular Node SDK, Developer Studio, providers, tool registry and Action
Firewall rather than replacing them. Requires Node.js >=22.12.0. TypeScript is an optional
peer for AST discovery; `init` plans its installation when missing.

## Install and use

This is the 0.2.4 release-candidate flow, **not a verified npm install yet**. Until npm
publication is verified, evaluate locally packed packages and their workspace dependencies;
see the [installer status](../../docs/installer/INSTALLER_STATUS.md) for evidence and limits.

```sh
npm add @gixcopilot/sdk@0.2.4
npx gix init
npx gix dev
```

Run from an existing project root containing `package.json`, then open
`http://localhost:4000/__gix`. Review, approve and apply proposals there. `postinstall`
only prints the `init` hint and never edits the project. The published compatibility path
is `npm create @gixcopilot@latest`.

## CLI

| Command | Behavior |
| --- | --- |
| `gix init` | Read-only discovery and classification, package installs, missing GIX-owned bootstrap files, persisted proposals and manifest |
| `gix init --apps apps/web,apps/admin` | Select frontends by detected path or name; one supported frontend defaults to selected, multiple require a choice or interactive prompt |
| `gix init --dry-run` | Discover and report without writing files or installing packages |
| `gix init --skip-install` | Skip installs and print required commands; still write bootstrap files and proposals |
| `gix init --refresh` | Generate fresh proposals even while earlier installer proposals are pending |
| `gix dev` | Run `gix/server.ts` through `tsx`; load root `.env` when present; default `NODE_ENV` to development |
| `gix status` | Compare fresh discovery with `.gix/discovery.json` and report installation details |
| `gix --help`, `gix --version` | Print help or the package's source version |

There is no `--yes` option in the current CLI. The SDK is included in the coordinated
0.2.4 release candidate; its version field alone is not evidence of npm publication.

`init` plans direct root dependencies for the server and the tools/policies its generators
emit: `@gixcopilot/sdk`, `@gixcopilot/openapi`, `@gixcopilot/tools`,
`@gixcopilot/protocol`, `@gixcopilot/security` and `zod`, plus development-only TypeScript
when missing. These are existing workspace libraries, not new SDK runtime dependencies.
Direct installation is necessary because generated project files cannot rely on the SDK's
transitive dependencies being hoisted (particularly with pnpm). Already-listed packages
are not installed again; Angular's root `zod` requirement is deduplicated. An Angular app
with its own manifest still gets its own direct dependency.

The other, optional Studio generators may emit imports from `@gixcopilot/context`,
`@gixcopilot/generative-ui`, `@gixcopilot/agents` or `@gixcopilot/knowledge`. They are not
run by `init`; install the corresponding packages directly before compiling or loading
those optional modules.

Missing `gix/package.json` and `.gix/package.json` files are created with `private: true`
and `type: "module"`. These GIX-owned boundaries let the generated server and approved
modules use ESM, including top-level await, in CommonJS projects or projects without a
`type` field. The existing application's module type is never changed, and existing GIX
manifests are never overwritten.

## Public API

The package root is the installer/programmatic CLI surface:

| Export | Contract |
| --- | --- |
| `runInit(io, options?)` | Returns `Promise<InitResult>` with exit code, classification, selected apps, install steps, created/kept files, new/reused proposals and optional manifest |
| `InitIo` | Project `cwd`, environment, output/error callbacks, optional prompt, and asynchronous package-manager `run(step, cwd)` callback |
| `InitOptions` | Optional `apps`, `install` (default true), `dryRun` and `refresh` |
| `INIT_GENERATORS` | Installer generator ids: app integration, OpenAPI tools, API tools and auth/security |
| `planInstalls({ workspace, project, apps, env })` | Returns missing-package `InstallStep[]` grouped by directory; no installs performed |
| `InstallStep`, `UI_PACKAGES`, `SDK_VERSION` | Install plan type, frontend dependency mapping and source version |
| `MANIFEST_FILE`, `GixManifest`, `parseManifest(text)` | Manifest path/type and minimal parser; returns `undefined` for missing/invalid JSON or absent basic fields, not comprehensive schema validation |
| `runDev(io, env?)`, `runInstall(step, cwd)`, `runStatus(io)` | Command helpers returning numeric exit codes asynchronously |
| `run(argv)` | CLI dispatcher returning `Promise<number>` |

`@gixcopilot/sdk/server` is server-only:

- Re-exports `createCopilot`, types `Copilot`/`CreateCopilotOptions`,
  `createMockProvider`, `createOpenAIProvider`, `createActionFirewall`,
  `createInMemoryAuditSink`, `createStaticAuthenticationAdapter`, `createToolRegistry` and
  `defineTool` from their existing packages.
- `attachStudio(copilot, { root, environment? }): Promise<boolean>` lazily attaches the
  development Studio. Returns `false` in production before importing the Studio.
- `loadGeneratedTools(registry, options): Promise<LoadedTools>` imports top-level `.ts`,
  `.js` and `.mjs` files in `<root>/.gix/tools` (excluding `.d.ts`). Calls exported
  `register*Tools(registry, { baseUrl? })` and `create*Tools({ baseUrl })` functions.
- `LoadGeneratedToolsOptions` contains `root`, optional trusted `baseUrl` and `log` callback.
  HTTP `create*Tools` exports are skipped without a base URL, with a reason in `skipped` and
  an optional log message. `LoadedTools` contains newly `registered` names and `skipped`
  file/reason entries. Loading definitions does not execute business actions or configure
  a firewall; the host must configure security.

Minimal server example (use `tsx` for TypeScript):

```ts
import {
  attachStudio,
  createActionFirewall,
  createCopilot,
  createInMemoryAuditSink,
  createMockProvider,
} from '@gixcopilot/sdk/server';

const copilot = createCopilot({
  model: { provider: 'mock', model: 'development' },
  providers: [createMockProvider({ id: 'mock', scenario: { chunks: ['Hello.'] } })],
  security: { firewall: createActionFirewall({ audit: createInMemoryAuditSink() }) },
});
await attachStudio(copilot, { root: process.cwd() });
await copilot.listen({ port: 4000 });
```

## Non-responsibilities

- No replacement runtime, security system, configuration store or framework SDK. Use the
  underlying packages for their full APIs.
- No direct edits to existing application source during `init`. UI integration, page
  context, API tools and policy changes are Studio proposals, not automatic authorization.
- No new frontend scaffold for backend-only projects and no merging into an existing
  backend process. The current installer starts a dedicated GIX server.
- No repository discovery tools in the application catalog, no production Studio and
  no browser model keys. Application tools still require trusted identity, permissions and
  the Action Firewall; page-context relevance is not permission.
- No production authentication/persistence setup or framework-support guarantee from
  detection alone. Generated modules are ordinary executable code: review before applying
  and loading them, and restart the server after applying tools.

The generated server uses in-memory approval and audit stores. Restarting it discards and
invalidates pending runtime Action Firewall approvals and clears its in-memory audit trail;
old approval ids cannot be resumed or approved after restart. Start a fresh run and request
approval again. This is separate from Studio change proposals, which `init` persists under
`.gix/proposals/`. Configure durable stores through the underlying SDK for durable runtime
approval/audit requirements.

See the [installer guide](../../docs/installer/README.md) for files, idempotency, manifest
semantics and known limits, and the owner-maintained
[installer status](../../docs/installer/INSTALLER_STATUS.md) for validation evidence. These
examples describe the source API; they are not a claim of executed consumer tests.
