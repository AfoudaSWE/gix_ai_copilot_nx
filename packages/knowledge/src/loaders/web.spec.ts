import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopilotError } from '@gixcopilot/protocol';
import { webSource } from '../source.js';
import { webLoader } from './web.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

function jsonHeaders(contentType: string, extra: Record<string, string> = {}): Headers {
  return new Headers({ 'content-type': contentType, ...extra });
}

describe('webLoader', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches and normalizes an HTML response', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response('<title>Docs</title><h1>Guide</h1><p>Read this.</p>', {
          status: 200,
          headers: jsonHeaders('text/html'),
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const source = webSource({ url: 'https://93.184.216.34/guide', tenantId: 'tenant-a' });
    const [doc] = await collect(webLoader.load(source));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(doc?.content).toContain('Guide');
    expect(doc?.content).toContain('Read this.');
    expect(doc?.metadata.title).toBe('Docs');
    expect(doc?.metadata.uri).toBe('https://93.184.216.34/guide');
    expect(doc?.metadata.tenantId).toBe('tenant-a');
  });

  it('treats a non-HTML response as plain text', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('plain body text', { status: 200, headers: jsonHeaders('text/plain') })));
    vi.stubGlobal('fetch', fetchMock);

    const source = webSource({ url: 'https://93.184.216.34/plain' });
    const [doc] = await collect(webLoader.load(source));
    expect(doc?.content).toBe('plain body text');
  });

  it('never calls fetch for a disallowed (private-range) URL - the SSRF guard runs first', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const source = webSource({ url: 'http://169.254.169.254/latest/meta-data' });
    await expect(collect(webLoader.load(source))).rejects.toThrow(CopilotError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces a non-2xx response as a normalized error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('nope', { status: 404 }))));
    const source = webSource({ url: 'https://93.184.216.34/missing' });
    await expect(collect(webLoader.load(source))).rejects.toThrow(CopilotError);
  });

  it('rejects a response declaring content-length over the byte limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('x', { status: 200, headers: jsonHeaders('text/plain', { 'content-length': '999999999' }) }))),
    );
    const source = webSource({ url: 'https://93.184.216.34/huge', maxBytes: 1000 });
    await expect(collect(webLoader.load(source))).rejects.toThrow(CopilotError);
  });

  it('rejects an invalid URL without attempting a fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const source = webSource({ url: 'not a url' });
    await expect(collect(webLoader.load(source))).rejects.toThrow(CopilotError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
