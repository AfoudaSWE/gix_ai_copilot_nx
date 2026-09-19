import { describe, expect, it } from 'vitest';
import { createDefaultContextSerializer } from './context-serializer.js';

describe('createDefaultContextSerializer', () => {
  const serializer = createDefaultContextSerializer({ maxStringLength: 20, maxArrayLength: 3, maxDepth: 3 });

  it('serializes primitives and plain objects as stable JSON', () => {
    const result = serializer.serialize({ id: 'APP-1', status: 'pending', count: 3, ok: true });
    expect(JSON.parse(result.text)).toEqual({ id: 'APP-1', status: 'pending', count: 3, ok: true });
    expect(result.truncated).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('omits undefined values but keeps null', () => {
    const result = serializer.serialize({ a: undefined, b: null });
    expect(JSON.parse(result.text)).toEqual({ b: null });
  });

  it('converts Date to an ISO string', () => {
    const result = serializer.serialize({ createdAt: new Date('2026-01-01T00:00:00.000Z') });
    expect(JSON.parse(result.text)).toEqual({ createdAt: '2026-01-01T00:00:00.000Z' });
  });

  it('converts bigint to a suffixed string', () => {
    const result = serializer.serialize({ big: 10n });
    expect(JSON.parse(result.text)).toEqual({ big: '10n' });
  });

  it('omits functions with a warning instead of throwing', () => {
    const result = serializer.serialize({ handler: () => undefined, value: 1 });
    expect(JSON.parse(result.text)).toEqual({ handler: '[Function omitted]', value: 1 });
    expect(result.warnings).toContain('function-omitted');
  });

  it('omits DOM-like nodes without importing a DOM library', () => {
    const fakeNode = { nodeType: 1, tagName: 'DIV' };
    const result = serializer.serialize({ el: fakeNode });
    expect(JSON.parse(result.text)).toEqual({ el: '[DOM node omitted]' });
    expect(result.warnings).toContain('dom-node-omitted');
  });

  it('breaks circular references instead of infinite-looping', () => {
    const value: Record<string, unknown> = { name: 'x' };
    value['self'] = value;
    const result = serializer.serialize(value);
    expect(JSON.parse(result.text)).toEqual({ name: 'x', self: '[Circular]' });
    expect(result.warnings).toContain('circular-reference');
  });

  it('normalizes class instances best-effort', () => {
    class Point {
      constructor(
        public x: number,
        public y: number,
      ) {}
    }
    const result = serializer.serialize(new Point(1, 2));
    expect(JSON.parse(result.text)).toEqual({ x: 1, y: 2 });
    expect(result.warnings).toContain('class-instance-normalized');
  });

  it('prefers toJSON when present', () => {
    const value = { toJSON: () => ({ shape: 'custom' }) };
    const result = serializer.serialize(value);
    expect(JSON.parse(result.text)).toEqual({ shape: 'custom' });
  });

  it('truncates oversized strings and marks truncated', () => {
    const result = serializer.serialize('x'.repeat(50));
    expect(result.truncated).toBe(true);
    expect(result.warnings).toContain('string-truncated');
    const parsed: unknown = JSON.parse(result.text);
    expect(typeof parsed).toBe('string');
    expect((parsed as string).length).toBeLessThan(50);
  });

  it('truncates oversized arrays and marks truncated', () => {
    const result = serializer.serialize([1, 2, 3, 4, 5]);
    expect(JSON.parse(result.text)).toEqual([1, 2, 3]);
    expect(result.truncated).toBe(true);
    expect(result.warnings).toContain('array-truncated');
  });

  it('caps recursion depth deterministically instead of stack-overflowing', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const result = serializer.serialize(deep);
    expect(result.truncated).toBe(true);
    expect(result.warnings).toContain('max-depth-exceeded');
  });

  it('never throws on adversarial input', () => {
    const weird: Record<string, unknown> = {};
    weird['sym'] = Symbol('x');
    weird['fn'] = function namedFn() {};
    weird['date'] = new Date();
    weird['re'] = /abc/g;
    expect(() => serializer.serialize(weird)).not.toThrow();
  });
});
