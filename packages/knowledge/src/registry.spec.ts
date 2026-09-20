import { describe, expect, it } from 'vitest';
import { CopilotError } from '@gixcopilot/protocol';
import { createKnowledgeSourceRegistry } from './registry.js';
import { textSource } from './source.js';

describe('createKnowledgeSourceRegistry', () => {
  it('registers, lists, gets, and removes sources', () => {
    const registry = createKnowledgeSourceRegistry();
    const source = textSource({ id: 's1', content: 'hello' });
    registry.register(source);

    expect(registry.get('s1')).toEqual(source);
    expect(registry.list()).toEqual([source]);

    registry.remove('s1');
    expect(registry.get('s1')).toBeUndefined();
    expect(registry.list()).toEqual([]);
  });

  it('rejects duplicate ids', () => {
    const registry = createKnowledgeSourceRegistry();
    registry.register(textSource({ id: 's1', content: 'a' }));
    expect(() => registry.register(textSource({ id: 's1', content: 'b' }))).toThrow(CopilotError);
  });

  it('accepts an initial set of sources', () => {
    const source = textSource({ id: 's1', content: 'hello' });
    const registry = createKnowledgeSourceRegistry([source]);
    expect(registry.list()).toEqual([source]);
  });

  it('remove is a no-op for an unknown id', () => {
    const registry = createKnowledgeSourceRegistry();
    expect(() => registry.remove('missing')).not.toThrow();
  });
});
