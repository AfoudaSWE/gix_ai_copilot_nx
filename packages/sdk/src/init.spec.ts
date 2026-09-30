import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runStatus } from './commands.js';
import { BACKEND_SOURCE, createFixture, GIX_DEPENDENCIES, NX_FIXTURE, REACT_FIXTURE, recordingIo, removeFixture, ROOT_PACKAGE, snapshot, writeFixture } from './fixtures.spec-helper.js';
import { runInit } from './init.js';
import { SDK_VERSION } from './plan.js';
import { ENV_EXAMPLE } from './templates.js';

const roots: string[] = [];
function fixture(files: Readonly<Record<string, string>>): string {
  const root = createFixture(files);
  roots.push(root);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) removeFixture(root); });

describe('runInit classification and selection', () => {
  it('integrates only the React frontend in an Nx React + Fastify workspace', async () => {
    const root = fixture(NX_FIXTURE);
    const before = snapshot(root);
    const io = recordingIo(root);
    const result = await runInit(io);
    expect(result.classification.classification).toBe('NX_MONOREPO');
    expect(result.classification.backends.map((app) => app.path)).toEqual(['apps/api']);
    expect(result.selected).toEqual(['apps/web']);
    expect(result.proposals.flatMap((proposal) => proposal.integrations).map((item) => item.app)).toEqual(['apps/web']);
    expect(result.proposals.flatMap((proposal) => proposal.fileChanges).some((change) => change.kind === 'modify' && change.path === 'apps/web/src/main.tsx')).toBe(true);
    const after = snapshot(root);
    for (const [path, hash] of Object.entries(before)) expect(after[path]).toBe(hash);
    expect(io.runs).toHaveLength(1);
    expect(io.runs[0]?.step.args).toContain('-w');
  });

  it('classifies client/server and installs the UI in the client manifest', async () => {
    const root = fixture({ 'package.json': ROOT_PACKAGE, 'client/package.json': JSON.stringify({ name: 'client', dependencies: { vue: '^3.5.0' } }), 'client/src/App.vue': '<script setup lang="ts">\n</script>\n<template><main /></template>\n', 'server/package.json': JSON.stringify({ name: 'server', dependencies: { fastify: '^5.0.0' } }), 'server/main.ts': BACKEND_SOURCE });
    const io = recordingIo(root);
    const result = await runInit(io);
    expect(result.classification.classification).toBe('FULL_STACK');
    expect(result.selected).toEqual(['client']);
    expect(result.proposals.flatMap((proposal) => proposal.integrations).map((item) => item.framework)).toEqual(['vue']);
    expect(io.runs.map(({ step, cwd }) => [step.directory, cwd])).toEqual([['client', join(root, 'client')]]);
    expect(io.runs[0]?.step.packages).toEqual(['@gixcopilot/vue']);
  });

  it('installs Angular and zod for an Angular frontend-only project', async () => {
    const root = fixture({ 'package.json': JSON.stringify({ name: 'angular', dependencies: { ...GIX_DEPENDENCIES, '@angular/core': '^21.0.0', zod: undefined }, devDependencies: { typescript: '5.9.3' } }), 'angular.json': '{}', 'src/app/app.component.ts': "import { Component } from '@angular/core';\n@Component({ selector: 'app-root', imports: [], templateUrl: './app.component.html' })\nexport class AppComponent {}\n", 'src/app/app.component.html': '<main></main>' });
    const io = recordingIo(root);
    const result = await runInit(io);
    expect(result.classification.classification).toBe('FRONTEND_ONLY');
    expect(result.selected).toEqual(['.']);
    expect(result.proposals.flatMap((proposal) => proposal.integrations).map((item) => item.framework)).toEqual(['angular']);
    expect(io.runs.map(({ step }) => step.packages)).toEqual([['zod'], ['@gixcopilot/angular']]);
  });

  it('creates no UI proposal for backend-only and reports no frontend', async () => {
    const io = recordingIo(fixture({ 'package.json': JSON.stringify({ name: 'api', dependencies: { fastify: '^5.0.0', ...GIX_DEPENDENCIES }, devDependencies: { typescript: '5.9.3' } }), 'src/main.ts': BACKEND_SOURCE }));
    const result = await runInit(io);
    expect(result.classification.classification).toBe('BACKEND_ONLY');
    expect(result.selected).toEqual([]);
    expect(result.proposals.some((proposal) => proposal.generator === 'app-integration')).toBe(false);
    expect(io.output.join('\n')).toContain('No frontend application detected');
    expect(io.runs).toEqual([]);
  });

  const multiple = { ...NX_FIXTURE, 'apps/admin/project.json': JSON.stringify({ name: 'admin', projectType: 'application' }), 'apps/admin/src/main.tsx': REACT_FIXTURE['src/main.tsx'] ?? '' };
  it('selects no apps without --apps or a prompt in a multi-frontend workspace', async () => {
    const io = recordingIo(fixture(multiple));
    const result = await runInit(io);
    expect(result.selected).toEqual([]);
    expect(result.proposals.flatMap((proposal) => proposal.integrations).filter((item) => item.selected)).toEqual([]);
    expect(result.installs).toEqual([]);
    expect(io.output.join('\n')).toContain('Several frontends found');
  });

  it('respects --apps by name', async () => {
    const result = await runInit(recordingIo(fixture(multiple)), { apps: ['admin'] });
    expect(result.selected).toEqual(['apps/admin']);
    expect(result.proposals.flatMap((proposal) => proposal.integrations).map((item) => item.app)).toEqual(['apps/admin']);
  });

  it('respects the comma-separated prompt answer', async () => {
    const io = recordingIo(fixture(multiple));
    const result = await runInit({ ...io, prompt: () => Promise.resolve(' apps/admin, web ') });
    expect([...result.selected].sort()).toEqual(['apps/admin', 'apps/web']);
    expect(result.proposals.flatMap((proposal) => proposal.integrations).every((item) => item.selected)).toBe(true);
  });

  it('an empty explicit app selection never enables a single frontend', async () => {
    const result = await runInit(recordingIo(fixture(REACT_FIXTURE)), { apps: [] });
    expect(result.selected).toEqual([]);
    expect(result.proposals.flatMap((proposal) => proposal.integrations).filter((item) => item.selected)).toEqual([]);
  });
});

