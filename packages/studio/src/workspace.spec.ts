import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createToolRegistry, defineTool } from '@gixcopilot/tools';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createFixture, removeFixture } from './fixtures.spec-helper.js';
import { assertApplicationPlane, DEVELOPMENT_AGENTS, DEVELOPMENT_SKILLS, DEVELOPMENT_TOOLS, isDevelopmentAgentOrSkill, isDevelopmentToolName, PlaneViolationError } from './planes.js';
import { createWorkspaceGuard, isSecretPath, WorkspaceViolationError } from './workspace/guard.js';
import { createReadonlyWorkspace, parseIgnoreFile, SecretFileError } from './workspace/workspace.js';

const roots: string[] = [];
const fixture = (files: Record<string, string>): string => {
  const root = createFixture(files);
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) removeFixture(root);
});

describe('development vs application plane (ADR 0023)', () => {
  it('catalogs every development capability on the development plane', () => {
    for (const capability of [...DEVELOPMENT_TOOLS, ...DEVELOPMENT_AGENTS, ...DEVELOPMENT_SKILLS]) expect(capability.plane).toBe('development');
  });

  it('keeps repo, shell and git tools out of an application tool registry', () => {
    for (const name of ['repo.readFile', 'repo.search', 'repo.applyPatch', 'shell.run', 'git.commit', 'project.detect', 'api.discover']) expect(isDevelopmentToolName(name)).toBe(true);
    const registry = createToolRegistry();
    registry.register(defineTool({ name: 'applications.list', description: 'List', input: z.object({}), execute: () => Promise.resolve([]) }));
    expect(() => assertApplicationPlane(registry)).not.toThrow();
    registry.register(defineTool({ name: 'repo.readFile', description: 'Leaked', input: z.object({}), execute: () => Promise.resolve('') }));
    expect(() => assertApplicationPlane(registry)).toThrow(PlaneViolationError);
  });

  it('does not treat application tools that share a word with a development tool as development tools', () => {
    expect(isDevelopmentToolName('applications.list')).toBe(false);
    expect(isDevelopmentToolName('api.listCustomers')).toBe(false);
  });

  it('keeps development agents and skills distinct from application ones', () => {
    expect(isDevelopmentAgentOrSkill('project-discovery')).toBe(true);
    expect(isDevelopmentAgentOrSkill('tool-security-review')).toBe(true);
    expect(isDevelopmentAgentOrSkill('application-assistant')).toBe(false);
  });
});

describe('workspace guard (§54)', () => {
  it('blocks parent traversal, absolute paths, NUL bytes and protected directories', () => {
    const guard = createWorkspaceGuard(fixture({ 'a.txt': 'a' }));
    for (const path of ['../evil.ts', '../../etc/passwd', 'src/../../x', '/etc/passwd', 'C:\\Windows\\win.ini', '\\\\server\\share', 'a\0b', '.git/config', 'node_modules/x/index.js', '.ssh/id_rsa', '']) {
      expect(() => guard.resolve(path), path).toThrow(WorkspaceViolationError);
    }
    expect(guard.resolve('src/new/file.ts')).toContain('file.ts');
  });

  it('blocks a symbolic link that points outside the workspace', () => {
    const outside = fixture({ 'secret.txt': 'outside' });
    const root = fixture({ 'a.txt': 'a' });
    try {
      symlinkSync(outside, join(root, 'escape'), 'junction');
    } catch {
      return; // Symlinks need extra privileges on some Windows setups; the lexical checks still apply.
    }
    const guard = createWorkspaceGuard(root);
    expect(() => guard.resolve('escape/secret.txt')).toThrow(/symbolic link/);
  });

  it('refuses the home directory or a filesystem root as the workspace', () => {
    expect(() => createWorkspaceGuard(homedir())).toThrow(WorkspaceViolationError);
    expect(() => createWorkspaceGuard(process.platform === 'win32' ? 'C:\\' : '/')).toThrow(WorkspaceViolationError);
  });
});

describe('read-only workspace (§24)', () => {
  it('recognizes the default secret exclusions', () => {
    for (const name of ['.env', '.env.local', 'server.pem', 'tls.key', 'id_rsa', 'id_ed25519', 'credentials.json', 'secrets.yaml']) expect(isSecretPath(`x/${name}`), name).toBe(true);
    for (const name of ['env.ts', 'keys.ts', 'README.md']) expect(isSecretPath(name), name).toBe(false);
  });

  it('never reads a secret file, even when asked directly', async () => {
    const workspace = createReadonlyWorkspace(fixture({ '.env': 'OPENAI_API_KEY=x', 'config/secrets.json': '{}' }));
    await expect(workspace.readText('.env')).rejects.toThrow(SecretFileError);
    await expect(workspace.hash('config/secrets.json')).rejects.toThrow(SecretFileError);
  });

  it('skips node_modules, build output, .git, gitignored and secret files while walking', async () => {
    const root = fixture({ 'src/a.ts': '', 'node_modules/p/i.js': '', 'dist/x.js': '', '.git/HEAD': '', 'out/y.js': '', 'tmp/z.ts': '', 'debug.log': '', '.env': 'x', '.gitignore': 'tmp/\n*.log\n' });
    const listing = await createReadonlyWorkspace(root).listFiles();
    expect(listing.files.map((file) => file.path).sort()).toEqual(['.gitignore', 'src/a.ts']);
    expect(listing.skippedSecrets).toBe(1);
  });

  it('bounds the result count and the file size', async () => {
    const files: Record<string, string> = { 'big.ts': 'x'.repeat(2048) };
    for (let index = 0; index < 30; index += 1) files[`f${String(index).padStart(2, '0')}.ts`] = '';
    const workspace = createReadonlyWorkspace(fixture(files), { maxFiles: 10, maxFileBytes: 1024 });
    const listing = await workspace.listFiles();
    expect(listing.files).toHaveLength(10);
    expect(listing.truncated).toBe(true);
    expect(await workspace.readText('big.ts')).toBeUndefined();
  });

  it('supports cancellation', async () => {
    const workspace = createReadonlyWorkspace(fixture({ 'a.ts': '' }));
    const controller = new AbortController();
    controller.abort();
    await expect(workspace.listFiles({ signal: controller.signal })).rejects.toThrow();
  });

  it('parses basic .gitignore rules', () => {
    const ignored = parseIgnoreFile('# comment\n/build\n*.tmp\ncache/\ndocs/**/draft.md\n!keep.tmp\n');
    expect(ignored('build', true)).toBe(true);
    expect(ignored('src/build', true)).toBe(false);
    expect(ignored('a/b/c.tmp', false)).toBe(true);
    expect(ignored('x/cache', true)).toBe(true);
    expect(ignored('x/cache', false)).toBe(false);
    expect(ignored('docs/a/b/draft.md', false)).toBe(true);
  });

  it('writes nothing: the type has no write method', () => {
    const root = fixture({});
    mkdirSync(join(root, 'x'));
    writeFileSync(join(root, 'x', 'a.ts'), '');
    const workspace = createReadonlyWorkspace(root) as unknown as Record<string, unknown>;
    for (const method of ['write', 'writeFile', 'remove', 'delete', 'apply']) expect(workspace[method]).toBeUndefined();
  });
});
