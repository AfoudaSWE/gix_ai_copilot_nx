#!/usr/bin/env node
// Existing-project installer consumers, always outside the workspace, using built tarballs.
// After the owner builds and packs:
//   node tools/verify-packages.mjs --out .packs --keep
//   node tools/installer-consumer-test.mjs --packs .packs [--only react-vite,express] [--keep]
// Lightweight fixtures verify installation/discovery/runtime, not framework compilation.
// PASS means the fixture's mandatory installer checks passed, not full framework support.
// Exit 1 for failures; explicit coverage scopes and limits are recorded in results.json.

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

const { values } = parseArgs({ options: { packs: { type: 'string' }, only: { type: 'string' }, keep: { type: 'boolean' } } });
assert(values.packs, '--packs <dir> is required; build and run verify-packages.mjs first');
const packs = realpathSync(resolve(values.packs));
const repo = realpathSync(resolve(import.meta.dirname, '..'));
const windows = process.platform === 'win32';
const tarballs = {};

// Inspect manifests without extracting tarballs or executing package scripts.
function packedManifest(path) {
  const data = gunzipSync(readFileSync(path));
  const text = (offset, size) => data.subarray(offset, offset + size).toString('utf8').split('\0')[0];
  for (let offset = 0; offset + 512 <= data.length;) {
    const size = Number.parseInt(text(offset + 124, 12).trim() || '0', 8);
    assert(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= data.length, `Invalid tarball: ${path}`);
    if (text(offset, 100) === 'package/package.json') return JSON.parse(text(offset + 512, size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`No package/package.json in ${path}`);
}

const packed = [];
for (const file of readdirSync(packs).sort()) {
  if (!/^gixcopilot-[\w.-]+\.tgz$/.test(file)) continue;
  const path = join(packs, file);
  const pkg = packedManifest(path);
  assert(/^@gixcopilot\/[a-z0-9-]+$/.test(pkg.name), `Unexpected package name in ${file}`);
  assert(!tarballs[pkg.name], `Multiple tarballs for ${pkg.name}; use a fresh pack directory`);
  tarballs[pkg.name] = `file:${path.replaceAll('\\', '/')}`;
  packed.push(pkg);
}
assert(tarballs['@gixcopilot/sdk'], 'Missing @gixcopilot/sdk tarball');
for (const pkg of packed) {
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })) {
    if (name.startsWith('@gixcopilot/')) assert(tarballs[name], `${pkg.name} needs missing tarball ${name}`);
  }
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const reactDeps = { react: '19.3.0', 'react-dom': '19.3.0' };
const reactDev = { vite: '8.3.0', '@types/react': '19.3.0', '@types/react-dom': '19.3.0' };
const commonDev = { typescript: '5.9.3', '@types/node': '22.20.3' };
const reactFiles = {
  'index.html': '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n',
  'src/App.tsx': "export function App() { return <main>Existing application</main>; }\n",
  'src/main.tsx': "import { createRoot } from 'react-dom/client';\nimport { App } from './App.js';\ncreateRoot(document.getElementById('root')!).render(<App />);\n",
  'vite.config.ts': "import { defineConfig } from 'vite';\nexport default defineConfig({});\n",
  'tsconfig.json': json({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: false, noEmit: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['node'] }, include: ['src/**/*.tsx', 'src/gix/**/*.ts', 'vite.config.ts'] }),
};
const angularFiles = {
  'angular.json': json({ version: 1, projects: { app: { projectType: 'application', root: '', architect: { serve: { options: {} } } } } }),
  'src/app/app.component.ts': "import { Component } from '@angular/core';\n@Component({ selector: 'app-root', standalone: true, imports: [], templateUrl: './app.component.html' })\nexport class AppComponent {}\n",
  'src/app/app.component.html': '<main>Existing Angular app</main>\n',
};
const expressSource = "import express from 'express';\nconst app = express();\napp.get('/api/items', (_req, res) => { res.json([{ id: 'one' }]); });\napp.delete('/api/items/:id', (_req, res) => { res.sendStatus(204); });\nexport { app };\n";
const fastifySource = "import Fastify from 'fastify';\nconst app = Fastify();\napp.get('/api/items', async () => [{ id: 'one' }]);\nexport { app };\n";
const prefixFiles = (prefix, files) => Object.fromEntries(Object.entries(files).map(([path, content]) => [`${prefix}/${path}`, content]));
const nodeConfig = json({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, outDir: 'dist-server', types: ['node'] }, include: ['src/server.ts', 'gix/**/*.ts'] });
const frontendScripts = { typecheck: 'tsc -p tsconfig.json', build: 'vite build' };
const fixtures = [
  { name: 'react-vite', classification: 'FRONTEND_ONLY', apps: ['.'], applications: [{ path: '.', role: 'frontend', framework: 'react' }], pkg: { dependencies: reactDeps, devDependencies: reactDev, scripts: frontendScripts }, files: reactFiles, compile: true },
  { name: 'angular', classification: 'FRONTEND_ONLY', apps: ['.'], applications: [{ path: '.', role: 'frontend', framework: 'angular' }], pkg: { dependencies: { '@angular/core': '21.2.24' } }, files: angularFiles },
  { name: 'vue', classification: 'FRONTEND_ONLY', apps: ['.'], applications: [{ path: '.', role: 'frontend', framework: 'vue' }], pkg: { dependencies: { vue: '3.5.43' } }, files: { 'src/App.vue': '<script setup lang="ts">\nimport { ref } from "vue";\nconst title = ref("Existing Vue app");\n</script>\n<template><main>{{ title }}</main></template>\n', 'vite.config.ts': reactFiles['vite.config.ts'] } },
  // Express gets a real frontend as well, so its UI approval check is meaningful, not a no-op.
  { name: 'express', classification: 'FULL_STACK', apps: ['.'], applications: [{ path: '.', role: 'full-stack', framework: 'react' }], pkg: { dependencies: { ...reactDeps, express: '5.2.1' }, devDependencies: { ...reactDev, '@types/express': '5.0.3' }, scripts: { typecheck: 'tsc -p tsconfig.json && tsc -p tsconfig.server.json --noEmit', build: 'vite build && tsc -p tsconfig.server.json' } }, files: { ...reactFiles, 'src/server.ts': expressSource, 'tsconfig.server.json': nodeConfig }, compile: true },
  { name: 'fastify', classification: 'BACKEND_ONLY', apps: [], applications: [{ path: '.', role: 'backend', framework: 'fastify' }], pkg: { dependencies: { fastify: '5.12.5' } }, files: { 'src/server.ts': fastifySource } },
  ...['react', 'angular'].map((framework) => ({
    name: `nx-${framework}-node`, classification: 'NX_MONOREPO', apps: ['apps/web'], applications: [{ path: 'apps/web', role: 'frontend', framework }, { path: 'apps/api', role: 'backend', framework: 'fastify' }],
    pkg: { dependencies: { ...(framework === 'react' ? reactDeps : { '@angular/core': '21.2.24' }), fastify: '5.12.5' } },
    files: { 'nx.json': json({}), 'apps/web/project.json': json({ name: 'web', projectType: 'application', targets: { serve: { options: {} } } }), 'apps/api/project.json': json({ name: 'api', projectType: 'application' }), ...prefixFiles('apps/web', framework === 'react' ? reactFiles : angularFiles), 'apps/api/src/server.ts': fastifySource },
  })),
  { name: 'frontend-only', classification: 'FRONTEND_ONLY', apps: ['client'], applications: [{ path: 'client', role: 'frontend', framework: 'react' }], pkg: {}, files: { 'client/package.json': json({ name: 'client', private: true, type: 'module', dependencies: reactDeps, overrides: tarballs }), ...prefixFiles('client', reactFiles) } },
  { name: 'backend-only', classification: 'BACKEND_ONLY', apps: [], applications: [{ path: '.', role: 'backend', framework: 'node' }], pkg: { scripts: { start: 'node src/server.mjs' } }, files: { 'src/server.mjs': "import { createServer } from 'node:http';\nexport const server = createServer((_req, res) => res.end('Existing backend'));\n", 'openapi.json': json({ openapi: '3.0.3', info: { title: 'Existing API', version: '1' }, paths: { '/items': { get: { responses: { 200: { description: 'Items' } } } } } }) } },
  { name: 'full-stack', classification: 'FULL_STACK', apps: ['client'], applications: [{ path: 'client', role: 'frontend', framework: 'react' }, { path: 'server', role: 'backend', framework: 'express' }], pkg: {}, files: { 'client/package.json': json({ name: 'client', private: true, type: 'module', dependencies: reactDeps, overrides: tarballs }), 'server/package.json': json({ name: 'server', private: true, type: 'module', dependencies: { express: '5.2.1' }, overrides: tarballs }), ...prefixFiles('client', reactFiles), 'server/src/server.ts': expressSource } },
];
const only = values.only?.split(',');
if (only) for (const name of only) assert(fixtures.some((fixture) => fixture.name === name), `Unknown fixture: ${name}`);
const selected = fixtures.filter((fixture) => !only || only.includes(fixture.name));

