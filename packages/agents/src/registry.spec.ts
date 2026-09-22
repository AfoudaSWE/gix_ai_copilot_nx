import { describe, expect, it } from 'vitest';
import { defineAgent } from './definition.js';
import { createAgentRegistry, validateAgentGraph } from './registry.js';

describe('createAgentRegistry', () => {
  it('registers, gets, lists, and unregisters agents', () => {
    const registry = createAgentRegistry();
    const agent = defineAgent({ id: 'support', name: 'Support', instructions: 'Help.' });

    registry.register(agent);
    expect(registry.has('support')).toBe(true);
    expect(registry.get('support')).toBe(agent);
    expect(registry.list()).toHaveLength(1);

    registry.unregister('support');
    expect(registry.has('support')).toBe(false);
    expect(registry.get('support')).toBeUndefined();
  });

  it('rejects a duplicate registration by default', () => {
    const registry = createAgentRegistry();
    const agent = defineAgent({ id: 'support', name: 'Support', instructions: 'Help.' });
    registry.register(agent);
    expect(() => registry.register(agent)).toThrow();
  });

  it('allows overwrite when explicitly configured', () => {
    const registry = createAgentRegistry({ allowOverwrite: true });
    const first = defineAgent({ id: 'support', name: 'Support v1', instructions: 'Help.' });
    const second = defineAgent({ id: 'support', name: 'Support v2', instructions: 'Help better.' });
    registry.register(first);
    registry.register(second);
    expect(registry.get('support')?.name).toBe('Support v2');
  });

  it('supports multiple independent registries with no shared global state', () => {
    const registryA = createAgentRegistry();
    const registryB = createAgentRegistry();
    registryA.register(defineAgent({ id: 'only-a', name: 'A', instructions: 'a' }));
    expect(registryA.has('only-a')).toBe(true);
    expect(registryB.has('only-a')).toBe(false);
  });

  it('clear() removes every registered agent', () => {
    const registry = createAgentRegistry();
    registry.register(defineAgent({ id: 'a', name: 'A', instructions: 'a' }));
    registry.register(defineAgent({ id: 'b', name: 'B', instructions: 'b' }));
    registry.clear();
    expect(registry.list()).toHaveLength(0);
  });
});

describe('validateAgentGraph', () => {
  it('passes when every delegation/handoff target is registered', () => {
    const registry = createAgentRegistry();
    registry.register(defineAgent({ id: 'a', name: 'A', instructions: 'a', delegation: { delegatesTo: ['b'], handoffTargets: ['c'] } }));
    registry.register(defineAgent({ id: 'b', name: 'B', instructions: 'b' }));
    registry.register(defineAgent({ id: 'c', name: 'C', instructions: 'c' }));
    expect(() => validateAgentGraph(registry)).not.toThrow();
  });

  it('throws when a delegation target is not registered', () => {
    const registry = createAgentRegistry();
    registry.register(defineAgent({ id: 'a', name: 'A', instructions: 'a', delegation: { delegatesTo: ['ghost'] } }));
    expect(() => validateAgentGraph(registry)).toThrow(/ghost/);
  });

  it('throws when a handoff target is not registered', () => {
    const registry = createAgentRegistry();
    registry.register(defineAgent({ id: 'a', name: 'A', instructions: 'a', delegation: { handoffTargets: ['ghost'] } }));
    expect(() => validateAgentGraph(registry)).toThrow(/ghost/);
  });
});
