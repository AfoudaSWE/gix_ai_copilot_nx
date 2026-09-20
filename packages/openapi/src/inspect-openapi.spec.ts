import { describe, expect, it } from 'vitest';
import { inspectOpenAPI } from './inspect-openapi.js';

const document = {
  openapi: '3.1.0',
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/widgets': { get: { operationId: 'listWidgets', parameters: [] } },
  },
};

describe('inspectOpenAPI', () => {
  it('returns generated tools and a report without needing a registry', async () => {
    const result = await inspectOpenAPI({ integrationId: 'widgets', include: ['listWidgets'], source: { kind: 'object', document } });
    expect(result.tools.map((tool) => tool.name)).toEqual(['listWidgets']);
    expect(result.report.generated).toBe(1);
  });
});
