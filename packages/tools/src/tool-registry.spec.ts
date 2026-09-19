import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineTool } from './define-tool.js';
import { createToolRegistry } from './tool-registry.js';
import { isToolEnabled } from './tool-definition.js';

function makeTool(name: string, enabled?: boolean | (() => boolean)) {
  return defineTool({
    name,
    description: 'x',
    input: z.object({}),
    enabled,
    execute() {
      return Promise.resolve(undefined);
    },
  });
}

describe('createToolRegistry', () => {
  it('registers, lists, and looks up a tool by name', () => {
    const registry = createToolRegistry();
    registry.register(makeTool('math.add'));
    expect(registry.has('math.add')).toBe(true);
    expect(registry.get('math.add')?.name).toBe('math.add');
    expect(registry.list().map((t) => t.name)).toEqual(['math.add']);
  });

  it('rejects registering a duplicate name by default', () => {
    const registry = createToolRegistry();
    registry.register(makeTool('math.add'));
    expect(() => registry.register(makeTool('math.add'))).toThrow(/already registered/);
  });

  it('allows an explicit replace of a duplicate name', () => {
    const registry = createToolRegistry();
    registry.register(makeTool('math.add'));
    expect(() => registry.register(makeTool('math.add'), { replace: true })).not.toThrow();
    expect(registry.list()).toHaveLength(1);
  });

  it('unregister and dispose() are both idempotent and remove the tool', () => {
    const registry = createToolRegistry();
    const registration = registry.register(makeTool('math.add'));
    registration.dispose();
    registration.dispose();
    expect(registry.has('math.add')).toBe(false);

    registry.register(makeTool('math.sub'));
    registry.unregister('math.sub');
    registry.unregister('math.sub');
    expect(registry.has('math.sub')).toBe(false);
  });

  it('update() replaces the definition in place under the same registration', () => {
    const registry = createToolRegistry();
    const registration = registry.register(makeTool('math.add'));
    const replacement = makeTool('math.add');
    registration.update(replacement);
    expect(registry.get('math.add')).toBe(replacement);
  });

  it('list({ enabledOnly }) semantics are enforced by isToolEnabled, not the registry itself', () => {
    const registry = createToolRegistry();
    registry.register(makeTool('always.on'));
    registry.register(makeTool('always.off', false));
    registry.register(makeTool('conditional', () => true));

    const enabledNames = registry
      .list()
      .filter(isToolEnabled)
      .map((t) => t.name);
    expect(enabledNames.sort()).toEqual(['always.on', 'conditional']);
  });

  it('filters by category and tags', () => {
    const registry = createToolRegistry();
    registry.register(
      defineTool({
        name: 'applications.get',
        description: 'x',
        input: z.object({}),
        metadata: { category: 'applications', tags: ['read'] },
        execute() {
          return Promise.resolve(undefined);
        },
      }),
    );
    registry.register(
      defineTool({
        name: 'payments.get',
        description: 'x',
        input: z.object({}),
        metadata: { category: 'payments', tags: ['read', 'money'] },
        execute() {
          return Promise.resolve(undefined);
        },
      }),
    );

    expect(registry.list({ category: 'applications' }).map((t) => t.name)).toEqual([
      'applications.get',
    ]);
    expect(registry.list({ tags: ['money'] }).map((t) => t.name)).toEqual(['payments.get']);
  });

  it('notifies subscribers on register/unregister/clear', () => {
    const registry = createToolRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);

    registry.register(makeTool('a'));
    registry.unregister('a');
    registry.clear();
    expect(listener).toHaveBeenCalledTimes(2); // clear() on an already-empty registry is a no-op

    unsubscribe();
    registry.register(makeTool('b'));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('supports multiple independent registry instances', () => {
    const a = createToolRegistry();
    const b = createToolRegistry();
    a.register(makeTool('only.in.a'));
    expect(a.has('only.in.a')).toBe(true);
    expect(b.has('only.in.a')).toBe(false);
  });

  it('rejects an invalid tool name', () => {
    const registry = createToolRegistry();
    expect(() =>
      registry.register({
        name: 'Not Valid',
        description: 'x',
        inputSchema: z.object({}),
        execute() {
          return Promise.resolve(undefined);
        },
      }),
    ).toThrow(/Invalid tool name/);
  });
});