const root = mkdtempSync(join(tmpdir(), 'gix-installer-consumers-'));
const outside = relative(repo, realpathSync(root));
assert(outside === '..' || outside.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(outside), 'Consumer directory must be outside the repository');
const results = [];
const children = new Set();
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (interrupted) return;
  interrupted = true;
  try {
    for (const state of children) await stop(state);
    write(root, 'results.json', json({ packs, workspace: root, interrupted: signal, results }));
  } finally {
    process.exit(signal === 'SIGINT' ? 130 : 143);
  }
});
// Do not let an ambient model key switch the generated server to a live provider.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OPENAI_|ANTHROPIC_|GOOGLE_|GEMINI_|AZURE_|GIX_|NODE_PATH$|NODE_OPTIONS$|NODE_ENV$|npm_config_(workspace|workspaces|prefix)$)/i.test(key)));
Object.assign(env, { CI: 'true', FORCE_COLOR: '0', NODE_ENV: 'development', GIX_SDK_TARBALLS: JSON.stringify(tarballs), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' });

// cmd.exe receives quoted, validated arguments only, never free-form shell commands.
function launch(cwd, command, args, extraEnv = {}) {
  assert(['npm', 'npx'].includes(command), 'Package manager is not allowlisted');
  const safeArgs = windows ? args.map((arg) => {
    assert(!/["%!\r\n]/.test(arg), 'Unsafe Windows shell argument');
    return `"${arg}"`;
  }) : args;
  const child = spawn(windows ? `${command}.cmd` : command, safeArgs, { cwd, env: { ...env, ...extraEnv }, shell: windows, detached: !windows, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { child, output: '', closed: false, error: undefined };
  children.add(state);
  const collect = (chunk) => { state.output = (state.output + chunk.toString('utf8')).slice(-64000); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('error', (error) => { state.error = error; });
  child.on('close', () => { state.closed = true; children.delete(state); });
  return state;
}

async function stop(state) {
  if (state.closed) return;
  if (state.child.pid) {
    if (windows) {
      // Kill only the process tree this tool spawned, including npx -> gix -> tsx.
      try { execFileSync('taskkill', ['/pid', String(state.child.pid), '/t', '/f'], { stdio: 'pipe' }); }
      catch (error) { if (!state.closed && state.child.exitCode === null) throw error; }
    } else {
      try { process.kill(-state.child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
  if (!state.closed) {
    await Promise.race([once(state.child, 'close').catch(() => {}), new Promise((_, reject) => setTimeout(() => reject(new Error('Child process did not stop')), 10000).unref())]);
  }
}

async function run(dir, command, args) {
  const state = launch(dir, command, args);
  let timer;
  try {
    const [code] = await Promise.race([once(state.child, 'close'), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${command} ${args[0]} timed out`)), 600000); })]);
    assert.equal(code, 0, `${command} ${args.join(' ')} exited ${code}\n${state.output}`);
    return state.output;
  } finally {
    clearTimeout(timer);
    await stop(state);
  }
}

function write(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}
const readJson = (dir, path) => JSON.parse(readFileSync(join(dir, path), 'utf8'));
function packedOverrides(dir) {
  const pkg = readJson(dir, 'package.json');
  const direct = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
  // npm add/install relativizes file arguments before checking direct-dependency overrides.
  // Keep the SDK's environment map absolute: init also installs from app directories.
  pkg.overrides = Object.fromEntries(Object.entries(tarballs).map(([name, spec]) => [name,
    direct[name] ? `$${name}` : `file:${relative(dir, spec.slice(5)).replaceAll('\\', '/').replaceAll('#', '%23')}`,
  ]));
  write(dir, 'package.json', json(pkg));
}
function proposalSnapshot(dir) {
  const path = join(dir, '.gix/proposals');
  assert(existsSync(path), 'Missing persisted proposal directory');
  return Object.fromEntries(readdirSync(path).filter((file) => file.endsWith('.json')).sort().map((file) => [file, readFileSync(join(path, file), 'utf8')]));
}

function assertPackedInstalls(dir) {
  const lock = readJson(dir, 'package-lock.json');
  const entries = Object.entries(lock.packages).filter(([path]) => /(^|\/)node_modules\/@gixcopilot\/[^/]+$/.test(path));
  assert(entries.length > 0, `No packed SDK installs in ${dir}`);
  for (const [path, pkg] of entries) {
    assert(pkg.resolved?.startsWith('file:'), `Registry/workspace SDK fallback: ${path}`);
    const name = `@gixcopilot/${path.split('/').at(-1)}`;
    assert.equal(realpathSync(resolve(dir, pkg.resolved.slice(5))), realpathSync(tarballs[name].slice(5)), `Wrong tarball for ${name}`);
    const installed = relative(realpathSync(dir), realpathSync(join(dir, path)));
    assert(!installed.startsWith('..') && !isAbsolute(installed), `External SDK symlink: ${path}`);
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  const port = server.address().port;
  await new Promise((accept, reject) => server.close((error) => error ? reject(error) : accept()));
  return port;
}

async function request(port, path, options = {}) {
  // Fetch ignores Host overrides on some Node versions. Use localhost as the real authority,
  // pin its connection to IPv4 loopback, and let HTTP generate the matching Host header.
  return new Promise((accept, reject) => {
    const req = httpRequest(`http://localhost:${port}${path}`, {
      method: options.method ?? 'GET',
      headers: options.headers,
      family: 4,
      lookup: (_hostname, _options, callback) => callback(null, '127.0.0.1', 4),
      signal: AbortSignal.timeout(600000),
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => accept(new Response(chunks.length ? Buffer.concat(chunks) : null, { status: response.statusCode })));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

async function serverCheck(dir, environment, fn) {
  const port = await freePort();
  const state = launch(dir, 'npx', ['--no-install', 'gix', 'dev'], { NODE_ENV: environment, GIX_PORT: String(port) });
  try {
    const deadline = Date.now() + 90000;
    let ready = false;
    while (Date.now() < deadline) {
      if (state.error) throw state.error;
      assert(!state.closed, `gix dev exited before readiness\n${state.output}`);
      // Only probe after our own child reports listening; never apply to an unrelated server.
      if (state.output.includes('GIX copilot on ')) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
          ready = response.status === 200;
          await response.arrayBuffer();
        } catch { /* Bounded readiness retry, not a fixed startup sleep. */ }
      }
      if (ready) break;
      await new Promise((accept) => setTimeout(accept, 200));
    }
    assert(ready, `gix dev did not become healthy\n${state.output}`);
    await fn(port);
  } finally {
    await stop(state);
  }
}

async function applyUi(dir, port, page, fixture) {
  const token = /<meta name="gix-studio-token" content="([\w-]+)">/.exec(page)?.[1];
  assert(token, 'Studio page did not include its session token');
  const headers = { 'x-gix-studio-token': token, Origin: `http://localhost:${port}`, 'Content-Type': 'application/json' };
  const call = async (path, body) => {
    const response = await request(port, `/__gix/api${path}`, { headers, ...(body !== undefined ? { method: 'POST', body: json(body) } : {}) });
    const result = await response.json();
    assert.equal(response.status, 200, `Studio ${path}: ${json(result)}`);
    return result;
  };
  const proposals = await call('/proposals');
  const proposal = proposals.find((item) => item.generator === 'app-integration');
  assert(proposal, 'No UI proposal to approve');
  const integrations = proposal.integrations.filter((item) => fixture.apps.includes(item.app));
  assert.equal(integrations.length, fixture.apps.length, 'Missing requested UI integration');
  assert(integrations.every((item) => item.manual.length === 0), 'UI proposal requires manual integration');
  // Select only UI integration items, not tools/policies or sensitive context.
  const selection = integrations.map((item) => item.id);
  const id = encodeURIComponent(proposal.id);
  const entryBeforeApproval = readFileSync(join(dir, 'src/main.tsx'), 'utf8');
  const crossOrigin = await request(port, `/__gix/api/proposals/${id}/apply`, { method: 'POST', headers: { ...headers, Origin: `http://127.0.0.1:${port}` }, body: '{}' });
  assert.equal(crossOrigin.status, 403, 'Studio must refuse a mismatched Origin even with a valid token');
  assert.equal((await crossOrigin.json()).error.code, 'ORIGIN_NOT_ALLOWED');
  const denied = await request(port, `/__gix/api/proposals/${id}/apply`, { method: 'POST', headers, body: '{}' });
  assert.equal(denied.status, 409, 'Unapproved apply must be refused');
  await denied.arrayBuffer();
  assert.equal(readFileSync(join(dir, 'src/main.tsx'), 'utf8'), entryBeforeApproval, 'Refused apply modified application source');
  assert(!existsSync(join(dir, 'src/gix/GixCopilot.tsx')), 'Refused apply created UI source');
  const approved = await call(`/proposals/${id}/approve`, { selection });
  assert.equal(approved.status, 'approved');
  assert(approved.fileChanges.some((change) => change.kind === 'modify' && change.path === 'src/main.tsx'), 'UI approval has no actual entry patch');
  const applied = await call(`/proposals/${id}/apply`, {});
  assert.equal(applied.status, 'applied', json(applied.applyResult));
  assert.equal(applied.applyResult?.outcome, 'complete', json(applied.applyResult));
  assert(!applied.applyResult.validation.some((check) => check.status === 'failed'), 'Post-apply validation failed');
  assert(readFileSync(join(dir, 'src/main.tsx'), 'utf8').includes('<GixCopilot'), 'Approved UI was not integrated');
  assert(existsSync(join(dir, 'src/gix/GixCopilot.tsx')), 'Missing applied UI component');
}

console.log(`Installer consumers: ${root}\nTarballs: ${packs}`);
try {
  for (const fixture of selected) {
    const started = Date.now();
    const checks = [];
    const dir = join(root, fixture.name);
    let phase = 'create fixture';
    try {
      mkdirSync(dir);
      write(dir, 'package.json', json({ name: `installer-${fixture.name}`, version: '0.0.0', private: true, type: 'module', ...fixture.pkg, devDependencies: { ...commonDev, ...fixture.pkg.devDependencies }, overrides: tarballs }));
      for (const [path, content] of Object.entries(fixture.files)) write(dir, path, content);
      const packageDirs = ['.', ...Object.keys(fixture.files).filter((path) => path.endsWith('/package.json')).map(dirname)];
      for (const path of packageDirs) packedOverrides(join(dir, path));
      // Source snapshots intentionally exclude package manifests, which init may update.
      const sources = Object.entries(fixture.files).filter(([path]) => !path.endsWith('package.json'));
      const assertUnchanged = () => {
        for (const [path, content] of sources) assert.equal(readFileSync(join(dir, path), 'utf8'), content, `Unapproved source edit: ${path}`);
      };
      phase = 'npm add packed SDK';
      await run(dir, 'npm', ['add', `@gixcopilot/sdk@${tarballs['@gixcopilot/sdk']}`]);
      packedOverrides(dir);
      assertUnchanged();
      assert(!existsSync(join(dir, '.gix')) && !existsSync(join(dir, 'gix')), 'postinstall modified the project');
      checks.push('postinstall is hint-only');
      phase = 'gix init';
      const initArgs = ['--no-install', 'gix', 'init', ...(fixture.apps.length ? ['--apps', fixture.apps.join(',')] : [])];
      await run(dir, 'npx', initArgs);
      assertUnchanged();
      const manifest = readJson(dir, '.gix/manifest.json');
      assert.equal(manifest.workspace.classification, fixture.classification);
      assert.deepEqual(manifest.selectedApplications, fixture.apps);
      for (const expected of fixture.applications) {
        const app = manifest.applications.find((item) => item.path === expected.path);
        assert(app, `Undetected application: ${expected.path}`);
        assert.equal(app.role, expected.role);
        assert.equal(app.framework, expected.framework);
      }
      assert.equal(manifest.applications.length, fixture.applications.length, 'Unexpected applications');
      const owned = ['gix/server.ts', 'gix/.env.example', '.gix/.gitignore', '.gix/copilot.config.json'];
      for (const path of [...owned, '.gix/discovery.json']) assert(existsSync(join(dir, path)), `Missing ${path}`);
      assert.match(readFileSync(join(dir, 'gix/.env.example'), 'utf8'), /^OPENAI_API_KEY=$/m);
      assert(!/sk-(?:proj-)?[A-Za-z0-9_-]{32,}/.test(json(manifest)), 'Manifest contains a model credential');
      const proposals = proposalSnapshot(dir);
      assert(Object.keys(proposals).length > 0, 'No proposals were persisted');
      const items = Object.values(proposals).map((text) => JSON.parse(text).proposal);
      assert.equal(items.some((proposal) => proposal.generator === 'app-integration'), fixture.apps.length > 0, 'Incorrect UI proposal presence');
      for (const proposal of items) {
        for (const change of proposal.fileChanges) {
          if (change.kind === 'create' && !(change.path in fixture.files)) assert(!existsSync(join(dir, change.path)), `Proposal created ${change.path} before approval`);
        }
        for (const tool of proposal.tools) if (tool.risk === 'destructive' || tool.confidence === 'review' || tool.conflicts?.length) assert.equal(tool.selected, false, 'Unsafe tool preselected');
      }
      assertPackedInstalls(dir);
      for (const app of fixture.apps.filter((path) => path !== '.' && existsSync(join(dir, path, 'package-lock.json')))) assertPackedInstalls(join(dir, app));
      checks.push('classification, selected apps, owned files, proposals, packed dependencies, no unapproved edits');
      phase = 'idempotent init';
      const preserved = Object.fromEntries([...owned, 'package.json', 'package-lock.json', ...fixture.apps.filter((path) => path !== '.' && existsSync(join(dir, path, 'package.json'))).flatMap((path) => [`${path}/package.json`, `${path}/package-lock.json`])].map((path) => [path, readFileSync(join(dir, path), 'utf8')]));
      const output = await run(dir, 'npx', initArgs);
      assert(output.includes('Existing GIX installation detected'), 'Second init did not report reuse');
      assert(!/^\s{2}npm (?:install|add) /m.test(output), 'Second init ran another install');
      assert.deepEqual(proposalSnapshot(dir), proposals, 'Second init duplicated or changed pending proposals');
      for (const [path, content] of Object.entries(preserved)) assert.equal(readFileSync(join(dir, path), 'utf8'), content, `Second init changed ${path}`);
      assertUnchanged();
      const second = readJson(dir, '.gix/manifest.json');
      // Manifest/discovery timestamps may refresh; installation identity and proposals may not.
      for (const key of ['createdAt', 'selectedApplications', 'generatedFiles']) assert.deepEqual(second[key], manifest[key]);
      const byId = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));
      assert.deepEqual(byId(second.proposals), byId(manifest.proposals));
      checks.push('idempotency (sources, owned files, dependencies, lockfiles, pending proposals)');
      phase = 'development server and approved UI apply';
      await serverCheck(dir, 'development', async (port) => {
        const page = await request(port, '/__gix');
        assert.equal(page.status, 200, 'Studio unavailable with Host localhost');
        const html = await page.text();
        const preview = await request(port, '/__gix/preview/');
        assert.equal(preview.status, 200, 'Packed live preview unavailable');
        await preview.arrayBuffer();
        const forbidden = await request(port, '/__gix/api/proposals');
        assert.equal(forbidden.status, 403, 'Studio API accepted a request without token');
        await forbidden.arrayBuffer();
        checks.push('gix dev, health 200, Studio 200, preview 200, API token required');
        if (fixture.compile) {
          await applyUi(dir, port, html, fixture);
          checks.push('cross-origin and unapproved apply refused; UI explicitly approved and applied via token + matching Origin');
        }
      });
      if (fixture.compile) {
        phase = 'post-apply typecheck/build';
        await run(dir, 'npm', ['run', 'typecheck']);
        await run(dir, 'npm', ['run', 'build']);
        checks.push('real framework post-apply typecheck and build');
      }
      phase = 'production isolation';
      await serverCheck(dir, 'production', async (port) => {
        for (const path of ['/__gix', '/__gix/preview/', '/__gix/api/proposals']) {
          const response = await request(port, path);
          assert.equal(response.status, 404, `Production exposed ${path}`);
          await response.arrayBuffer();
        }
        const health = await request(port, '/health');
        assert.equal(health.status, 200, 'Production runtime is not healthy');
        await health.arrayBuffer();
      });
      checks.push('production health 200; Studio, preview and API 404');
      results.push({ name: fixture.name, status: 'PASS', scope: fixture.compile ? 'mandatory installer/runtime + approved UI apply/typecheck/build' : 'mandatory installer/runtime checks only', seconds: Math.round((Date.now() - started) / 1000), checks, limits: fixture.compile ? 'No browser interaction or live-model test; dedicated GIX server, not an Express mount.' : 'Framework compilation and approved proposal apply not exercised; PASS does not establish full framework support.' });
    } catch (error) {
      results.push({ name: fixture.name, status: 'FAIL', phase, seconds: Math.round((Date.now() - started) / 1000), checks, reason: error.message });
    }
    const result = results.at(-1);
    console.log(`${result.status} ${fixture.name}: ${result.reason ?? result.limits}`);
    write(root, 'results.json', json({ packs, workspace: root, selected: selected.map((fixture) => fixture.name), results }));
  }
} finally {
  for (const state of children) await stop(state);
}
const failed = results.filter((result) => result.status === 'FAIL');
console.log(`\n${results.filter((result) => result.status === 'PASS').length} PASS; ${failed.length} FAIL (mandatory fixture scope; see explicit limits). Results: ${join(root, 'results.json')}`);
// Keep failed evidence by default. --keep also retains successful runs and their limits.
if (!values.keep && results.every((result) => result.status === 'PASS')) {
  rmSync(root, { recursive: true, force: true });
  console.log('Removed successful consumer workspace; use --keep to retain results and fixtures.');
}
process.exitCode = failed.length ? 1 : 0;