describe('runInit safety and repeat runs', () => {
  it('keeps existing GIX-owned files byte-identical and creates only missing ones', async () => {
    const root = fixture({ ...REACT_FIXTURE, 'gix/package.json': '{"private":true,"type":"module","custom":true}\n', '.gix/package.json': '{"private":true,"type":"module","custom":true}\n', 'gix/server.ts': '// custom server\n', 'gix/.env.example': '# custom\n', '.gix/copilot.config.json': '{"copilot":{"name":"custom"}}\n', '.gix/.gitignore': '# custom ignore\n' });
    const before = snapshot(root);
    const result = await runInit(recordingIo(root));
    expect(result.created).toEqual([]);
    expect([...result.kept].sort()).toEqual(['.gix/.gitignore', '.gix/copilot.config.json', '.gix/package.json', 'gix/.env.example', 'gix/package.json', 'gix/server.ts']);
    for (const [path, hash] of Object.entries(before)) expect(snapshot(root)[path]).toBe(hash);
  });

  it('reuses pending proposals, remembers selection, and does not reinstall listed packages', async () => {
    const root = fixture(REACT_FIXTURE);
    const first = await runInit(recordingIo(root));
    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    for (const step of first.installs) for (const name of step.packages) packageJson.dependencies[name] = SDK_VERSION;
    writeFixture(root, { 'package.json': JSON.stringify(packageJson) });
    const io = recordingIo(root);
    const second = await runInit(io);
    expect(second.created).toEqual([]);
    expect(second.installs).toEqual([]);
    expect(io.runs).toEqual([]);
    expect(second.proposals).toEqual([]);
    expect(second.reusedProposals.map((proposal) => proposal.id)).toEqual(first.proposals.map((proposal) => proposal.id));
    expect(second.selected).toEqual(first.selected);
    expect(second.manifest?.createdAt).toBe(first.manifest?.createdAt);
    expect(io.output.join('\n')).toContain('Existing GIX installation detected');
    const refreshed = await runInit(recordingIo(root), { refresh: true });
    expect(refreshed.proposals.length).toBeGreaterThan(0);
    expect(refreshed.proposals.every((proposal) => !first.proposals.some((old) => old.id === proposal.id))).toBe(true);
  });

  it('dry-run writes and installs nothing, including proposals', async () => {
    const root = fixture({ ...REACT_FIXTURE, '.env': 'OPENAI_API_KEY=fake-test-secret\n' });
    const before = snapshot(root);
    const io = recordingIo(root);
    const result = await runInit(io, { dryRun: true });
    expect(result.exitCode).toBe(0);
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(io.runs).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });

  it('a failed install returns its exit code and writes nothing', async () => {
    const root = fixture(REACT_FIXTURE);
    const before = snapshot(root);
    const io = recordingIo(root, 1);
    const result = await runInit(io);
    expect(result.exitCode).toBe(1);
    expect(io.runs).toHaveLength(1);
    expect(io.errors.join('\n')).toContain('Install failed');
    expect(result.created).toEqual([]);
    expect(result.proposals).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });

  it('skip-install still bootstraps and reports the pending commands', async () => {
    const io = recordingIo(fixture(REACT_FIXTURE));
    const result = await runInit(io, { install: false });
    expect(result.created).toHaveLength(6);
    expect(readFileSync(join(io.cwd, 'gix/.env.example'), 'utf8')).toBe(ENV_EXAMPLE);
    expect(result.installs.length).toBeGreaterThan(0);
    expect(io.runs).toEqual([]);
    expect(io.output.join('\n')).toContain('Install skipped. Run:');
  });

  it('persists a secret-free manifest and discovery; status detects an added API route', async () => {
    const secret = 'fake-private-provider-key-123456789';
    const root = fixture({ ...NX_FIXTURE, '.env': `OPENAI_API_KEY=${secret}\n` });
    const io = recordingIo(root);
    const result = await runInit({ ...io, env: { OPENAI_API_KEY: secret } });
    const manifest = readFileSync(join(root, '.gix/manifest.json'), 'utf8');
    expect(JSON.parse(manifest)).toEqual(result.manifest);
    expect(manifest).not.toContain(secret);
    expect(manifest).not.toContain('OPENAI_API_KEY');
    const discovery = readFileSync(join(root, '.gix/discovery.json'), 'utf8');
    expect(discovery).not.toContain(secret);
    expect((JSON.parse(discovery) as { operations: unknown[] }).operations).toHaveLength(1);
    const initialStatus = recordingIo(root);
    expect(await runStatus(initialStatus)).toBe(0);
    expect(initialStatus.output.join('\n')).toContain('No changes since the last discovery');
    writeFixture(root, { 'apps/api/src/customers.ts': "import Fastify from 'fastify';\nconst app = Fastify();\napp.get('/customers', async () => []);\n" });
    const status = recordingIo(root);
    const before = snapshot(root);
    expect(await runStatus(status)).toBe(0);
    expect(status.output.join('\n')).toContain('1 new API(s)');
    expect(snapshot(root)).toEqual(before);
  });

  it('status without an installation reports the missing setup', async () => {
    const io = recordingIo(fixture(REACT_FIXTURE));
    expect(await runStatus(io)).toBe(1);
    expect(io.errors.join('\n')).toContain('GIX is not set up');
  });
});
