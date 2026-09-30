import { linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import type * as NodeFs from 'node:fs';
import { dirname, join } from 'node:path';
import { WorkspaceViolationError } from '@gixcopilot/studio';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFixture, NX_FIXTURE, recordingIo, removeFixture, snapshot, writeFixture } from './fixtures.spec-helper.js';
import { runInit } from './init.js';

const roots: string[] = [];
const simulatedLinks = vi.hoisted(() => new Set<string>());
const filesystemFaults = vi.hoisted(() => ({ failMetadataRename: false }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof NodeFs>();
  return {
    ...fs,
    renameSync: (from: string, to: string) => {
      if (filesystemFaults.failMetadataRename && to.endsWith('manifest.json')) throw new Error('test denied metadata rename');
      fs.renameSync(from, to);
    },
    lstatSync: (path: string) => {
      const stat = fs.lstatSync(path);
      if (!simulatedLinks.has(path)) return stat;
      return new Proxy(stat, { get(target, key, receiver): unknown {
        if (key === 'isSymbolicLink') return () => true;
        if (key === 'nlink') return 1;
        return Reflect.get(target, key, receiver);
      } });
    },
  };
});

/** Windows without symlink privilege: preserve a real alias, simulate only the link's stat. */
function fileSymlink(target: string, path: string, dangling = false): void {
  try { symlinkSync(target, path, 'file'); }
  catch (error) {
    if (process.platform !== 'win32' || !(error instanceof Error) || !('code' in error) || error.code !== 'EPERM') throw error;
    if (dangling) writeFileSync(path, 'simulated dangling symlink');
    else linkSync(target, path);
    simulatedLinks.add(path);
  }
}
function fixture(): string {
  const root = createFixture({ ...NX_FIXTURE, 'src/main.ts': '// application source must never change\n', '.env': 'OPENAI_API_KEY=fake-private-test-value\n' });
  roots.push(root);
  return root;
}
afterEach(() => {
  simulatedLinks.clear();
  filesystemFaults.failMetadataRename = false;
  for (const root of roots.splice(0)) removeFixture(root);
});

const cases = ['.gix/discovery.json', '.gix/manifest.json'].flatMap((path) => ['src/main.ts', '.env'].map((target) => ({ path, target })));

describe('init metadata path security', () => {
  it.each(cases)('rejects a $path symlink to $target without changing any files', async ({ path, target }) => {
    const root = fixture();
    mkdirSync(dirname(join(root, path)), { recursive: true });
    fileSymlink(join(root, target), join(root, path));
    const before = snapshot(root);
    const io = recordingIo(root);
    await expect(runInit(io)).rejects.toThrow(WorkspaceViolationError);
    expect(io.runs).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });

  it.each(cases)('rejects a $path hardlink to $target without changing either entry', async ({ path, target }) => {
    const root = fixture();
    mkdirSync(dirname(join(root, path)), { recursive: true });
    linkSync(join(root, target), join(root, path));
    const before = snapshot(root);
    const io = recordingIo(root);
    await expect(runInit(io)).rejects.toThrow(WorkspaceViolationError);
    expect(io.runs).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });

  it('rejects a dangling metadata symlink before bootstrapping', async () => {
    const root = fixture();
    mkdirSync(join(root, '.gix'));
    fileSymlink(join(root, 'src/missing.ts'), join(root, '.gix/discovery.json'), true);
    const io = recordingIo(root);
    await expect(runInit(io)).rejects.toThrow(WorkspaceViolationError);
    expect(io.runs).toEqual([]);
    expect(readdirSync(join(root, 'src'))).toEqual(['main.ts']);
    expect(readdirSync(join(root, '.gix'))).toEqual(['discovery.json']);
    expect(readdirSync(root)).not.toContain('gix');
  });

  it('rejects a redirected .gix parent even when it points inside the workspace', async () => {
    const root = fixture();
    writeFixture(root, { 'src/manifest.json': '{}\n', 'src/discovery.json': '{}\n' });
    symlinkSync(join(root, 'src'), join(root, '.gix'), process.platform === 'win32' ? 'junction' : 'dir');
    const before = snapshot(join(root, 'src'));
    const io = recordingIo(root);
    await expect(runInit(io)).rejects.toThrow(WorkspaceViolationError);
    expect(io.runs).toEqual([]);
    expect(snapshot(join(root, 'src'))).toEqual(before);
    expect(readdirSync(root)).not.toContain('gix');
  });

  it('rechecks metadata after an install callback changes a destination', async () => {
    const root = fixture();
    const before = readFileSync(join(root, '.env'), 'utf8');
    const io = recordingIo(root);
    await expect(runInit({ ...io, run: () => {
      mkdirSync(join(root, '.gix'), { recursive: true });
      fileSymlink(join(root, '.env'), join(root, '.gix/discovery.json'));
      return Promise.resolve(0);
    } })).rejects.toThrow(WorkspaceViolationError);
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(before);
    expect(readdirSync(join(root, '.gix')).filter((name) => name !== 'proposals')).toEqual(['discovery.json']);
    expect(readdirSync(join(root, '.gix/proposals'))).toEqual([]);
    expect(readdirSync(root)).not.toContain('gix');
  });

  it('atomically updates regular metadata on repeat init without touching app files', async () => {
    const root = fixture();
    const io = recordingIo(root);
    const first = await runInit(io, { install: false });
    const manifestPath = join(root, '.gix/manifest.json');
    const discoveryPath = join(root, '.gix/discovery.json');
    const oldManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    oldManifest['updatedAt'] = 'old-value';
    writeFileSync(manifestPath, JSON.stringify(oldManifest));
    writeFixture(root, { 'apps/api/src/customers.ts': "import Fastify from 'fastify';\nconst app = Fastify();\napp.get('/customers', async () => []);\n" });
    const sourceBefore = snapshot(join(root, 'apps'));
    const secretBefore = readFileSync(join(root, '.env'), 'utf8');
    // A new inode distinguishes atomic replacement from a direct, truncating write.
    const manifestInode = lstatSync(manifestPath).ino;
    const discoveryInode = lstatSync(discoveryPath).ino;
    const second = await runInit(io, { install: false });
    expect(lstatSync(manifestPath).ino).not.toBe(manifestInode);
    expect(lstatSync(discoveryPath).ino).not.toBe(discoveryInode);
    expect(second.created).toEqual([]);
    expect(second.proposals).toEqual([]);
    expect(second.manifest?.createdAt).toBe(first.manifest?.createdAt);
    expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toEqual(second.manifest);
    expect(second.manifest?.updatedAt).not.toBe('old-value');
    expect((JSON.parse(readFileSync(discoveryPath, 'utf8')) as { operations: unknown[] }).operations).toHaveLength(2);
    expect(snapshot(join(root, 'apps'))).toEqual(sourceBefore);
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe(secretBefore);
    expect(readdirSync(join(root, '.gix')).filter((name) => name.startsWith('.metadata-'))).toEqual([]);
  });

  it('preserves existing metadata and cleans temporary files when atomic replacement fails', async () => {
    const root = fixture();
    const io = recordingIo(root);
    await runInit(io, { install: false });
    const before = snapshot(root);
    filesystemFaults.failMetadataRename = true;
    await expect(runInit(io, { install: false })).rejects.toThrow('test denied metadata rename');
    expect(snapshot(root)).toEqual(before);
  });
});
