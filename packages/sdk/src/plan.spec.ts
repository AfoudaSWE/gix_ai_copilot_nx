import { readFileSync } from 'node:fs';
import { classifyProject, createReadonlyWorkspace, discoverProject } from '@gixcopilot/studio';
import { afterEach, describe, expect, it } from 'vitest';
import { createFixture, GIX_DEPENDENCIES, NX_FIXTURE, recordingIo, removeFixture, ROOT_PACKAGE } from './fixtures.spec-helper.js';
import { planInstalls, SDK_VERSION, UI_PACKAGES } from './plan.js';
import { runInit } from './init.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeFixture(root); });
async function plan(files: Readonly<Record<string, string>>, env: Readonly<Record<string, string>> = {}) {
  const root = createFixture(files);
  roots.push(root);
  const workspace = createReadonlyWorkspace(root);
  const project = await discoverProject(workspace);
  return planInstalls({ workspace, project, apps: classifyProject(project).frontends, env });
}

describe('planInstalls', () => {
  it('keeps scaffold dependency versions synchronized with the released SDK package', async () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(SDK_VERSION).toBe(manifest.version);
    const steps = await plan({ 'package.json': '{"name":"app","dependencies":{"react":"^19.0.0"}}' });
    const packages = steps.flatMap((step) => step.packages).filter((name) => name.startsWith('@gixcopilot/'));
    expect(packages).toEqual(expect.arrayContaining(['@gixcopilot/sdk', '@gixcopilot/react', '@gixcopilot/ui']));
    for (const step of steps) {
      for (const name of step.packages.filter((name) => name.startsWith('@gixcopilot/'))) {
        expect(step.args).toContain(`${name}@^${manifest.version}`);
      }
    }
  });

  it('plans every direct import emitted by the init generators even when the SDK is already listed', async () => {
    const root = createFixture({ ...NX_FIXTURE, 'package.json': JSON.stringify({ name: 'workspace', dependencies: { '@gixcopilot/sdk': SDK_VERSION, react: '^19.0.0', fastify: '^5.0.0' }, devDependencies: { typescript: '5.9.3' } }), 'apps/api/src/permissions.ts': "export enum Permissions { ORDER_VIEW = 'orders:view' }\n", 'apps/api/src/main.ts': "import Fastify from 'fastify';\nimport { Permissions } from './permissions.js';\nconst app = Fastify();\napp.get('/orders', async () => requirePermission(Permissions.ORDER_VIEW));\n" });
    roots.push(root);
    const result = await runInit(recordingIo(root), { install: false });
    const installed = new Set(['@gixcopilot/sdk', ...result.installs.filter((step) => step.directory === '.').flatMap((step) => step.packages)]);
    const imports = new Set(result.proposals.flatMap((proposal) => proposal.fileChanges.flatMap((change) => [...(change.content ?? '').matchAll(/from ['"](@gixcopilot\/[^'"]+|zod)['"]/g)].map((match) => match[1] ?? ''))));
    expect([...imports]).toEqual(expect.arrayContaining(['@gixcopilot/openapi', '@gixcopilot/tools', '@gixcopilot/protocol', '@gixcopilot/security', 'zod']));
    expect([...imports].filter((name) => !installed.has(name))).toEqual([]);
    expect(result.installs[0]?.packages).toEqual(['@gixcopilot/openapi', '@gixcopilot/tools', '@gixcopilot/protocol', '@gixcopilot/security', 'zod']);
    expect(result.installs[0]?.args).toContain('-w');
  });

  it('plans zod only once when Angular shares the root manifest', async () => {
    const steps = await plan({ 'package.json': JSON.stringify({ name: 'angular', dependencies: { '@angular/core': '^21.0.0', '@gixcopilot/sdk': SDK_VERSION } }) });
    expect(steps.flatMap((step) => step.packages).filter((name) => name === 'zod')).toEqual(['zod']);
    expect(steps.find((step) => step.reason === 'the copilot UI')?.packages).toEqual(['@gixcopilot/angular']);
  });

  it('still plans zod in an Angular app manifest when it is also planned at root', async () => {
    const steps = await plan({ 'package.json': '{"name":"workspace"}', 'client/package.json': '{"name":"client","dependencies":{"@angular/core":"^21.0.0"}}' });
    expect(steps.filter((step) => step.packages.includes('zod')).map((step) => step.directory)).toEqual(['.', 'client']);
  });

  it.each([
    ['react', { react: '^19.0.0' }],
    ['nextjs', { next: '^16.0.0', react: '^19.0.0' }],
    ['angular', { '@angular/core': '^21.0.0' }],
    ['vue', { vue: '^3.5.0' }],
  ] as const)('plans only the %s framework packages', async (framework, dependencies) => {
    const steps = await plan({ 'package.json': JSON.stringify({ name: 'app', dependencies: { ...dependencies, ...GIX_DEPENDENCIES }, devDependencies: { typescript: '5.9.3' } }) });
    expect(steps).toHaveLength(1);
    expect(steps[0]?.directory).toBe('.');
    const missing = UI_PACKAGES[framework].filter((name) => !(name in GIX_DEPENDENCIES)).sort();
    expect(steps[0]?.packages).toEqual(missing);
    expect(steps[0]?.command).toBe('npm');
    expect(steps[0]?.args).toEqual(['install', ...missing.map((name) => name.startsWith('@gixcopilot/') ? `${name}@^${SDK_VERSION}` : name)]);
  });

  it('installs the SDK, generated module dependencies and TypeScript at root when absent', async () => {
    const steps = await plan({ 'package.json': '{"name":"backend"}' });
    expect(steps.map((step) => [step.directory, step.packages, step.dev])).toEqual([['.', ['@gixcopilot/sdk', '@gixcopilot/openapi', '@gixcopilot/tools', '@gixcopilot/protocol', '@gixcopilot/security', 'zod'], false], ['.', ['typescript'], true]]);
    expect(steps[1]?.args).toEqual(['install', '--save-dev', 'typescript']);
  });

  it('does not reinstall packages listed in dependencies or devDependencies', async () => {
    expect(await plan({ 'package.json': JSON.stringify({ name: 'app', dependencies: { react: '^19.0.0', '@gixcopilot/react': SDK_VERSION }, devDependencies: { ...GIX_DEPENDENCIES, typescript: '5.9.3', '@gixcopilot/ui': SDK_VERSION } }) })).toEqual([]);
  });

  it('uses an app manifest rather than root dependencies when the app imports the UI', async () => {
    const steps = await plan({ ...NX_FIXTURE, 'package.json': JSON.stringify({ ...JSON.parse(ROOT_PACKAGE), dependencies: { ...GIX_DEPENDENCIES, '@gixcopilot/react': SDK_VERSION, '@gixcopilot/ui': SDK_VERSION } }), 'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { react: '^19.0.0', '@gixcopilot/react': SDK_VERSION } }) });
    expect(steps).toHaveLength(1);
    expect(steps[0]?.directory).toBe('apps/web');
    expect(steps[0]?.packages).toEqual(['@gixcopilot/ui']);
    expect(steps[0]?.args).not.toContain('-w');
  });

  it('falls back to root and uses -w for a pnpm workspace', async () => {
    const steps = await plan(NX_FIXTURE);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.directory).toBe('.');
    expect(steps[0]?.args).toEqual(['add', '-w', `@gixcopilot/react@^${SDK_VERSION}`, `@gixcopilot/ui@^${SDK_VERSION}`]);
  });

  it('deduplicates packages for apps that share the root manifest', async () => {
    const steps = await plan({ ...NX_FIXTURE, 'apps/admin/project.json': '{"name":"admin","projectType":"application"}', 'apps/admin/src/main.tsx': "import React from 'react';\nexport const App = () => <main />;\n" });
    expect(steps).toHaveLength(1);
    expect(steps[0]?.packages).toEqual(['@gixcopilot/react', '@gixcopilot/ui']);
  });

  it('uses GIX_SDK_TARBALLS overrides without changing package identities', async () => {
    const steps = await plan({ ...NX_FIXTURE, 'package.json': '{"name":"workspace","dependencies":{"react":"^19.0.0","fastify":"^5.0.0"}}' }, { GIX_SDK_TARBALLS: JSON.stringify({ '@gixcopilot/sdk': 'file:C:/packs/sdk.tgz', '@gixcopilot/openapi': 'file:C:/packs/openapi.tgz', '@gixcopilot/react': 'file:C:/packs/react.tgz' }) });
    expect(steps[0]?.args).toContain('@gixcopilot/sdk@file:C:/packs/sdk.tgz');
    expect(steps[0]?.args).toContain('@gixcopilot/openapi@file:C:/packs/openapi.tgz');
    expect(steps[2]?.args).toContain('@gixcopilot/react@file:C:/packs/react.tgz');
    expect(steps[2]?.args).toContain(`@gixcopilot/ui@^${SDK_VERSION}`);
    expect(steps[0]?.packages).toEqual(['@gixcopilot/sdk', '@gixcopilot/openapi', '@gixcopilot/tools', '@gixcopilot/protocol', '@gixcopilot/security', 'zod']);
  });

  it.each([['yarn.lock', 'yarn', 'add'], ['bun.lock', 'bun', 'add']] as const)('respects the manager detected from %s', async (file, manager, action) => {
    const steps = await plan({ 'package.json': '{"name":"backend"}', [file]: '' });
    expect(steps[0]?.command).toBe(manager);
    expect(steps[0]?.args[0]).toBe(action);
  });
});
