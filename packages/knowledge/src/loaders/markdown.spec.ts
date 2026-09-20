import { describe, expect, it } from 'vitest';
import { markdownSource } from '../source.js';
import { extractMarkdownTitle, markdownLoader } from './markdown.js';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iter) out.push(item);
  return out;
}

describe('extractMarkdownTitle', () => {
  it('extracts the first ATX heading', () => {
    expect(extractMarkdownTitle('# Employee Handbook\n\nSome text')).toBe('Employee Handbook');
  });

  it('returns undefined when there is no heading', () => {
    expect(extractMarkdownTitle('just text')).toBeUndefined();
  });
});

describe('markdownLoader', () => {
  it('falls back to the first heading as the title when name is not given', async () => {
    const source = markdownSource({ content: '# Travel Policy\n\nDetails here.' });
    const [doc] = await collect(markdownLoader.load(source));
    expect(doc?.metadata.title).toBe('Travel Policy');
    expect(doc?.metadata.mimeType).toBe('text/markdown');
  });

  it('prefers an explicit source name over the extracted heading', async () => {
    const source = markdownSource({ name: 'Custom Title', content: '# Heading\n\nbody' });
    const [doc] = await collect(markdownLoader.load(source));
    expect(doc?.metadata.title).toBe('Custom Title');
  });

  it('produces no title when neither is available', async () => {
    const source = markdownSource({ content: 'no heading here' });
    const [doc] = await collect(markdownLoader.load(source));
    expect(doc?.metadata.title).toBeUndefined();
  });
});
