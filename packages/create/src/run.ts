import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { FRAMEWORKS, PACKAGE_MANAGERS, detectProject } from './detect.js';
import type { Framework, PackageManager } from './detect.js';
import { VERSION, newProjectStep, planProject } from './plan.js';
import type { Plan, Step } from './plan.js';
import { defaultsPrompter, terminalPrompter } from './prompt.js';
import type { Prompter } from './prompt.js';

export type CommandStep = Extract<Step, { kind: 'command' }>;

export interface Io {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Ask questions (a TTY); false answers everything with defaults. */
  readonly interactive: boolean;
  out(line: string): void;
  err(line: string): void;
  /** Runs a command step and resolves with its exit code. */
  exec(step: CommandStep): Promise<number>;
  prompter?: Prompter;
}

export const HELP = `@gixcopilot/create ${VERSION}: add an AI copilot to a React, Vue or Angular app, with a Node copilot server.

Usage:
  npm create @gixcopilot@latest [dir] [-- options]
  npx @gixcopilot/create [dir] [options]

Run it inside an existing app to add the copilot there, or give a new directory to create an app.
It asks a few questions; --yes accepts every default.

Options:
  --framework <react|vue|angular|none>  Frontend to integrate (default: detected)
  --server / --no-server                 Add a Node copilot server (default: yes)
  --server-dir <dir>                     Where the server goes (default: copilot-server)
  --pm <npm|pnpm|yarn|bun>               Package manager (default: detected)
  --skip-install                         Write files only; install dependencies yourself
  --dry-run                              Show what would happen and change nothing
  -y, --yes                              Accept all defaults, never prompt
  -h, --help, -v, --version

Existing files are never overwritten. The model API key lives only in the server's .env.`;

const FRAMEWORK_LABEL: Readonly<Record<Framework, string>> = { react: 'React', vue: 'Vue', angular: 'Angular' };

/** Runs commands through the platform shell so npm/npx .cmd shims resolve on Windows. */
export function spawnStep(step: CommandStep): Promise<number> {
  return new Promise((resolveExit) => {
    const child = spawn(step.command, [...step.args], {
      cwd: step.cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, ...step.env },
    });
    child.on('error', () => resolveExit(1));
    child.on('close', (code) => resolveExit(code ?? 1));
  });
}

export function defaultIo(): Io {
  return {
    cwd: process.cwd(),
    env: process.env,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    exec: spawnStep,
  };
}

async function execute(steps: readonly Step[], io: Io, dryRun: boolean, root: string): Promise<boolean> {
  const show = (path: string): string => relative(root, path).replaceAll('\\', '/') || path;
  for (const step of steps) {
    if (dryRun) {
      io.out(`  • ${step.label}${step.kind === 'command' ? `\n      $ ${step.command} ${step.args.join(' ')}` : ''}`);
      continue;
    }
    io.out(`\n▶ ${step.label}`);
    switch (step.kind) {
      case 'command': {
        const code = await io.exec(step);
        if (code !== 0) {
          io.err(`✖ Failed (exit ${code}): ${step.command} ${step.args.join(' ')}`);
          return false;
        }
        break;
      }
      case 'write':
        if (existsSync(step.path)) {
          io.out(`  ${show(step.path)} already exists; kept yours.`);
          break;
        }
        await mkdir(dirname(step.path), { recursive: true });
        await writeFile(step.path, step.content, 'utf8');
        break;
      case 'copy':
        if (existsSync(step.to) || !existsSync(step.from)) break;
        await copyFile(step.from, step.to);
        break;
      case 'patch': {
        if (!existsSync(step.path)) {
          io.out(`  Skipped: ${show(step.path)} not found. ${step.manual}`);
          break;
        }
        const result = step.apply(await readFile(step.path, 'utf8'));
        if (result.changed) await writeFile(step.path, result.content, 'utf8');
        else io.out(`  Skipped (${result.reason}). ${step.manual}`);
        break;
      }
    }
  }
  return true;
}

function printPlan(plan: Plan, io: Io, heading: string): void {
  io.out(`\n${heading}`);
  for (const step of plan.steps) io.out(`  • ${step.label}`);
}

function printNext(next: readonly string[], io: Io): void {
  if (next.length === 0) return;
  io.out('\nNext steps:');
  next.forEach((line, index) => io.out(`  ${index + 1}. ${line}`));
}

function parse(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      framework: { type: 'string' },
      server: { type: 'boolean' },
      'no-server': { type: 'boolean' },
      'server-dir': { type: 'string' },
      pm: { type: 'string' },
      'skip-install': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
}

