import { describe, expect, it } from 'vitest';
import { CopilotError } from '@gixcopilot/protocol';
import { htmlSource } from '../source.js';
import { htmlLoader } from './html.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe('htmlLoader', () => {
  it('extracts structured text and title from inline HTML', async () => {
    const source = htmlSource({
      html: '<html><head><title>Product Docs</title></head><body><nav>skip</nav><h1>Getting Started</h1><p>Install the SDK.</p></body></html>',
      tenantId: 'tenant-a',
    });
    const [doc] = await collect(htmlLoader.load(source));
    expect(doc?.content).toContain('Getting Started');
    expect(doc?.content).toContain('Install the SDK.');
    expect(doc?.content).not.toContain('skip');
    expect(doc?.metadata.title).toBe('Product Docs');
    expect(doc?.metadata.mimeType).toBe('text/html');
    expect(doc?.metadata.tenantId).toBe('tenant-a');
  });

  it('prefers an explicit source name over the extracted title', async () => {
    const source = htmlSource({ name: 'Custom', html: '<title>Ignored</title><p>x</p>' });
    const [doc] = await collect(htmlLoader.load(source));
    expect(doc?.metadata.title).toBe('Custom');
  });

  it('rejects a source with neither html nor path', async () => {
    const source = htmlSource({});
    await expect(collect(htmlLoader.load(source))).rejects.toThrow(CopilotError);
  });

  it('produces nothing for content that normalizes to empty', async () => {
    const source = htmlSource({ html: '<script>only script content</script>' });
    const docs = await collect(htmlLoader.load(source));
    expect(docs).toHaveLength(0);
  });
});
