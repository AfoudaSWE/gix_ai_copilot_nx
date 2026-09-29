# ADR 0023: Development plane and application plane

- Status: Accepted
- Date: 2026-09-30

## Context

The Developer Studio (`/__gix`) needs capabilities that read the repository, detect frameworks,
discover APIs and write generated files. These are powerful and must never reach the
application's end users. Separately, the Studio *produces* application capabilities (tools,
context, generative UI, agents, skills, knowledge) that end users will use once a developer
approves them. Without a named boundary, a repository tool could be registered as a copilot tool,
or a generator could write to the repository without review.

## Decision

1. **Two planes.** The *development plane* helps a developer integrate GIX and runs only in the
   Studio, in development. The *application plane* is what the application's users interact
   with. They share the core runtime and the Action Firewall, but not authority.
2. **Development capabilities are not tools.** `repo.*`, `project.*`, `api.discover`,
   `ui.discoverComponents`, `auth.discover` and the other development capabilities are plain
   functions inside `@gixcopilot/studio`, catalogued with `plane: 'development'`. They are never
   `ToolDefinition`s. The namespaces `repo`, `shell`, `git`, `project`, `code`, `validate`,
   `studio` and `devtools` are reserved: `assertApplicationPlane()` rejects an application tool
   registry that uses them, the security review blocks a proposal that names a tool in them, and
   post-apply validation re-checks it.
3. **Development agents and skills are not application agents and skills.** Their ids are
   reserved in the same way.
4. **Production has no development plane.** `studioPlugin`/`registerStudio` register nothing
   when `NODE_ENV=production`, so `/__gix` and `/__gix/api/*` return 404. There is no override:
   exposing development capabilities in production would need its own design.
5. **Generate and apply are separate by construction.** Discovery and generators receive a
   `ReadonlyWorkspace`, a type with no write method. An ESLint rule forbids them from importing
   the apply engine, `fs` or `child_process`. Only the apply engine writes, only for a proposal in
   the `approved` state, and only after re-running the security review, a workspace-path guard, a
   secret scan and conflict detection.
6. **Generated application code is ordinary code.** Generators emit `.gix/*` files that use the
   existing packages (`defineTool`, `registerOpenAPI`, `createFetchHttpExecutor`,
   `ContextRegistry`, `GenerativeComponentDefinition`, `defineAgent`, `fileSource`,
   `ToolSecurityManifest`). The application imports them explicitly. There is no generated-tool
   runtime, and nothing is auto-registered.

## Consequences

- One new package, `@gixcopilot/studio` (`scope:studio`, `platform:server`), which may depend on
  protocol, security, tools, openapi, provider and core. Nothing in the application plane depends
  on it.
- The Studio needs `typescript` (an optional peer) for AST discovery. Without it, discovery
  reports `AST_UNAVAILABLE` rather than pretending it analyzed source.
- A tool that legitimately belongs in a reserved namespace, such as a business `project.*` API,
  is generated as `app.project.*`.
