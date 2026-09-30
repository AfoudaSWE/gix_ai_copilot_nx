import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import { createFixture, NX_FIXTURE, removeFixture } from './fixtures.spec-helper.js';
import type { ChangeProposal } from './proposals/model.js';
import { createStudioService, DEFAULT_GENERATORS } from './service.js';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const PACKAGE_DIRECTORIES: Readonly<Record<string, string>> = {
  protocol: 'packages/protocol',
  core: 'packages/core',
  tools: 'packages/tools',
  security: 'packages/security',
  openapi: 'packages/openapi',
  context: 'packages/context',
  'generative-ui': 'packages/generative-ui',
  agents: 'packages/agents',
  knowledge: 'packages/knowledge',
  mcp: 'packages/mcp',
  telemetry: 'packages/telemetry',
  provider: 'packages/providers/provider-core',
  react: 'packages/react',
  ui: 'packages/ui',
  client: 'packages/client',
};

const cleanup: string[] = [];
afterAll(() => {
  for (const path of cleanup) rmSync(path, { recursive: true, force: true });
});

/**
 * Generated code is ordinary application code, so it must compile against the real SDK
 * packages under the repository's strict settings - a proposal that would not typecheck is a
 * generator bug, not something to discover after apply.
 */
describe('generated code', () => {
  it('type-checks against the real @gixcopilot packages with every item selected', async () => {
    const root = createFixture(NX_FIXTURE);
    cleanup.push(root);
    const service = createStudioService({ root });
    await service.discover();
    const files = new Map<string, string>();
    for (const generator of DEFAULT_GENERATORS) {
      let proposal: ChangeProposal = await service.generate(generator.id, generator.id === 'studio-configuration' ? { values: { 'copilot.name': 'Portal' } } : {});
      const unselected = (['tools', 'context', 'ui', 'agents', 'skills', 'knowledge', 'configChanges'] as const).flatMap((collection) =>
        (proposal[collection] as readonly { readonly id: string; readonly selected: boolean }[]).filter((item) => !item.selected).map((item) => ({ collection, id: item.id, changes: { selected: true } })),
      );
      if (unselected.length > 0) proposal = await service.edit(proposal.id, unselected);
      for (const change of proposal.fileChanges) if (change.content !== undefined) files.set(change.path, change.content);
    }
    removeFixture(root);

    // Inside the studio package so bare imports such as `zod` resolve from its node_modules.
    const output = mkdtempSync(join(here, '..', '.generated-check-'));
    cleanup.push(output);
    for (const [path, content] of files) {
      mkdirSync(dirname(join(output, path)), { recursive: true });
      writeFileSync(join(output, path), content);
    }
    const base = ts.parseJsonConfigFileContent(ts.readConfigFile(join(repository, 'tsconfig.base.json'), (path) => ts.sys.readFile(path)).config, ts.sys, repository);
    const paths = Object.fromEntries(Object.entries(PACKAGE_DIRECTORIES).map(([name, directory]) => [`@gixcopilot/${name}`, [`${directory}/src/index.ts`]]));
    // .vue files need vue-tsc; everything else (including the React integration) is checked here.
    const roots = [...files.keys()].filter((path) => /\.tsx?$/.test(path)).map((path) => join(output, path));
    expect(roots.some((path) => path.endsWith('GixCopilot.tsx'))).toBe(true);
    const reactTypes = join(repository, 'packages/react/node_modules/@types/react');
    expect(roots.length).toBeGreaterThanOrEqual(8);
    const options: ts.CompilerOptions = { ...base.options, noEmit: true, composite: false, declaration: false, declarationMap: false, sourceMap: false, baseUrl: repository, paths: { ...paths, react: [`${reactTypes}/index.d.ts`], 'react/jsx-runtime': [`${reactTypes}/jsx-runtime.d.ts`] }, types: ['node'], lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], jsx: ts.JsxEmit.ReactJSX, skipLibCheck: true };
    // Server-side .gix/ code compiles like the repository (NodeNext); app code inside a frontend
    // compiles the way its bundler (Vite, Next.js, Angular) resolves modules.
    const serverRoots = roots.filter((path) => path.startsWith(join(output, '.gix')));
    const appRoots = roots.filter((path) => !serverRoots.includes(path));
    const programs = [
      ts.createProgram(serverRoots, options),
      ts.createProgram(appRoots, { ...options, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }),
    ];
    const diagnostics = programs
      .flatMap((program) => ts.getPreEmitDiagnostics(program))
      .filter((diagnostic) => diagnostic.file?.fileName.startsWith(output.split('\\').join('/')))
      .map((diagnostic) => `${diagnostic.file?.fileName.slice(output.length) ?? ''}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`);
    expect(diagnostics).toEqual([]);
  }, 180_000);
});
