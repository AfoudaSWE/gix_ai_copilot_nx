import { describe, expect, it } from 'vitest';
import { createModelProviderRegistry } from './registry.js';
import type { ModelProvider } from './model-provider.js';

function fakeProvider(id: string): ModelProvider {
  return {
    id,
    async *stream() {
      await Promise.resolve();
      yield { type: 'model.completed', finishReason: 'stop' };
    },
  };
}

describe('createModelProviderRegistry', () => {
  it('registers and retrieves a provider by id', () => {
    const registry = createModelProviderRegistry();
    const provider = fakeProvider('mock');
    registry.register(provider);
    expect(registry.get('mock')).toBe(provider);
  });

  it('accepts an initial list of providers', () => {
    const registry = createModelProviderRegistry([fakeProvider('a'), fakeProvider('b')]);
    expect([...registry.list()].sort()).toEqual(['a', 'b']);
  });

  it('returns undefined from get() for an unknown provider', () => {
    const registry = createModelProviderRegistry();
    expect(registry.get('unknown')).toBeUndefined();
  });

  it('require() throws a normalized MODEL_NOT_FOUND error for an unknown provider', () => {
    const registry = createModelProviderRegistry();
    expect(() => registry.require('unknown')).toThrow();
    expect(() => registry.require('unknown')).toThrow(
      expect.objectContaining({ code: 'MODEL_NOT_FOUND' }),
    );
  });

  it('rejects a duplicate registration under the same id', () => {
    const registry = createModelProviderRegistry();
    registry.register(fakeProvider('mock'));
    expect(() => registry.register(fakeProvider('mock'))).toThrow();
  });

  it('keeps separate registry instances fully isolated from each other', () => {
    const a = createModelProviderRegistry([fakeProvider('mock')]);
    const b = createModelProviderRegistry();
    expect(a.get('mock')).toBeDefined();
    expect(b.get('mock')).toBeUndefined();
  });
});
