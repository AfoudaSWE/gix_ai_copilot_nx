import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useCitations } from './index.js';
import type { CitationData } from './index.js';

afterEach(cleanup);
it('selects known citations and drops stale response selections', () => {
  const citations: readonly CitationData[] = [{ id: 'S1', title: 'Handbook' }];
  const { result, rerender } = renderHook(({ items }) => useCitations(items), { initialProps: { items: citations } });
  act(() => result.current.select('S1'));
  expect(result.current.activeCitation?.title).toBe('Handbook');
  act(() => result.current.select('unknown'));
  expect(result.current.activeCitationId).toBeUndefined();
  act(() => result.current.select('S1'));
  rerender({ items: [] });
  expect(result.current.activeCitationId).toBeUndefined();
});
