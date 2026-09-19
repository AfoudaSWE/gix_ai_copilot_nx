import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from './define-tool.js';

describe('defineTool', () => {
  it('infers typed input/output from the given Zod schemas', async () => {
    const tool = defineTool({
      name: 'math.add',
      description: 'Add two numbers.',
      input: z.object({ a: z.number(), b: z.number() }),
      output: z.object({ result: z.number() }),
      async execute(input, context) {
        await Promise.resolve();
        // Compiles only if `input` is typed { a: number; b: number }, not `any`/`unknown`.
        const sum: number = input.a + input.b;
        expect(context.signal).toBeInstanceOf(AbortSignal);
        return { result: sum };
      },
    });

    const result = await tool.execute(
      { a: 1, b: 2 },
      { runId: 'run-1', signal: new AbortController().signal },
    );
    expect(result).toEqual({ result: 3 });
  });

  it('allows omitting an output schema', () => {
    const tool = defineTool({
      name: 'echo',
      description: 'Echo the input.',
      input: z.object({ text: z.string() }),
      execute({ text }) {
        return Promise.resolve(text);
      },
    });
    expect(tool.outputSchema).toBeUndefined();
  });

  it('rejects an invalid tool name at definition time', () => {
    expect(() =>
      defineTool({
        name: 'Not A Valid Name!',
        description: 'x',
        input: z.object({}),
        execute() {
          return Promise.resolve(undefined);
        },
      }),
    ).toThrow(/Invalid tool name/);
  });

  it('accepts a namespaced dot name', () => {
    const tool = defineTool({
      name: 'applications.getStatus',
      description: 'x',
      input: z.object({ applicationId: z.string() }),
      execute({ applicationId }) {
        return Promise.resolve({ applicationId, status: 'PENDING' });
      },
    });
    expect(tool.name).toBe('applications.getStatus');
  });

  it('carries through metadata and enabled', () => {
    const tool = defineTool({
      name: 'x',
      description: 'x',
      input: z.object({}),
      metadata: { readOnly: true, category: 'demo' },
      enabled: () => false,
      execute() {
        return Promise.resolve(undefined);
      },
    });
    expect(tool.metadata).toEqual({ readOnly: true, category: 'demo' });
    expect(typeof tool.enabled).toBe('function');
  });
});
