import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { MODULE_PACKAGE, serverSource } from './templates.js';
import { createFixture, recordingIo, removeFixture, writeFixture } from './fixtures.spec-helper.js';
import { runInit } from './init.js';

it.each(['module', 'commonjs', undefined])('generated gix/server.ts type-checks against the public SDK with app type %s', (type) => {
  const here = dirname(fileURLToPath(import.meta.url));
  const repository = resolve(here, '../../..');
  // Inside the package so transitive dependencies and Node types resolve normally.
  const root = mkdtempSync(join(here, '..', '.generated-check-'));
  try {
    mkdirSync(join(root, 'gix'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, ...(type ? { type } : {}) }));
    writeFileSync(join(root, 'gix/package.json'), MODULE_PACKAGE);
    const source = join(root, 'gix/server.ts');
    writeFileSync(source, serverSource('fixture'));
    const base = ts.parseJsonConfigFileContent(ts.readConfigFile(join(repository, 'tsconfig.base.json'), (path) => ts.sys.readFile(path)).config, ts.sys, repository);
    // This test-only mapping checks the real public entry, never a stub declaration.
    const options: ts.CompilerOptions = { ...base.options, noEmit: true, composite: false, declaration: false, declarationMap: false, sourceMap: false, baseUrl: repository, paths: { '@gixcopilot/sdk/server': ['packages/sdk/src/server.ts'] }, types: ['node'] };
    const program = ts.createProgram([source], options);
    const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => `${diagnostic.file?.fileName ?? ''}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
    expect(diagnostics).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 180_000);

it.each(['commonjs', undefined])('init creates ESM boundaries and tsx executes the generated server with app type %s', async (type) => {
  const original = JSON.stringify({ name: 'existing-app', private: true, ...(type ? { type } : {}) });
  const root = createFixture({ 'package.json': original });
  try {
    const result = await runInit(recordingIo(root), { install: false });
    expect(result.created).toEqual(expect.arrayContaining(['gix/package.json', '.gix/package.json']));
    // Isolate transpilation/module-mode regression from network servers and packed dependencies.
    writeFixture(root, {
      'node_modules/@gixcopilot/sdk/package.json': '{"type":"module","exports":{"./server":"./server.js"}}',
      'node_modules/@gixcopilot/sdk/server.js': `import { pathToFileURL } from 'node:url';
export const createActionFirewall = () => ({});
export const createInMemoryAuditSink = () => ({});
export const createMockProvider = () => ({});
export const createOpenAIProvider = () => { throw new Error('Must use mock'); };
export const createToolRegistry = () => ({});
export const attachStudio = async () => false;
export const loadGeneratedTools = async (_registry, { root }) => {
  const { approved } = await import(pathToFileURL(root + '/.gix/tools/approved.ts').href);
  return { registered: [approved] };
};
export const createCopilot = () => ({ listen: async () => 'fixture-listened' });
`,
      '.gix/tools/approved.ts': "export const approved: string = await Promise.resolve('orders.list');\n",
    });
    const child = spawnSync(process.execPath, [createRequire(import.meta.url).resolve('tsx/cli'), 'gix/server.ts'], { cwd: root, env: { ...process.env, NODE_ENV: 'production', OPENAI_API_KEY: '' }, encoding: 'utf8', timeout: 30_000 });
    expect(child.error).toBeUndefined();
    expect(child.stderr).toBe('');
    expect(child.status).toBe(0);
    expect(child.stdout).toContain('GIX copilot on fixture-listened (1 approved tool(s))');
    expect(child.stdout).not.toContain('Developer Studio:');
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(original);
    expect(readFileSync(join(root, 'gix/package.json'), 'utf8')).toBe(MODULE_PACKAGE);
    expect(readFileSync(join(root, '.gix/package.json'), 'utf8')).toBe(MODULE_PACKAGE);
  } finally { removeFixture(root); }
}, 60_000);
