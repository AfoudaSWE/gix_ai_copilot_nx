import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from '@gixcopilot/tools';
import { toGenerativeUiToolDefinition } from '@gixcopilot/generative-ui';
import {
  clearCopilotParts,
  createContextMessageResolver,
  createCopilotParts,
  createToolManifestResolver,
  toGenerativeUIRequests,
} from './index.js';

describe('@gixcopilot/headless parts', () => {
  it('sends nothing extra when nothing is registered (Phase 3 wire compatibility)', () => {
    const parts = createCopilotParts();
    expect(createContextMessageResolver(parts)()).toBeUndefined();
    expect(createToolManifestResolver(parts)()).toBeUndefined();
  });

  it('keeps each instance isolated and clears everything it owns', async () => {
    const a = createCopilotParts();
    const b = createCopilotParts();
    a.registry.register({ id: 'page', name: 'Page', scope: 'page', value: { route: '/a' } });
    a.toolRegistry.register(
      defineTool({ name: 'navigation.open', description: 'Open', input: z.object({}), execute: () => Promise.resolve({}) }),
    );
    expect(b.registry.list()).toHaveLength(0);
    expect(createToolManifestResolver(a)()?.map((tool) => tool.name)).toEqual(['navigation.open']);
    const resolved = await createContextMessageResolver(a)();
    expect(resolved?.items.map((item) => item.id)).toEqual(['page']);

    clearCopilotParts(a);
    expect(a.registry.list()).toHaveLength(0);
    expect(a.toolRegistry.list()).toHaveLength(0);
  });

  it('only projects tool calls for registered components into generative-UI requests', () => {
    const parts = createCopilotParts();
    const definition = { name: 'statusCard', description: 'Status', propsSchema: z.object({ id: z.string() }) };
    parts.generativeComponentRegistry.register(definition);
    const tool = toGenerativeUiToolDefinition(definition);
    const requests = toGenerativeUIRequests(
      [
        { id: 'c1', name: tool.name, source: 'frontend', status: 'succeeded', arguments: {}, result: { component: 'statusCard', props: { id: 'A' } } },
        { id: 'c2', name: 'ui.render.somethingElse', source: 'frontend', status: 'succeeded', arguments: {}, result: { component: 'x', props: {} } },
      ],
      parts.generativeComponentRegistry,
    );
    expect(requests).toEqual([{ id: 'c1', component: 'statusCard', status: 'succeeded', props: { id: 'A' }, error: undefined }]);
  });
});
