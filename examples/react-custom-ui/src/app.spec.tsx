import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './app.js';

describe('headless example', () => {
  it('renders on the server without the UI package or a network request', () => {
    const html = renderToString(<App />);
    expect(html).toContain('A conversation on your terms.');
    expect(html).toContain('Your message');
    expect(html).toContain('idle');
  });
});