/** The installer. Returns the process exit code. */
export async function main(argv: readonly string[], io: Io = defaultIo()): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    io.err(`${(error as Error).message}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.out(HELP);
    return 0;
  }
  if (values.version) {
    io.out(VERSION);
    return 0;
  }
  const frameworkFlag = values.framework;
  if (frameworkFlag !== undefined && frameworkFlag !== 'none' && !FRAMEWORKS.includes(frameworkFlag as Framework)) {
    io.err(`Unknown framework "${frameworkFlag}". Use react, vue, angular or none.`);
    return 2;
  }
  if (values.pm !== undefined && !PACKAGE_MANAGERS.includes(values.pm as PackageManager)) {
    io.err(`Unknown package manager "${values.pm}". Use npm, pnpm, yarn or bun.`);
    return 2;
  }
  const dryRun = values['dry-run'] === true;
  const install = values['skip-install'] !== true;
  const ask: Prompter = values.yes || !io.interactive ? defaultsPrompter : (io.prompter ?? terminalPrompter());

  try {
    io.out(`\n◆ gixcopilot: AI copilot installer ${VERSION}${dryRun ? ' (dry run, nothing will change)' : ''}`);
    let target = resolve(io.cwd, positionals[0] ?? '.');
    let project = detectProject(target, io.env['npm_config_user_agent']);
    let framework: Framework | undefined;
    let frameworkDecided = false;

    // 1. No app here: create one first, then add the copilot to it.
    if (!project.exists) {
      const initialKind = frameworkFlag === 'none' ? 'node' : ((frameworkFlag as Framework | undefined) ?? 'react');
      const kind = frameworkFlag
        ? initialKind
        : await ask.select<Framework | 'node'>(
            'No app found here. What should I create?',
            [
              { value: 'react', label: 'React app (Vite) + copilot server' },
              { value: 'vue', label: 'Vue app (Vite) + copilot server' },
              { value: 'angular', label: 'Angular app + copilot server' },
              { value: 'node', label: 'Copilot server only (Node)' },
            ],
            initialKind,
          );
      const name = positionals[0] ? basename(target) : await ask.text('Project name', 'my-copilot-app');
      target = resolve(io.cwd, positionals[0] ?? name);
      const parent = dirname(target);
      const pm = (values.pm as PackageManager | undefined) ?? project.packageManager;
      if (kind === 'node') {
        const steps: Step[] = [newProjectStep('node', basename(target), parent), { kind: 'copy', label: 'Create .env (add OPENAI_API_KEY there)', from: join(target, '.env.example'), to: join(target, '.env') }];
        if (install) steps.push({ kind: 'command', label: 'Install dependencies', cwd: target, command: pm, args: ['install'] });
        printPlan({ steps, next: [] }, io, 'Plan:');
        if (!(await execute(steps, io, dryRun, target))) return 1;
        printNext([`cd ${basename(target)}`, `${pm === 'npm' ? 'npm run' : pm} dev   (copilot server on http://127.0.0.1:4000)`, 'Real answers: put OPENAI_API_KEY in .env'], io);
        return 0;
      }
      if (!(await execute([newProjectStep(kind, basename(target), parent)], io, dryRun, parent))) return 1;
      framework = kind;
      frameworkDecided = true;
      project = dryRun
        ? { root: target, exists: true, name: basename(target), framework: kind, packageManager: pm, typescript: true, next: false, viteConfig: kind === 'angular' ? undefined : 'vite.config.ts', angularJson: kind === 'angular', srcDir: 'src' }
        : detectProject(target, io.env['npm_config_user_agent']);
    }

    // 2. Which frontend.
    if (!frameworkDecided) {
      if (frameworkFlag) framework = frameworkFlag === 'none' ? undefined : (frameworkFlag as Framework);
      else if (project.framework && (await ask.confirm(`Detected ${FRAMEWORK_LABEL[project.framework]} in ${project.name}. Add the ${FRAMEWORK_LABEL[project.framework]} copilot?`, true))) framework = project.framework;
      else {
        const picked = await ask.select<Framework | 'none'>(
          'Which frontend should get the copilot chat?',
          [
            { value: 'react', label: 'React' },
            { value: 'vue', label: 'Vue' },
            { value: 'angular', label: 'Angular' },
            { value: 'none', label: 'None (server only)' },
          ],
          project.framework ?? 'none',
        );
        framework = picked === 'none' ? undefined : picked;
      }
    }

    // 3. The Node copilot server (on by default).
    let server = values['no-server'] ? false : values.server ? true : await ask.confirm('Add a Node copilot server (recommended; keeps the model key off the browser)?', true);
    let serverDir = values['server-dir'] ?? 'copilot-server';
    if (server && !values['server-dir']) serverDir = await ask.text('Server folder', serverDir);
    if (server && existsSync(join(project.root, serverDir, 'package.json'))) {
      io.out(`  ${serverDir}/ already has a package.json; keeping it and skipping server creation.`);
      server = false;
    }
    if (!framework && !server) {
      io.out('Nothing to do: no frontend selected and no server to add.');
      return 0;
    }
    const packageManager = (values.pm as PackageManager | undefined) ?? project.packageManager;

    const plan = planProject(project, { framework, server, serverDir, packageManager, install });
    printPlan(plan, io, `Plan for ${project.root}:`);
    if (!dryRun && !(await ask.confirm('Continue?', true))) {
      io.out('Cancelled. Nothing was changed.');
      return 0;
    }
    if (!(await execute(plan.steps, io, dryRun, project.root))) return 1;
    io.out(dryRun ? '\nDry run complete. Nothing was changed.' : '\n✔ Copilot added.');
    printNext(plan.next, io);
    return 0;
  } finally {
    ask.close();
  }
}
