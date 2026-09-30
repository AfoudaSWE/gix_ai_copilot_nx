import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import type { InitIo } from './init.js';
import type { InstallStep } from './plan.js';

export function writeFixture(root: string, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

export function createFixture(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'gix-sdk-'));
  writeFixture(root, files);
  return root;
}

export function removeFixture(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

/** Includes ignored and secret files, so read-only checks cover the whole fixture. */
export function snapshot(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else result[relative(root, path).split('\\').join('/')] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
  };
  walk(root);
  return result;
}

export function recordingIo(root: string, exitCode = 0): InitIo & { readonly output: string[]; readonly errors: string[]; readonly runs: { step: InstallStep; cwd: string }[] } {
  const output: string[] = [];
  const errors: string[] = [];
  const runs: { step: InstallStep; cwd: string }[] = [];
  return { cwd: root, env: {}, output, errors, runs, out: (line) => output.push(line), err: (line) => errors.push(line), run: (step, cwd) => { runs.push({ step, cwd }); return Promise.resolve(exitCode); } };
}

export const GIX_DEPENDENCIES: Readonly<Record<string, string>> = { '@gixcopilot/sdk': '0.2.3', '@gixcopilot/openapi': '0.2.3', '@gixcopilot/tools': '0.2.3', '@gixcopilot/protocol': '0.2.3', '@gixcopilot/security': '0.2.3', zod: '^4.0.0' };
export const ROOT_PACKAGE = JSON.stringify({ name: 'fixture', private: true, type: 'module', dependencies: GIX_DEPENDENCIES, devDependencies: { typescript: '5.9.3' } });
export const REACT_SOURCE = "import { createRoot } from 'react-dom/client';\nimport { App } from './App.js';\ncreateRoot(document.getElementById('root')).render(<App />);\n";
export const BACKEND_SOURCE = "import Fastify from 'fastify';\nconst app = Fastify();\napp.get('/orders', async () => []);\n";
export const NX_FIXTURE: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ name: 'fixture', private: true, type: 'module', dependencies: { ...GIX_DEPENDENCIES, react: '^19.0.0', fastify: '^5.0.0' }, devDependencies: { typescript: '5.9.3', vite: '^8.0.0' } }),
  'nx.json': '{}',
  'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
  'apps/web/project.json': JSON.stringify({ name: 'web', projectType: 'application' }),
  'apps/web/src/main.tsx': REACT_SOURCE,
  'apps/web/src/App.tsx': 'export function App() { return <main />; }\n',
  'apps/api/project.json': JSON.stringify({ name: 'api', projectType: 'application' }),
  'apps/api/src/main.ts': BACKEND_SOURCE,
};
export const REACT_FIXTURE: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify({ name: 'web', type: 'module', dependencies: { react: '^19.0.0', ...GIX_DEPENDENCIES }, devDependencies: { typescript: '5.9.3', vite: '^8.0.0' } }),
  'src/main.tsx': REACT_SOURCE,
  'src/App.tsx': 'export function App() { return <main />; }\n',
  'vite.config.ts': 'export default {};\n',
};
