import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from './index.js';
import type { CliIo } from './index.js';
import { toolNameFromSlug } from './names.js';

// The hard-coded VERSION must match the published version, or scaffolded apps pin old packages.
const PACKAGE_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

async function workspace(env: Record<string, string> = {}) {
  const cwd = await mkdtemp(join(tmpdir(), 'aicopilot-cli-'));
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { cwd, env, out: (line) => out.push(line), err: (line) => err.push(line) };
  return { cwd, io, out, err, text: () => out.join('\n'), errors: () => err.join('\n') };
}

describe('aicopilot CLI', () => {
  it('has --help with examples for every command, and --version', async () => {
    for (const command of ['init', 'add', 'mcp', 'import-openapi', 'dev', 'test', 'eval', 'doctor', 'db']) {
      const { io, text } = await workspace();
      expect(await run([command, '--help'], io)).toBe(0);
      expect(text()).toMatch(/Usage: aicopilot/);
    }
    const { io, text } = await workspace();
    expect(await run(['--help'], io)).toBe(0);
    expect(text()).toContain('doctor');
    const version = await workspace();
    expect(await run(['--version'], version.io)).toBe(0);
    expect(version.text()).toBe(PACKAGE_VERSION);
    const bad = await workspace();
    expect(await run(['frobnicate'], bad.io)).toBe(2);
    expect(await run(['init', '--nope'], bad.io)).toBe(2);
  });

  it('init creates each template and never overwrites without --force', async () => {
    for (const template of ['node', 'react', 'angular', 'enterprise']) {
      const { cwd, io } = await workspace();
      expect(await run(['init', 'app', '--template', template, '--name', `demo-${template}`], io)).toBe(0);
      const pkg = JSON.parse(await readFile(join(cwd, 'app', 'package.json'), 'utf8')) as { name: string; dependencies: Record<string, string>; devDependencies: Record<string, string>; overrides?: Record<string, string> };
      expect(pkg.name).toBe(`demo-${template}`);
      expect(pkg.dependencies['@gixcopilot/node']).toBe(`^${PACKAGE_VERSION}`);
      // npm 10 crashes ('edgesOut') when an exact vitest pin disagrees with the vitest@* its
      // optional peers resolve to: other templates take a range, Angular overrides the tree.
      if (template === 'angular') expect(pkg.overrides?.['vitest']).toBe(pkg.devDependencies['vitest']);
      else expect(pkg.devDependencies['vitest']).toMatch(/^\^/);
      // yarn 1 does not install peer dependencies: Vitest's vite peer must be listed.
      if (template !== 'angular') expect(pkg.devDependencies['vite']).toBeDefined();
      expect(existsSync(join(cwd, 'app', '.env.example'))).toBe(true);
      expect(await readFile(join(cwd, 'app', '.gitignore'), 'utf8')).toContain('.env');
      // No real secret ever written: .env.example has empty placeholders only.
      expect(await readFile(join(cwd, 'app', '.env.example'), 'utf8')).toMatch(/OPENAI_API_KEY=\n/);
    }
    const { cwd, io, errors } = await workspace();
    await run(['init', 'app'], io);
    await writeFile(join(cwd, 'app', 'src', 'server.ts'), '// my changes');
    expect(await run(['init', 'app'], io)).toBe(1);
    expect(errors()).toContain('src/server.ts');
    expect(await readFile(join(cwd, 'app', 'src', 'server.ts'), 'utf8')).toBe('// my changes');
    expect(await run(['init', 'app', '--force'], io)).toBe(0);
    expect(await readFile(join(cwd, 'app', 'src', 'server.ts'), 'utf8')).toContain('createCopilot');
    expect(await run(['init', 'x', '--template', 'vue'], io)).toBe(2);
  });

  it('init --sdk-path points every SDK package (and transitive ones) at local tarballs', async () => {
    const { cwd, io } = await workspace();
    const tarballs = join(cwd, 'tarballs');
    await run(['init', 'tarballs-holder'], io);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(tarballs, { recursive: true });
    for (const name of ['node', 'server', 'tools']) await writeFile(join(tarballs, `gixcopilot-${name}-0.1.0.tgz`), '');
    expect(await run(['init', 'app', '--sdk-path', tarballs], io)).toBe(0);
    const pkg = JSON.parse(await readFile(join(cwd, 'app', 'package.json'), 'utf8')) as { dependencies: Record<string, string>; pnpm: { overrides: Record<string, string> } };
    expect(pkg.dependencies['@gixcopilot/node']).toMatch(/^file:.*gixcopilot-node-0\.1\.0\.tgz$/);
    expect(pkg.pnpm.overrides['@gixcopilot/server']).toMatch(/gixcopilot-server/);
  });

  it('add tool and add agent generate typed code, tests and registration', async () => {
    const { cwd, io, text } = await workspace();
    await run(['init', '.'], io);
    expect(await run(['add', 'tool', 'applications-get'], io)).toBe(0);
    const tool = await readFile(join(cwd, 'src', 'tools', 'applications-get.ts'), 'utf8');
    expect(tool).toContain("name: 'applications.get'");
    expect(tool).toContain("risk: 'read-only'");
    expect(await readFile(join(cwd, 'src', 'tools', 'index.ts'), 'utf8')).toContain('tools.push(applicationsGet);');
    expect(text()).toContain('Review its risk');
    expect(await run(['add', 'tool', 'applications-get'], io)).toBe(1); // exists
    expect(await run(['add', 'agent', 'support'], io)).toBe(0);
    expect(await readFile(join(cwd, 'src', 'agents', 'support.ts'), 'utf8')).toContain("id: 'support'");
    expect(await readFile(join(cwd, 'src', 'agents', 'index.ts'), 'utf8')).toContain('agents.push(supportAgent);');
    expect(await run(['add', 'tool'], io)).toBe(2);
    expect(toolNameFromSlug('payments-refund-full')).toBe('payments.refundFull');
    expect(() => toolNameFromSlug('single')).toThrow();
  });

  it('import-openapi lists every operation and enables none', async () => {
    const { cwd, io, text } = await workspace();
    await writeFile(
      join(cwd, 'openapi.yaml'),
      `openapi: 3.1.0
info: { title: Visa, version: '1' }
servers: [{ url: https://api.example.com }]
paths:
  /applications/{id}:
    get:
      operationId: getApplication
      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
      responses: { '200': { description: ok } }
    delete:
      operationId: deleteApplication
      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]
      responses: { '204': { description: gone } }
`,
    );
    expect(await run(['import-openapi', 'openapi.yaml', '--id', 'visa-api'], io)).toBe(0);
    const config = JSON.parse(await readFile(join(cwd, 'aicopilot.openapi.visa-api.json'), 'utf8')) as { operations: Record<string, { expose: boolean }> };
    expect(Object.keys(config.operations).sort()).toEqual(['deleteApplication', 'getApplication']);
    expect(Object.values(config.operations).every((operation) => !operation.expose)).toBe(true);
    expect(text()).toContain('All are DISABLED');
    expect(await readFile(join(cwd, 'src', 'integrations', 'visa-api.ts'), 'utf8')).toContain('registerOpenAPI');
  });

  it('mcp configuration exposes no tools by default and rejects bad input', async () => {
    const { cwd, io, text } = await workspace();
    expect(await run(['add', 'mcp', 'files', '--url', 'https://mcp.example.com/mcp'], io)).toBe(0);
    expect(await run(['add', 'mcp', 'files', '--url', 'https://mcp.example.com/mcp'], io)).toBe(1);
    expect(await run(['add', 'mcp', 'local', '--command', 'node server.js --stdio'], io)).toBe(0);
    expect(await run(['add', 'mcp', 'bad', '--url', 'ftp://x'], io)).toBe(2);
    const config = JSON.parse(await readFile(join(cwd, 'aicopilot.mcp.json'), 'utf8')) as { servers: Record<string, { include: string[]; args?: string[] }> };
    expect(config.servers['files']?.include).toEqual([]);
    expect(config.servers['local']?.args).toEqual(['server.js', '--stdio']);
    expect(await run(['mcp', 'list'], io)).toBe(0);
    expect(text()).toContain('exposed tools: 0');
  });

  it('doctor reports problems without printing secret values', async () => {
    const secret = 'sk-doctor-secret-value-0000000000000';
    const { cwd, io, text } = await workspace({ OPENAI_API_KEY: secret, AICOPILOT_MODEL_PROVIDER: 'openai', AICOPILOT_MODEL: 'gpt-4o-mini', DATABASE_URL: 'postgres://app:db-password-123@127.0.0.1:1/copilot' });
    await run(['init', '.'], io);
    await writeFile(join(cwd, 'src', 'tools', 'unsafe.ts'), "export const unsafe = { name: 'x.y' };\n");
    const code = await run(['doctor', '--json'], io);
    const report = JSON.parse(text().slice(text().indexOf('{'))) as { checks: { name: string; status: string; detail: string }[] };
    expect(code).toBe(1); // database unreachable
    expect(report.checks.find((check) => check.name === 'model providers')?.detail).toContain('openai');
    expect(report.checks.find((check) => check.name === 'database')?.status).toBe('fail');
    expect(report.checks.find((check) => check.name === 'tool registry')?.detail).toContain('unsafe.ts');
    expect(text()).not.toContain(secret);
    expect(text()).not.toContain('db-password-123');
  });

  it('refuses destructive database rollback without --yes', async () => {
    const { io, errors } = await workspace({ DATABASE_URL: 'postgres://app:pw@127.0.0.1:1/copilot' });
    expect(await run(['db', 'rollback'], io)).toBe(1);
    expect(errors()).toMatch(/--yes/);
  });

  it('runs an eval suite with gates and machine-readable output', async () => {
    const { cwd, io, text } = await workspace();
    await writeFile(
      join(cwd, 'suite.mjs'),
      `export const dataset = { id: 'demo', version: '1', cases: [{ id: 'greet', input: 'hi', expected: { outcome: 'answered', answerIncludes: ['hello'] } }] };
export const target = async () => ({ answer: 'hello there' });
`,
    );
    const code = await run(['eval', 'suite.mjs', '--json', '--out', 'run.json'], io);
    const output = JSON.parse(text()) as { format: string; gate: { passed: boolean } };
    expect(output.format).toBe('gixcopilot.eval.run');
    expect(code).toBe(output.gate.passed ? 0 : 1);
    expect(existsSync(join(cwd, 'run.json'))).toBe(true);
  });
});
