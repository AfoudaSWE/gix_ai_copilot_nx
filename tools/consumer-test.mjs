#!/usr/bin/env node
// Clean package-consumer tests (Phase 12 Section 188-193): projects OUTSIDE the monorepo that
// install the packed tarballs (never workspace links), then typecheck, build and run.
//
//   node tools/verify-packages.mjs --out .packs --keep
//   node tools/consumer-test.mjs --packs .packs [--only node,react,angular,cli] [--keep]

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { packs: { type: 'string' }, only: { type: 'string' }, keep: { type: 'boolean' }, templates: { type: 'string' }, npm: { type: 'string' } } });
if (!values.packs) throw new Error('--packs <dir> is required (output of tools/verify-packages.mjs --out <dir> --keep)');
const packs = resolve(values.packs);
const only = values.only ? values.only.split(',') : ['node', 'react', 'angular', 'cli'];
// --npm <version> runs the consumers with that npm (e.g. 11) via npx; by default they use the
// npm that ships with the current Node, which is what most users have (Node 22: npm 10).
const npmVersion = values.npm;
const npm = 'npm';
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const shell = process.platform === 'win32';

const tarballs = {};
for (const file of readdirSync(packs)) {
  const match = /^gixcopilot-(.+)-(\d+\.\d+\.\d+(?:-[\w.]+)?)\.tgz$/.exec(file);
  if (match) tarballs[`@gixcopilot/${match[1]}`] = `file:${join(packs, file).replaceAll('\\', '/')}`;
}
if (Object.keys(tarballs).length === 0) throw new Error(`No @gixcopilot tarballs in ${packs}`);

const root = mkdtempSync(join(tmpdir(), 'gix-consumers-'));
const results = [];
const run = (cwd, command, args, extraEnv = {}) =>
  execFileSync(command === npm ? (npmVersion ? NPX : NPM) : command, command === npm && npmVersion ? ['-y', `npm@${npmVersion}`, ...args] : args, { cwd, stdio: 'pipe', encoding: 'utf8', shell, env: { ...process.env, ...extraEnv, npm_config_audit: 'false', npm_config_fund: 'false' }, maxBuffer: 64 * 1024 * 1024 });

function project(name, pkg, files) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const sdk = Object.fromEntries(Object.entries(pkg.dependencies ?? {}).map(([dep, version]) => [dep, dep.startsWith('@gixcopilot/') ? tarballs[dep] ?? version : version]));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0', private: true, type: 'module', ...pkg, dependencies: sdk, overrides: tarballs }, null, 2));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, seconds: Math.round((Date.now() - started) / 1000), ...(detail ? { detail } : {}) });
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.split('\n').slice(-25).join('\n');
    results.push({ name, ok: false, error: error.message.split('\n')[0], output });
    console.log(`FAIL ${name}: ${error.message.split('\n')[0]}\n${output}`);
  }
}

const SERVER_LIBS = ['node_modules/openai', 'node_modules/pg/', 'node_modules/ioredis', 'node_modules/bullmq', 'node_modules/fastify', 'node_modules/drizzle-orm'];
function assertBrowserBundle(dir, outDir) {
  const files = [];
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|mjs)$/.test(name)) files.push(full);
    }
  };
  walk(join(dir, outDir));
  let bytes = 0;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    bytes += Buffer.byteLength(text);
    for (const lib of SERVER_LIBS) if (text.includes(lib)) throw new Error(`browser bundle includes ${lib} (${file})`);
    for (const marker of ['OPENAI_API_KEY', 'DATABASE_URL', 'new Pool(', 'createPostgresPersistence']) if (text.includes(marker)) throw new Error(`browser bundle contains server marker ${marker}`);
  }
  return `${Math.round(bytes / 1024)} kB JS, no server libraries`;
}

const TSCONFIG_NODE = JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, skipLibCheck: false, outDir: 'dist', rootDir: 'src', types: ['node'] }, include: ['src'] }, null, 2);

