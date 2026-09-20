# Phase 8 handoff

Use the [completion record](Phase_8_Status.md), [test evidence](Phase_8_Testing.md), [API](Phase_8_API.md) and [limits](Phase_8_Issues.md).

## Run from the workspace root

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @gixcopilot/example-openapi test
pnpm --filter @gixcopilot/example-mcp test
```

For interactive real-model demos, copy the chosen example's `.env.example` to `.env` and supply `OPENAI_API_KEY` / `OPENAI_MODEL` locally. Never commit `.env`.

```powershell
pnpm --filter @gixcopilot/example-openapi demo "What is the status of APP-1001?"
pnpm --filter @gixcopilot/example-openapi demo "Assign APP-1001 to officer OFF-B"
pnpm --filter @gixcopilot/example-mcp demo "Describe widget WID-1"
```

The write demo waits for a terminal y/N confirmation. The demo identity/tokens and local data are test fixtures; production hosts replace authentication, data policy and persistence. No real production API data is mutated.

Explicit real-provider validation from an example directory:

```powershell
$env:RUN_OPENAI_SMOKE='1'
node --env-file=.env ../../node_modules/vitest/vitest.mjs run src/openai-smoke.spec.ts
Remove-Item Env:RUN_OPENAI_SMOKE
```

Normal tests do not require provider credentials. Benchmark from the root after building:

```powershell
node examples/openapi/dist/benchmark.js
```

## Migrate an earlier Phase 8 draft

Supply `include` or reviewed `operations` entries to OpenAPI generation/registration. Omission now generates zero tools. Keep DELETE explicitly governed. Configure the server's Action Firewall; external tools now fail closed without it. Do not rely on raw upstream errors in model-visible messages. Use normalized codes and reports. For custom MCP clients, implement optional state subscription or dispose on disconnect.

## Troubleshooting

- Zero generated tools: inspect document/connection issues, selection, denied/unsupported counts and conflicts.
- Pending approval: the host needs a configured approval store and an eligible actor; do not weaken tool permissions to make a demo run.
- MCP unavailable: check the process command/server endpoint; errors intentionally omit raw secret-bearing transport text.
- Unsupported schema: adapt the specification to the documented subset, exclude the operation, or provide a separately authored canonical tool.
- HTTP redirects: configure the final trusted endpoint; redirects are deliberately refused.
- Real test skipped: both `RUN_OPENAI_SMOKE=1` and the API key must be set in the test process.

No commit, deployment or publication was requested. Stop here; Phase 9 requires explicit user instruction.
