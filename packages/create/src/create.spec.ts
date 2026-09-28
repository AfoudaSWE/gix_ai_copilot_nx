import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectProject, main, patchAngularJson, patchScripts, patchViteConfig, planProject } from './index.js';
import type { CommandStep, Io, Prompter } from './index.js';

async function app(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gixcopilot-create-'));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

const pkg = (deps: Record<string, string>, name = 'shop'): string => `${JSON.stringify({ name, scripts: { dev: 'vite' }, dependencies: deps }, null, 2)}\n`;
const VITE = `import { defineConfig } from 'vite';\nimport vue from '@vitejs/plugin-vue';\n\nexport default defineConfig({\n  plugins: [vue()],\n});\n`;

function io(cwd: string, options: { prompter?: Prompter; interactive?: boolean; fail?: string } = {}) {
  const out: string[] = [];
  const commands: CommandStep[] = [];
  const value: Io = {
    cwd,
    env: {},
    interactive: options.interactive ?? false,
    prompter: options.prompter,
    out: (line) => out.push(line),
    err: (line) => out.push(line),
    exec: async (step) => {
      commands.push(step);
      if (options.fail && step.args.includes(options.fail)) return 1;
      // Simulate what the CLI's `init` writes for the server.
      if (step.args.includes('init')) {
        const dir = join(step.cwd, step.args[step.args.indexOf('init') + 1] ?? '');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, '.env.example'), 'OPENAI_API_KEY=\n');
        await writeFile(join(dir, 'package.json'), '{}\n');
      }
      return 0;
    },
  };
  return { io: value, out, commands, text: () => out.join('\n') };
}

describe('detectProject', () => {
  it('detects framework, package manager, TypeScript and Vite', async () => {
    const root = await app({ 'package.json': pkg({ vue: '^3.5.0' }), 'pnpm-lock.yaml': '', 'vite.config.ts': VITE, 'tsconfig.json': '{}', 'src/main.ts': '' });
    expect(detectProject(root)).toMatchObject({ exists: true, name: 'shop', framework: 'vue', packageManager: 'pnpm', typescript: true, viteConfig: 'vite.config.ts', srcDir: 'src' });
    const angular = await app({ 'package.json': pkg({ '@angular/core': '^21.0.0', react: '19' }), 'angular.json': '{}' });
    expect(detectProject(angular)).toMatchObject({ framework: 'angular', angularJson: true, packageManager: 'npm' });
    expect(detectProject(await app({}), 'yarn/4.0.0 npm/? node/v22')).toMatchObject({ exists: false, packageManager: 'yarn' });
  });
});

describe('patches', () => {
  it('adds the Vite proxy once and refuses configs it cannot safely edit', () => {
    const patched = patchViteConfig(VITE);
    expect(patched.changed).toBe(true);
    if (!patched.changed) return;
    expect(patched.content).toContain("'/api/copilot': { target: 'http://127.0.0.1:4000'");
    expect(patched.content).toContain('plugins: [vue()]');
    expect(patchViteConfig(patched.content)).toEqual({ changed: false, reason: 'already configured' });
    expect(patchViteConfig(`export default defineConfig({ server: { port: 3000 } });`).changed).toBe(false);
    expect(patchViteConfig('export default {}').changed).toBe(false);
  });

  it('points ng serve at the proxy without replacing an existing one', () => {
    const workspace = { projects: { web: { projectType: 'application', architect: { serve: { builder: 'x' } } }, lib: { projectType: 'library', architect: {} } } };
    const patched = patchAngularJson(JSON.stringify(workspace));
    expect(patched.changed && JSON.parse(patched.content)).toMatchObject({ projects: { web: { architect: { serve: { options: { proxyConfig: 'proxy.conf.json' } } } } } });
    if (patched.changed) expect(patchAngularJson(patched.content).changed).toBe(false);
  });

  it('adds scripts without replacing existing ones', () => {
    const patched = patchScripts(pkg({}), { 'copilot:server': 'npm --prefix copilot-server run dev', dev: 'other' });
    expect(patched.changed && (JSON.parse(patched.content) as { scripts: unknown }).scripts).toEqual({ dev: 'vite', 'copilot:server': 'npm --prefix copilot-server run dev' });
  });
});

