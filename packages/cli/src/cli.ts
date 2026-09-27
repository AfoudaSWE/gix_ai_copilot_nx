import { parseArgs } from 'node:util';
import { addAgent, addMcp, addTool, db, dev, doctor, evalCommand, importOpenApi, init, listMcp, test } from './commands.js';
import type { CliIo, Flags } from './commands.js';

export const VERSION = '0.1.0';

const HELP: Readonly<Record<string, string>> = {
  main: `aicopilot ${VERSION} — AI Copilot SDK command line

Usage: aicopilot <command> [options]

Commands:
  init [dir]                 Create a copilot project (templates: node, react, angular, enterprise)
  add tool <ns-action>       Add a typed tool with tests (e.g. applications-get)
  add agent <name>           Add an agent definition with tests
  add mcp <id>               Configure an MCP server (no tools exposed by default)
  mcp list                   List configured MCP servers
  import-openapi <file>      Import an OpenAPI document (all operations disabled)
  dev                        Validate configuration, then run your dev script
  test                       Run your tests with the test environment
  eval <suite.js>            Run an evaluation suite (CI gates, --json output)
  doctor                     Check Node, configuration, providers, database, Redis, migrations, tools, MCP, OpenAPI, telemetry
  db <status|migrate|rollback>  Database migrations (rollback requires --yes)

Global options: --help, --version
Nothing is ever overwritten without --force; nothing destructive runs without --yes.
Commands never prompt, so they behave the same in CI.`,
  init: `Usage: aicopilot init [dir] [--template node|react|angular|enterprise] [--name <pkg>] [--force] [--dry-run]

Creates a project with a copilot server (provider keys stay server-side), config, .env.example,
tests and, for react/angular, a web app. Existing files are never overwritten without --force.

Examples:
  aicopilot init my-copilot
  aicopilot init web --template react
  aicopilot init portal --template angular --name visa-portal
  aicopilot init secure --template enterprise`,
  add: `Usage: aicopilot add <tool|agent|mcp> <name> [options]

Examples:
  aicopilot add tool applications-get        # -> tool "applications.get" (read-only by default)
  aicopilot add tool payments-refund --dir src/tools
  aicopilot add agent support
  aicopilot add mcp files --url https://mcp.example.com/mcp
  aicopilot add mcp local-fs --command "node ./mcp-server.js"`,
  mcp: `Usage: aicopilot mcp list
       aicopilot add mcp <id> (--url <https://...> | --command "<cmd args>") [--force]

MCP tools are denied by default; expose them by listing names in aicopilot.mcp.json "include".
They still pass the Action Firewall.`,
  'import-openapi': `Usage: aicopilot import-openapi <openapi.yaml|json> [--id <integration-id>] [--force]

Writes aicopilot.openapi.<id>.json (every operation "expose": false) and a registration module.
Operations are never exposed automatically. Enable the ones the copilot may call.

Example:
  aicopilot import-openapi ./openapi.yaml --id visa-api`,
  dev: `Usage: aicopilot dev [-- <args for your dev script>]

Validates aicopilot.config.json + environment, then runs "npm run dev". It does not replace your
framework tooling (Vite, Angular CLI, Nx).`,
  test: `Usage: aicopilot test [-- <args for your test script>]

Runs "npm run test" with AICOPILOT_ENV=test and NODE_ENV=test.`,
  eval: `Usage: aicopilot eval <suite.js> [--json] [--baseline <run.json>] [--out <run.json>]

The suite module exports { dataset, target, evaluators?, gates?, repetitions? } (Phase 11 evals).
Exit code 1 when a gate fails. Security hard gates cannot be averaged away.

Examples:
  aicopilot eval dist/evals/support.js
  aicopilot eval dist/evals/support.js --json --out eval-run.json --baseline baseline.json`,
  doctor: `Usage: aicopilot doctor [--json] [--skip-migrations]

Checks Node, configuration, model providers, database (and migrations), Redis, tool risk
classification, OpenAPI and MCP configuration, and telemetry. Secret values are never printed.
Exit code 1 when a check fails.`,
  db: `Usage: aicopilot db <status|migrate|rollback --yes>

  status     list applied/pending migrations
  migrate    apply pending migrations (a deployment step; servers never migrate at startup)
  rollback   revert the last migration using its reviewed .down.sql (destructive; needs --yes)`,
};

export function defaultIo(): CliIo {
  return {
    cwd: process.cwd(),
    env: process.env,
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  };
}

/** Runs the CLI and returns the exit code (no `process.exit` here, so it is testable). */
export async function run(argv: readonly string[], io: CliIo = defaultIo()): Promise<number> {
  const separator = argv.indexOf('--');
  const own = separator === -1 ? [...argv] : argv.slice(0, separator);
  const passthrough = separator === -1 ? [] : argv.slice(separator + 1);
  let parsed: { values: Flags; positionals: string[] };
  try {
    parsed = parseArgs({
      args: own,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        force: { type: 'boolean' },
        yes: { type: 'boolean', short: 'y' },
        json: { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        'skip-migrations': { type: 'boolean' },
        template: { type: 'string', short: 't' },
        name: { type: 'string' },
        dir: { type: 'string' },
        id: { type: 'string' },
        url: { type: 'string' },
        command: { type: 'string' },
        baseline: { type: 'string' },
        out: { type: 'string' },
        'sdk-version': { type: 'string' },
        'sdk-path': { type: 'string' },
      },
    });
  } catch (error) {
    io.err(`${(error as Error).message}\nRun "aicopilot --help" for usage.`);
    return 2;
  }
  const { values, positionals } = parsed;
  const [command, ...rest] = positionals;
  if (values['version'] === true) {
    io.out(VERSION);
    return 0;
  }
  const help = (topic: string): number => {
    io.out(HELP[topic] ?? HELP['main'] ?? '');
    return 0;
  };
  if (!command) return help('main');
  if (values['help'] === true) return help(command === 'add' || command === 'mcp' ? command : command);
  try {
    switch (command) {
      case 'init':
        return await init(io, rest, values);
      case 'add': {
        const [kind, name] = rest;
        if (kind === 'tool') return await addTool(io, name, values);
        if (kind === 'agent') return await addAgent(io, name, values);
        if (kind === 'mcp') return await addMcp(io, name, values);
        io.err(HELP['add'] ?? '');
        return 2;
      }
      case 'mcp':
        if (rest[0] === 'list') return await listMcp(io);
        if (rest[0] === 'configure' || rest[0] === 'add') return await addMcp(io, rest[1], values);
        io.err(HELP['mcp'] ?? '');
        return 2;
      case 'import-openapi':
        return await importOpenApi(io, rest[0], values);
      case 'dev':
        return await dev(io, passthrough);
      case 'test':
        return await test(io, passthrough);
      case 'eval':
        return await evalCommand(io, rest[0], values);
      case 'doctor':
        return await doctor(io, values);
      case 'db':
        return await db(io, rest[0], values);
      case 'help':
        return help(rest[0] ?? 'main');
      default:
        io.err(`Unknown command "${command}".\n\n${HELP['main'] ?? ''}`);
        return 2;
    }
  } catch (error) {
    io.err(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
