import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileSource } from '../source.js';
import { fileLoader } from './file.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe('fileLoader', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gixcopilot-knowledge-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('dispatches .txt files to plain text handling', async () => {
    const path = join(dir, 'notes.txt');
    await writeFile(path, 'hello from disk', 'utf8');
    const [doc] = await collect(fileLoader.load(fileSource({ path, tenantId: 'tenant-a' })));
    expect(doc?.content).toBe('hello from disk');
    expect(doc?.metadata.mimeType).toBe('text/plain');
    expect(doc?.metadata.tenantId).toBe('tenant-a');
  });

  it('dispatches .md files to markdown handling, preserving heading-derived title', async () => {
    const path = join(dir, 'policy.md');
    await writeFile(path, '# Travel Policy\n\nBook two weeks ahead.', 'utf8');
    const [doc] = await collect(fileLoader.load(fileSource({ path })));
    expect(doc?.metadata.title).toBe('Travel Policy');
    expect(doc?.metadata.mimeType).toBe('text/markdown');
  });

  it('dispatches .html files to HTML structure extraction', async () => {
    const path = join(dir, 'page.html');
    await writeFile(path, '<title>Docs</title><p>Hello</p>', 'utf8');
    const [doc] = await collect(fileLoader.load(fileSource({ path })));
    expect(doc?.metadata.title).toBe('Docs');
    expect(doc?.content).toBe('Hello');
  });

  it('falls back to plain-text reading for an unrecognized extension', async () => {
    const path = join(dir, 'data.log');
    await writeFile(path, 'log line one', 'utf8');
    const [doc] = await collect(fileLoader.load(fileSource({ path })));
    expect(doc?.content).toBe('log line one');
    expect(doc?.metadata.uri).toBe(path);
  });
});