describe('planProject', () => {
  it('installs the right packages per framework and adds the server by default', async () => {
    const expected = { react: ['@gixcopilot/react', '@gixcopilot/ui'], vue: ['@gixcopilot/vue'], angular: ['@gixcopilot/angular', 'zod'] } as const;
    for (const framework of ['react', 'vue', 'angular'] as const) {
      const root = await app({ 'package.json': pkg({}) });
      const plan = planProject(detectProject(root), { framework, server: true, serverDir: 'copilot-server', packageManager: 'npm', install: true });
      const commands = plan.steps.filter((step) => step.kind === 'command');
      expect(commands[0]).toMatchObject({ command: 'npm', args: ['install', ...expected[framework]] });
      expect(commands.some((step) => step.args.join(' ').includes('@gixcopilot/cli@0.1.1 init copilot-server --template node'))).toBe(true);
      expect(plan.next[0]).toContain('copilot:server');
    }
  });

  it('uses the project package manager and skips installs when asked', async () => {
    const root = await app({ 'package.json': pkg({ react: '19' }) });
    const plan = planProject(detectProject(root), { framework: 'react', server: true, serverDir: 'ai', packageManager: 'pnpm', install: true });
    expect(plan.steps.find((step) => step.kind === 'command')).toMatchObject({ command: 'pnpm', args: ['add', '@gixcopilot/react', '@gixcopilot/ui'] });
    expect(plan.steps.some((step) => step.kind === 'command' && step.args.includes('--ignore-workspace'))).toBe(true);
    const noInstall = planProject(detectProject(root), { framework: 'react', server: false, serverDir: 'ai', packageManager: 'npm', install: false });
    expect(noInstall.steps.filter((step) => step.kind === 'command')).toHaveLength(0);
  });
});

describe('main', () => {
  it('has --help and --version and rejects bad flags', async () => {
    const help = io(process.cwd());
    expect(await main(['--help'], help.io)).toBe(0);
    expect(help.text()).toContain('npm create @gixcopilot');
    const version = io(process.cwd());
    expect(await main(['--version'], version.io)).toBe(0);
    expect(version.text()).toBe('0.1.1');
    expect(await main(['--framework', 'svelte'], io(process.cwd()).io)).toBe(2);
    expect(await main(['--pm', 'deno'], io(process.cwd()).io)).toBe(2);
  });

  it('adds the copilot to an existing Vue app in one command, never overwriting files', async () => {
    const root = await app({ 'package.json': pkg({ vue: '^3.5.0' }), 'vite.config.ts': VITE, 'tsconfig.json': '{}', 'src/copilot/CopilotPanel.vue': '<!-- mine -->' });
    const run = io(root);
    expect(await main(['--yes'], run.io)).toBe(0);
    expect(run.commands.map((step) => `${step.command} ${step.args.join(' ')}`)).toEqual([
      'npm install @gixcopilot/vue',
      'npx -y @gixcopilot/cli@0.1.1 init copilot-server --template node --name shop-copilot-server',
      'npm install',
    ]);
    expect(await readFile(join(root, 'src/copilot/CopilotPanel.vue'), 'utf8')).toBe('<!-- mine -->');
    expect(await readFile(join(root, 'vite.config.ts'), 'utf8')).toContain('/api/copilot');
    expect((JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts['copilot:server']).toBe('npm --prefix copilot-server run dev');
    expect(existsSync(join(root, 'copilot-server/.env'))).toBe(true);
    expect(run.text()).toContain('Copilot added');
  });

  it('asks questions when interactive and follows the answers', async () => {
    const root = await app({ 'package.json': pkg({ react: '19' }), 'tsconfig.json': '{}', 'src/main.tsx': '' });
    const asked: string[] = [];
    const prompter: Prompter = {
      select: (question, _choices, initial) => (asked.push(question), Promise.resolve(initial)),
      confirm: (question) => (asked.push(question), Promise.resolve(!question.startsWith('Add a Node'))),
      text: (question, initial) => (asked.push(question), Promise.resolve(initial)),
      close: () => undefined,
    };
    const run = io(root, { prompter, interactive: true });
    expect(await main([], run.io)).toBe(0);
    expect(asked).toEqual(['Detected React in shop. Add the React copilot?', 'Add a Node copilot server (recommended; keeps the model key off the browser)?', 'Continue?']);
    expect(run.commands.map((step) => step.args.join(' '))).toEqual(['install @gixcopilot/react @gixcopilot/ui']);
    expect(await readFile(join(root, 'src/copilot/CopilotPanel.tsx'), 'utf8')).toContain('<CopilotProvider runtimeUrl="/api/copilot">');
  });

  it('dry run creates a new Angular app plan without touching disk', async () => {
    const cwd = await app({});
    const run = io(cwd);
    expect(await main(['portal', '--framework', 'angular', '--dry-run'], run.io)).toBe(0);
    expect(run.commands).toHaveLength(0);
    expect(run.text()).toContain('@angular/cli@21 new portal');
    expect(run.text()).toContain('proxy.conf.json');
    expect(existsSync(join(cwd, 'portal'))).toBe(false);
  });

  it('stops at the first failing command', async () => {
    const root = await app({ 'package.json': pkg({ vue: '3' }) });
    const run = io(root, { fail: '@gixcopilot/vue' });
    expect(await main(['--yes'], run.io)).toBe(1);
    expect(run.commands).toHaveLength(1);
    expect(existsSync(join(root, 'src/copilot/CopilotPanel.vue'))).toBe(false);
  });
});
