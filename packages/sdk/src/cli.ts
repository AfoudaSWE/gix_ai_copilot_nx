import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { runDev, runInstall, runStatus } from './commands.js';
import { runInit } from './init.js';
import { SDK_VERSION } from './plan.js';

const HELP = `gix ${SDK_VERSION}: add GIX Copilot to an existing project

Usage:
  gix init [--apps a,b] [--skip-install] [--dry-run] [--refresh]
      Detect the project, install what each app needs, create GIX-owned files (gix/server.ts,
      .gix/), run read-only discovery and prepare proposals. Changes to your existing code are
      proposals you review and approve at /__gix. Safe to run again.
  gix dev      Start the GIX server (gix/server.ts) with the Developer Studio at /__gix.
  gix status   Show the installation and what changed since the last discovery.

Options: --help, --version`;

export async function run(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      apps: { type: 'string' },
      'skip-install': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      refresh: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  const io = { cwd: process.cwd(), env: process.env, out: (line: string) => console.log(line), err: (line: string) => console.error(line) };
  if (values.version) {
    io.out(SDK_VERSION);
    return 0;
  }
  const [command] = positionals;
  if (values.help || !command) {
    io.out(HELP);
    return values.help ? 0 : 1;
  }
  try {
    switch (command) {
      case 'init': {
        const readline = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
        try {
          const result = await runInit(
            { ...io, run: runInstall, ...(readline ? { prompt: (question: string) => readline.question(question) } : {}) },
            {
              ...(values.apps ? { apps: values.apps.split(',').map((entry) => entry.trim()).filter(Boolean) } : {}),
              install: values['skip-install'] !== true,
              dryRun: values['dry-run'] === true,
              refresh: values.refresh === true,
            },
          );
          return result.exitCode;
        } finally {
          readline?.close();
        }
      }
      case 'dev':
        return await runDev(io);
      case 'status':
        return await runStatus(io);
      default:
        io.err(`Unknown command "${command}".\n\n${HELP}`);
        return 1;
    }
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
