import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from './define-tool.js';
import { toToolManifest, toToolManifestEntry } from './tool-schema.js';

describe('toToolManifestEntry', () => {
  it('converts a tool definition into a JSON-Schema manifest entry', () => {
    const tool = defineTool({
      name: 'applications.getStatus',
      description: 'Get an application status.',
      input: z.object({ applicationId: z.string() }),
      execute({ applicationId }) {
        return Promise.resolve({ applicationId, status: 'PENDING' });
      },
    });
    const entry = toToolManifestEntry(tool);
    expect(entry.name).toBe('applications.getStatus');
    expect(entry.description).toBe('Get an application status.');
    expect(entry.executionLocation).toBe('server');
    expect(entry.parameters).toMatchObject({
      type: 'object',
      properties: { applicationId: { type: 'string' } },
      required: ['applicationId'],
    });
  });

  it('defaults executionLocation to "client" when metadata declares it', () => {
    const tool = defineTool({
      name: 'navigation.open',
      description: 'x',
      input: z.object({}),
      metadata: { executionLocation: 'client', source: 'frontend' },
      execute() {
        return Promise.resolve(undefined);
      },
    });
    expect(toToolManifestEntry(tool).executionLocation).toBe('client');
  });
});

describe('toToolManifest', () => {
  it('maps a list of tools', () => {
    const tools = [
      defineTool({
        name: 'a',
        description: 'x',
        input: z.object({}),
        execute() {
          return Promise.resolve(undefined);
        },
      }),
      defineTool({
        name: 'b',
        description: 'x',
        input: z.object({}),
        execute() {
          return Promise.resolve(undefined);
        },
      }),
    ];
    expect(toToolManifest(tools).map((entry) => entry.name)).toEqual(['a', 'b']);
  });
});
