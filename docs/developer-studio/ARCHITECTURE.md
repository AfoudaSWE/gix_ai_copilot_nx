# Developer Studio architecture

## Package

`@gixcopilot/studio` is one server-side, development-only package (`scope:studio`,
`platform:server`). It may depend on `protocol`, `security`, `tools`, `openapi`, `provider` and
`core`. Nothing in the application plane depends on it.

```text
packages/studio/src/
  planes.ts           development capability catalog, reserved namespaces, assertApplicationPlane
  workspace/          WorkspaceGuard (path safety) and ReadonlyWorkspace (bounded, ignore-aware, no writes)
  discovery/          detectors, TS-AST source analyzer, OpenAPI reading, discoverProject, re-scan
  generators/         Generator contract, risk heuristics, 9 generators, pipeline (analyze → review)
  proposals/          ChangeProposal model, edits, security review, state machine and store
  apply/              apply engine, secret scan, unified diff
  configuration/      model settings (write-only key, Test Connection), Copilot/Appearance schema, redaction
  diagnostics.ts      lifecycle-aware health model
  service.ts          createStudioService: the transport-independent core
  server/             Fastify plugin: /__gix page, /__gix/preview/, /__gix/api/*; registerStudio, attachStudio
packages/studio-preview/  private React bundle of the real @gixcopilot/ui, copied into studio's dist/preview
examples/studio/          createCopilot + attachStudio, with a sample app to discover
```

## Layers

```text
Browser (/__gix page)
   │  same-origin fetch + per-process token
   ▼
studioPlugin (HTTP guard, validation, error mapping)
   ▼
StudioService ── discovery ── ReadonlyWorkspace ── repository (read)
   │         └── generators ── proposals (in memory)
   └── ApplyEngine ── WorkspaceGuard ── repository (write, approved proposals only)
```

Every guarantee lives in the service or below it, so it holds for any transport and is tested
without HTTP.

## The generate/apply boundary

- Discovery and generators receive a `ReadonlyWorkspace`. The type has no write method.
- ESLint forbids `packages/studio/src/{discovery,generators}/**` from importing `apply/*`, `fs`
  or `child_process`.
- `ApplyEngine.apply` accepts only a proposal in the `approved` state. It re-runs the security
  review, resolves every path through the `WorkspaceGuard`, scans for secrets and checks
  conflicts before it writes anything.

## Generator pipeline

```text
DISCOVER → ANALYZE → RECOMMEND → GENERATE PROPOSAL → VALIDATE PROPOSAL → SECURITY REVIEW
        → PREVIEW → DIFF → DEVELOPER APPROVAL → APPLY → VALIDATE RESULT
```

`runGenerator` covers analyze through security review. The Studio UI covers preview, diff and
approval. The apply engine covers apply and validation. AI-assisted generators, when added, use
the same `Generator` contract and path.

## Reuse

| Need | Existing package |
| --- | --- |
| OpenAPI parsing and tool registration | `@gixcopilot/openapi` (`discoverOperations`, `registerOpenAPI`, `createFetchHttpExecutor`) |
| Risk → approval | `@gixcopilot/security` `createDefaultRiskPolicy` |
| Tool naming rules | `@gixcopilot/tools` `isValidToolName` |
| Test Connection | `@gixcopilot/provider` `ModelRuntime` with the host's provider adapter |
| DevTools | Linked from the Studio, not re-implemented |

See [ADR 0023](../adr/0023-development-and-application-planes.md).
