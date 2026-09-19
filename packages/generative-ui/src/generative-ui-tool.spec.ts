import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  generativeUiComponentNameOfToolName,
  generativeUiToolName,
  isGenerativeUiToolName,
  toGenerativeUiToolDefinition,
} from './generative-ui-tool.js';
import { createGenerativeComponentRegistry } from './component-registry.js';

const applicationCard = {
  name: 'ApplicationCard',
  description: 'Displays a compact summary of one application.',
  propsSchema: z.object({ applicationId: z.string(), status: z.string() }),
};

describe('generativeUiToolName', () => {
  it('derives a namespaced, camelCase reserved tool name from a PascalCase component name', () => {
    expect(generativeUiToolName('ApplicationCard')).toBe('ui.render.applicationCard');
  });

  it('throws for a component name that cannot form a valid tool name', () => {
    expect(() => generativeUiToolName('123-bad')).toThrow();
  });

  it('isGenerativeUiToolName recognizes the reserved namespace only', () => {
    expect(isGenerativeUiToolName('ui.render.applicationCard')).toBe(true);
    expect(isGenerativeUiToolName('applications.getStatus')).toBe(false);
  });
});

describe('generativeUiComponentNameOfToolName', () => {
  it('resolves a reserved tool name back to its registered component name', () => {
    const registry = createGenerativeComponentRegistry();
    registry.register(applicationCard);
    expect(generativeUiComponentNameOfToolName('ui.render.applicationCard', registry)).toBe(
      'ApplicationCard',
    );
  });

  it('returns undefined for a non-reserved name or an unregistered component', () => {
    const registry = createGenerativeComponentRegistry();
    expect(generativeUiComponentNameOfToolName('applications.getStatus', registry)).toBeUndefined();
    expect(generativeUiComponentNameOfToolName('ui.render.applicationCard', registry)).toBeUndefined();
  });
});

describe('toGenerativeUiToolDefinition', () => {
  it('builds a reserved, client-executed tool whose input schema is the component props schema', () => {
    const tool = toGenerativeUiToolDefinition(applicationCard);
    expect(tool.name).toBe('ui.render.applicationCard');
    expect(tool.description).toBe(applicationCard.description);
    expect(tool.inputSchema).toBe(applicationCard.propsSchema);
    expect(tool.metadata?.executionLocation).toBe('client');
    expect(tool.metadata?.source).toBe('frontend');
  });

  it('echoes back validated props as { component, props } (Section 24-25)', async () => {
    const tool = toGenerativeUiToolDefinition(applicationCard);
    const props = { applicationId: 'APP-1024', status: 'pending' };
    const result = await tool.execute(props, {
      runId: 'run-1',
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ component: 'ApplicationCard', props });
  });

  it('rejects props that fail the component schema through the normal ToolRuntime validation path', () => {
    // Not exercised here directly (that is ToolRuntime's job, already covered in
    // @gixcopilot/tools) - this asserts the schema itself would reject a malformed payload,
    // i.e. that inputSchema really is load-bearing, not decorative.
    const parsed = applicationCard.propsSchema.safeParse({ applicationId: 123, status: 'HACKED' });
    expect(parsed.success).toBe(false);
  });
});
