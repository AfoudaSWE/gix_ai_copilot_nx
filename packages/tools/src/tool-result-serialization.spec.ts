import { describe, expect, it } from 'vitest';
import { serializeToolResult } from './tool-result-serialization.js';

describe('serializeToolResult', () => {
  it('passes plain JSON-safe values through unchanged', () => {
    const result = serializeToolResult({ a: 1, b: 'two' });
    expect(result).toEqual({ value: { a: 1, b: 'two' }, truncated: false });
  });

  it('converts a Date to an ISO string', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const result = serializeToolResult({ when: date });
    expect(result.value).toEqual({ when: '2026-01-01T00:00:00.000Z' });
  });

  it('replaces a circular reference with a marker instead of throwing', () => {
    const circular: Record<string, unknown> = { name: 'x' };
    circular['self'] = circular;
    const result = serializeToolResult(circular);
    expect(result.truncated).toBe(false);
    expect((result.value as { self: unknown }).self).toBe('[Circular]');
  });

  it('replaces a function value with a marker', () => {
    const result = serializeToolResult({ fn: () => 1 });
    expect(result.value).toEqual({ fn: '[Function]' });
  });

  it('truncates a result larger than maxResultBytes', () => {
    const result = serializeToolResult({ blob: 'x'.repeat(1000) }, { maxResultBytes: 20 });
    expect(result.truncated).toBe(true);
    expect(typeof (result.value as { preview: string }).preview).toBe('string');
  });
});
