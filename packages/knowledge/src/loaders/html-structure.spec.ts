import { describe, expect, it } from 'vitest';
import { extractHtmlStructure } from './html-structure.js';

describe('extractHtmlStructure', () => {
  it('extracts the <title> tag', () => {
    const result = extractHtmlStructure('<html><head><title>Product Docs</title></head><body><p>hi</p></body></html>');
    expect(result.title).toBe('Product Docs');
  });

  it('falls back to the first heading when there is no <title> tag', () => {
    const result = extractHtmlStructure('<body><h1>Travel Policy</h1><p>Body text</p></body>');
    expect(result.title).toBe('Travel Policy');
  });

  it('strips script/style/nav/header/footer noise (Section 20)', () => {
    const result = extractHtmlStructure(
      '<body><script>evil()</script><style>.a{}</style><nav>Home | About</nav><header>Site Header</header><p>Real content</p><footer>copyright</footer></body>',
    );
    expect(result.text).toBe('Real content');
  });

  it('preserves headings as markdown-style prefixes', () => {
    const result = extractHtmlStructure('<body><h1>Title</h1><h2>Subtitle</h2><p>Body</p></body>');
    expect(result.text).toBe('# Title\n\n## Subtitle\n\nBody');
  });

  it('serializes a table with a header row deterministically (Section 33)', () => {
    const result = extractHtmlStructure(
      '<body><table><tr><th>Name</th><th>Days</th></tr><tr><td>Alice</td><td>25</td></tr></table></body>',
    );
    expect(result.text).toContain('Name | Days');
    expect(result.text).toContain('--- | ---');
    expect(result.text).toContain('Alice | 25');
  });

  it('produces no title when there is neither a <title> tag nor a heading', () => {
    const result = extractHtmlStructure('<body><p>Just a paragraph.</p></body>');
    expect(result.title).toBeUndefined();
  });
});
