# Development plane vs application plane

This is a formal architectural rule ([ADR 0023](../adr/0023-development-and-application-planes.md)).

```text
DEVELOPMENT PLANE                    APPLICATION PLANE
/__gix, development only             The copilot your users talk to
  project / API / component /          business tools, context, agents,
  context / auth discovery             skills, generative UI, knowledge
  generators, preview, diagnostics
          │                                    ▲
          │ discovers / analyzes / proposes    │ approved generated integration
          └────────────► APPLICATION ──────────┘
                    shared GIX core runtime + Action Firewall
```

They share infrastructure but not authority.

## Development plane

- Tools: `repo.getInfo`, `repo.getTree`, `repo.listFiles`, `repo.readFile`, `repo.search`,
  `repo.findFile`, `project.*`, `api.discover`, `api.listOperations`, `api.inspectOperation`,
  `ui.discoverComponents`, `context.discover`, `auth.discover`, `permission.discover`,
  `config.inspect`, `diagnostics.get`.
- Agents: `project-discovery`, `repo-explorer`, `api-explorer`, `tool-builder`,
  `context-analyzer`, `ui-analyzer`, `security-analyzer`.
- Skills: `repository-understanding`, `project-discovery`, `api-discovery`, `api-analysis`,
  `api-to-tool-generation`, `openapi-to-tool-generation`, `context-discovery`,
  `generative-ui-discovery`, `permission-analysis`, `tool-security-review`.

These are implemented as plain functions and catalog entries (`DEVELOPMENT_CAPABILITIES`,
`GET /__gix/api/capabilities`). They are never `ToolDefinition`s.

> The development agents and skills are catalogued names for the Studio's internal
> capabilities. The current Studio runs its discovery and generators deterministically; it does
> not yet send development tools to a model. When it does, only the relevant tool subset per
> request may be sent (§46).

## Application plane

Application capabilities come only from explicit application code, including `.gix/*` files the
Studio generated and a developer approved and imported.

## Enforcement

| Where | What |
| --- | --- |
| `assertApplicationPlane(registry)` | Throws `PlaneViolationError` when an application tool uses a reserved namespace (`repo`, `shell`, `git`, `project`, `code`, `validate`, `studio`, `devtools`) or a development tool name |
| Tool naming in generators | A discovered `/project/...` API becomes `app.project.*` |
| Security review | Blocks proposals naming a development tool, agent or skill, or assigning a development tool to an agent |
| Post-apply validation | The `integration` check re-runs the plane check on applied tools |
| Production | The Studio registers nothing; `/__gix` and `/__gix/api/*` are 404 |