if (only.includes('node')) {
  await step('node consumer: install tarballs, typecheck (with library types), build, run, connect over HTTP', () => {
    const dir = project(
      'consumer-node',
      { scripts: { build: 'tsc -p tsconfig.json' }, dependencies: { '@gixcopilot/node': '*', '@gixcopilot/client': '*', '@gixcopilot/provider-mock': '*', '@gixcopilot/security': '*', '@gixcopilot/tools': '*', zod: '4.6.5' }, devDependencies: { typescript: '5.9.3', '@types/node': '22.20.3' } },
      {
        'tsconfig.json': TSCONFIG_NODE,
        'src/main.ts': `import { z } from 'zod';
import { createCopilot } from '@gixcopilot/node';
import { createCopilotClient } from '@gixcopilot/client';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createActionFirewall } from '@gixcopilot/security';
import { defineTool } from '@gixcopilot/tools';

const lookup = defineTool({ name: 'applications.get', description: 'Get', input: z.object({ id: z.string() }), security: { risk: 'read-only' }, execute: ({ id }) => Promise.resolve({ id }) });
const copilot = createCopilot({ model: { provider: 'mock', model: 'm' }, providers: [createMockProvider({ id: 'mock', scenario: { chunks: ['consumer', ' ok'] } })], tools: [lookup], security: { firewall: createActionFirewall() } });
const inProcess = await copilot.run('hi');
const url = await copilot.listen({ port: 0 });
let streamed = '';
for await (const event of createCopilotClient({ baseUrl: url }).run({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }).events) {
  if (event.type === 'message.delta') streamed += event.delta;
}
await copilot.close();
console.log(JSON.stringify({ inProcess: inProcess.text, streamed }));
`,
      },
    );
    run(dir, npm, ['install', '--no-package-lock']);
    run(dir, npm, ['run', 'build']);
    const output = JSON.parse(run(dir, 'node', ['dist/main.js']).trim().split('\n').pop());
    if (output.inProcess !== 'consumer ok' || output.streamed !== 'consumer ok') throw new Error(`unexpected output ${JSON.stringify(output)}`);
    return 'createCopilot in-process and over HTTP/SSE';
  });
}

if (only.includes('react')) {
  await step('react consumer: install tarballs, typecheck, vite build, SSR render, no server code in bundle', () => {
    const dir = project(
      'consumer-react',
      {
        scripts: { build: 'tsc -p tsconfig.json && vite build' },
        dependencies: { '@gixcopilot/react': '*', '@gixcopilot/ui': '*', react: '19.3.0', 'react-dom': '19.3.0' },
        devDependencies: { typescript: '5.9.3', vite: '8.3.0', '@types/react': '19.3.0', '@types/react-dom': '19.3.0', '@types/node': '22.20.3' },
      },
      {
        'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', strict: true, skipLibCheck: false, noEmit: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: [] }, include: ['src'] }, null, 2),
        'index.html': '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
        'src/app.tsx': `import { CopilotProvider, useCopilotChat } from '@gixcopilot/react';
import { CopilotChat } from '@gixcopilot/ui';

function Status() {
  const chat = useCopilotChat();
  return <p data-status={chat.status}>{chat.messages.length}</p>;
}

export function App() {
  return (
    <CopilotProvider runtimeUrl="/api/copilot">
      <Status />
      <CopilotChat />
    </CopilotProvider>
  );
}
`,
        'src/main.tsx': `import { createRoot } from 'react-dom/client';
import '@gixcopilot/ui/styles.css';
import { App } from './app.js';

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
`,
        'ssr.mjs': `import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { CopilotProvider } from '@gixcopilot/react';
import { CopilotChat } from '@gixcopilot/ui';
const html = renderToString(createElement(CopilotProvider, { runtimeUrl: '/api/copilot' }, createElement(CopilotChat)));
if (!html.includes('textarea') && !html.includes('input')) throw new Error('chat did not render');
console.log('rendered', html.length);
`,
      },
    );
    run(dir, npm, ['install', '--no-package-lock']);
    run(dir, npm, ['run', 'build']);
    run(dir, 'node', ['ssr.mjs']);
    return assertBrowserBundle(dir, 'dist');
  });
}

