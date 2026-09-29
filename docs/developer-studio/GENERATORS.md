# Generators

Generators turn discovery data into proposals. They never write to the repository.

## Contract

```ts
interface Generator<TAnalysis> {
  id: string;
  analyze(context: GeneratorContext, input: GeneratorInput): Promise<TAnalysis>;
  generate(analysis: TAnalysis, context: GeneratorContext): Promise<GeneratedDraft>; // items only
  render(items: ProposalItems, context): Promise<RenderedFile[]>;                    // deterministic
  validate(items: ProposalItems): ProposalWarning[];
}
```

`GeneratorContext` holds a `ReadonlyWorkspace` and the discovery result, and nothing that can
write. `render` runs again after every edit, so the diff always shows exactly what apply would
write. A test type-checks every generated file against the real SDK packages.

## Built-in generators

| Id | Output (under `.gix/`) | Built on |
| --- | --- | --- |
| `api-tools` (API → Tools) | `tools/<source>.ts`, `security/<source>.security.ts` | `defineTool`, `createFetchHttpExecutor` |
| `openapi-tools` (OpenAPI → Tools) | `tools/<source>.openapi.ts`, `security/<source>.security.ts` | `registerOpenAPI` with an explicit `include` allowlist |
| `state-context` (State → Context) | `context/application-context.ts` | `ContextRegistry.register` |
| `components-ui` (Components → Generative UI) | `ui/generative-components.ts` | `GenerativeComponentDefinition` + Zod props |
| `auth-security` (Auth → Security Policies) | `security/permissions.ts`, `security/route-policies.ts` | `RolePermissionMap`, `ToolSecurityManifest` |
| `project-agents` (Project → Agents) | `agents/<id>.ts` | `defineAgent` (application plane) |
| `project-skills` (Project → Skills) | `skills/<id>.md` | Markdown instructions for application agents |
| `docs-knowledge` (Docs → Knowledge) | `knowledge/sources.ts` | `fileSource`/`pdfSource`/`docxSource`; nothing preselected, nothing indexed |
| `studio-configuration` | `copilot.config.json` | Copilot and Appearance settings |

### API → Tools

```text
Discovered APIs → select operations → schemas → auth → permissions → risk
               → tool candidates → policy candidates → preview
```

| Method | Suggested risk | Default approval (Action Firewall policy) |
| --- | --- | --- |
| GET | read-only | none |
| POST, PUT, PATCH | write | user-confirmation |
| DELETE | destructive | admin; **disabled and unselected by default** |

The method is only a heuristic. Risk, permission, approval, name, description, enablement and
agent are editable before approval. Permissions are matched to discovered ones
(`GET /applications` → `APPLICATION_VIEW`); an invented name is flagged. Names follow
`resource.verb` (`applications.list`, `applications.get`, `applications.assign`).

Generated tools use the SDK's SSRF-safe executor: a trusted `baseUrl` from your configuration,
escaped path values, a pinned origin and bounded responses. Every call still passes through the
Action Firewall. OpenAPI operations not listed in `include` are never exposed.

### Project → Agents and Skills

These recommend **application-plane** agents (for example `application-assistant`) and skills
(for example `application-search`), one group per API domain with at least two operations.
Destructive tools are not assigned. Development agent and skill ids are rejected.

## Sync Copilot

`POST /__gix/api/sync` runs Re-scan → Compare → Recommend → Preview. It produces proposals for new
or changed APIs, components and context. It never writes.
