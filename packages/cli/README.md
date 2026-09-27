# @gixcopilot/cli

The `aicopilot` command line (**Beta**).

```sh
npx @gixcopilot/cli init my-copilot --template react     # node | react | angular | enterprise
cd my-copilot && npm install && npm run build && npm test
npx aicopilot add tool applications-get                 # typed tool + test, registered in src/tools
npx aicopilot add agent support                         # Phase 10 agent definition + test
npx aicopilot import-openapi ./openapi.yaml --id visa   # every operation DISABLED until you enable it
npx aicopilot add mcp files --url https://mcp.example.com/mcp   # no tools exposed by default
npx aicopilot doctor                                    # Node, config, providers, DB, migrations, Redis, tools, MCP, OpenAPI, telemetry
npx aicopilot eval dist/evals/support.js --json         # Phase 11 evals; exit 1 on gate failure
npx aicopilot db migrate                                # deployment step; rollback needs --yes
```

| Command | Notes |
| --- | --- |
| `init [dir] --template --name --force --dry-run --sdk-version --sdk-path` | Server keeps provider keys; `.env.example` has placeholders only. `--sdk-path` installs local `pnpm pack` tarballs (consumer testing). |
| `add tool <ns-action>` | `applications-get` becomes tool `applications.get`, read-only until you reclassify it |
| `add agent <name>` | Agent limited to the tools it lists; every call still passes the firewall |
| `add mcp <id> --url \| --command`, `mcp list` | Writes `aicopilot.mcp.json`; credentials belong in the server environment |
| `import-openapi <file> --id` | Writes `aicopilot.openapi.<id>.json` with `"expose": false` everywhere and a registration module |
| `dev`, `test` | Validate configuration, then run your own scripts; framework tooling (Vite, Angular CLI, Nx) is untouched |
| `eval <suite.js> --json --baseline --out` | Suite exports `{ dataset, target, evaluators?, gates? }` |
| `doctor --json --skip-migrations` | Secret values are never printed; exit 1 when a check fails |
| `db status\|migrate\|rollback --yes` | Uses the reviewed migrations of `@gixcopilot/persistence-postgres` |

Safety: existing files are never overwritten without `--force`; destructive commands need
`--yes`; commands never prompt, so CI and interactive use behave the same. Every command has
`--help` with examples.