if (only.includes('angular')) {
  await step('angular consumer: install tarballs, provideCopilot, ng build (AOT), no server code in bundle', () => {
    const angular = '21.2.24';
    const dir = project(
      'consumer-angular',
      {
        scripts: { build: 'ng build' },
        dependencies: { '@gixcopilot/angular': '*', '@angular/common': angular, '@angular/compiler': angular, '@angular/core': angular, '@angular/platform-browser': angular, rxjs: '7.8.2', tslib: '^2.8.1', zod: '4.6.5' },
        devDependencies: { '@angular/build': angular, '@angular/cli': angular, '@angular/compiler-cli': angular, typescript: '5.9.3' },
      },
      {
        'angular.json': JSON.stringify({ version: 1, cli: { analytics: false }, newProjectRoot: '.', projects: { app: { projectType: 'application', root: '', sourceRoot: 'src', architect: { build: { builder: '@angular/build:application', options: { outputPath: 'web-dist', index: 'src/index.html', browser: 'src/main.ts', tsConfig: 'tsconfig.json' } } } } } }, null, 2),
        'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ES2022', moduleResolution: 'bundler', strict: true, experimentalDecorators: true, useDefineForClassFields: false, lib: ['ES2023', 'DOM'], skipLibCheck: false, outDir: 'out-tsc' }, angularCompilerOptions: { strictTemplates: true }, files: ['src/main.ts'] }, null, 2),
        'src/index.html': '<!doctype html><html><body><app-root></app-root></body></html>',
        'src/main.ts': `import { ChangeDetectionStrategy, Component, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { CopilotChatComponent, injectCopilot, provideCopilot } from '@gixcopilot/angular';

@Component({
  selector: 'app-root',
  imports: [CopilotChatComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<p>{{ copilot.status() }}</p><aicopilot-chat label="Copilot" />',
})
class AppComponent {
  protected readonly copilot = injectCopilot();
}

bootstrapApplication(AppComponent, { providers: [provideZonelessChangeDetection(), provideCopilot({ endpoint: '/api/copilot' })] }).catch((error: unknown) => console.error(error));
`,
      },
    );
    run(dir, npm, ['install', '--no-package-lock']);
    run(dir, npm, ['run', 'build'], { NG_CLI_ANALYTICS: 'false' });
    return assertBrowserBundle(dir, 'web-dist');
  });
}

if (only.includes('cli')) {
  const templates = (values.templates ?? 'node,enterprise,react,angular').split(',');
  const cliTarball = tarballs['@gixcopilot/cli'];
  const tools = project('cli-host', { dependencies: { '@gixcopilot/cli': '*' } }, {});
  await step('cli: install the packed CLI', () => {
    if (!cliTarball) throw new Error('no @gixcopilot/cli tarball');
    run(tools, npm, ['install', '--no-package-lock']);
    run(tools, npx, ['aicopilot', '--version']);
  });
  for (const template of templates) {
    await step(`cli E2E (${template}): init + add tool + add agent + install + typecheck + build + test`, () => {
      run(root, npx, ['--prefix', tools, 'aicopilot', 'init', `generated-${template}`, '--template', template, '--sdk-path', packs]);
      const dir = join(root, `generated-${template}`);
      run(dir, npx, ['--prefix', tools, 'aicopilot', 'add', 'tool', 'applications-get']);
      run(dir, npx, ['--prefix', tools, 'aicopilot', 'add', 'agent', 'support']);
      run(dir, npm, ['install', '--no-package-lock']);
      run(dir, npm, ['run', 'typecheck']);
      run(dir, npm, ['run', 'build'], { NG_CLI_ANALYTICS: 'false' });
      run(dir, npm, ['test']);
      if (template === 'react') return assertBrowserBundle(dir, 'web-dist');
      if (template === 'angular') return assertBrowserBundle(dir, 'web-dist');
      return 'generated project builds and its tests pass';
    });
  }
}

const failed = results.filter((result) => !result.ok);
writeFileSync(join(root, 'results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} consumer checks passed (workspace: ${root})`);
if (!values.keep && failed.length === 0) rmSync(root, { recursive: true, force: true });
process.exit(failed.length > 0 ? 1 : 0);
