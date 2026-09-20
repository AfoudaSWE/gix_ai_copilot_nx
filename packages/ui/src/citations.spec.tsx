import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { CitationList } from './index.js';

afterEach(cleanup);
it('renders provenance as inert text without exposing internal source URLs', () => {
  const { container } = render(<CitationList citations={[{ id: 'S1', title: 'Handbook', page: 17,
    uri: 'https://internal.example/private?token=secret', excerpt: '<script>alert(1)</script>' }]} />);
  expect(screen.getByText('[S1] Handbook')).toBeDefined();
  expect(screen.getByText('Page 17')).toBeDefined();
  expect(container.querySelector('script')).toBeNull();
  expect(container.querySelector('a')).toBeNull();
  expect(container.innerHTML).not.toContain('token=secret');
});
