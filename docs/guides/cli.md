# CLI (`aicopilot`)

```sh
npx @gixcopilot/cli <command> [options]      # or install @gixcopilot/cli and run `aicopilot`
```

| Command | Flags | Notes |
| --- | --- | --- |
| `init [dir]` | `--template node\|react\|angular\|enterprise`, `--name`, `--force`, `--dry-run`, `--sdk-version`, `--sdk-path` | Never overwrites without `--force`; `.env.example` placeholders only |
| `add tool <ns-action>` | `--dir`, `--force` | `applications-get` becomes `applications.get`, read-only until reclassified; test included |
| `add agent <name>` | `--dir`, `--force` | Agent definition + test, registered in `src/agents/index.ts` |
| `add mcp <id>` | `--url` or `--command`, `--force` | Writes `aicopilot.mcp.json`; exposes no tools |
| `mcp list` | | Configured servers and exposed tool counts |
| `add api <id>` | `--url`, `--dir`, `--force` | Writes `apis/<id>.api.yaml`, a manifest for [any HTTP/GraphQL API](connectors.md) |
| `api check <manifest>` | `--json` | Validates a manifest without calling the API; lists tools, risk, method/path, permissions |
| `mcp serve <manifest>` | `--http`, `--port`, `--token-env`, `--allow-writes` | Serves an API's tools as an MCP server (stdio or HTTP on 127.0.0.1); read-only unless `--allow-writes`; firewall + audit |
| `import-openapi <file>` | `--id`, `--force` | All operations `"expose": false`; registration module generated |
| `dev` | `-- <args>` | Validates configuration, then runs your `dev` script |
| `test` | `-- <args>` | Runs your `test` script with `AICOPILOT_ENV=test` |
| `eval <suite.js>` | `--json`, `--baseline`, `--out` | Exit 1 when a gate (incl. security) fails |
| `doctor` | `--json`, `--skip-migrations` | Node, npm, configuration, providers, database, migrations, Redis, tool risk, OpenAPI, MCP, telemetry; never prints secret values |
| `db status\|migrate\|rollback` | `--yes` (rollback) | Reviewed migrations; rollback is destructive and refuses without `--yes` |

Every command supports `--help` with examples and `--version`. Commands never prompt, so
behavior is identical in CI. Exit codes: 0 success, 1 failure, 2 usage error. Generated
projects need npm 11+ or pnpm (npm 10.9 cannot install Vitest's dependency tree).
