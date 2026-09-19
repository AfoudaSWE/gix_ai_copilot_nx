import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRunId } from '@gixcopilot/protocol';
import { defineTool } from './define-tool.js';
import { createToolRegistry } from './tool-registry.js';
import {
  combineToolResolvers,
  createDefaultToolResolver,
  createStaticToolResolver,
} from './tool-resolver.js';

function tool(name: string, enabled?: boolean) {
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

describe('createDefaultToolResolver', () => {
  it('resolves only currently-enabled tools from the registry', async () => {
    const registry = createToolRegistry();
    registry.register(tool('on'));
    registry.register(tool('off', false));
    const resolver = createDefaultToolResolver(registry);
    const resolved = await resolver.resolve({ runId: createRunId() });
    expect(resolved.map((t) => t.name)).toEqual(['on']);
  });
});

describe('combineToolResolvers', () => {
  it('merges resolvers with first-resolver-wins de-duplication by name', async () => {
    const a = createStaticToolResolver([tool('shared'), tool('onlyA')]);
    const b = createStaticToolResolver([tool('shared'), tool('onlyB')]);
    const combined = combineToolResolvers(a, b);
    const resolved = await combined.resolve({ runId: createRunId() });
    expect(resolved.map((t) => t.name).sort()).toEqual(['onlyA', 'onlyB', 'shared']);
  });
});
