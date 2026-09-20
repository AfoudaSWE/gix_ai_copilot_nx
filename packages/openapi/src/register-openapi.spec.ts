import { describe, expect, it } from 'vitest';
import { createToolRegistry } from '@gixcopilot/tools';
import { registerOpenAPI } from './register-openapi.js';
import type { OpenAPILoader } from './loader.js';

const twoOperationDocument = {
  openapi: '3.1.0',
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/widgets': { get: { operationId: 'listWidgets', parameters: [] } },
    '/gadgets': { get: { operationId: 'listGadgets', parameters: [] } },
  },
};

const oneOperationDocument = {
  openapi: '3.1.0',
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/widgets': { get: { operationId: 'listWidgets', parameters: [] } },
  },
};

/** Returns a fixed sequence of documents, one per `load()` call - lets a test simulate "the
 * spec changed" across a `refresh()` without depending on a real file/network source. */
function sequenceLoader(documents: readonly unknown[]): OpenAPILoader {
  let index = 0;
  return {
    load: () => {
      const document = documents[Math.min(index, documents.length - 1)];
      index += 1;
      return Promise.resolve(document);
    },
  };
}

describe('registerOpenAPI', () => {
  it('registers every generated tool into the given registry', async () => {
    const registry = createToolRegistry();
    const integration = await registerOpenAPI({
      integrationId: 'widgets',
      include: ['listWidgets', 'listGadgets'],
      source: { kind: 'object', document: twoOperationDocument },
      registry,
    });
    expect([...integration.toolNames].sort()).toEqual(['listGadgets', 'listWidgets']);
    expect(registry.has('listWidgets')).toBe(true);
    expect(registry.has('listGadgets')).toBe(true);
    expect(integration.report.generated).toBe(2);
  });

  it('records a conflict, without overwriting, when a name is already registered by something else', async () => {
    const registry = createToolRegistry();
    registry.register({
      name: 'listWidgets',
      description: 'hand-written',
      inputSchema: { parse: (v: unknown) => v } as never,
      execute: () => Promise.resolve('hand-written-result'),
    });

    const integration = await registerOpenAPI({
      integrationId: 'widgets',
      include: ['listWidgets', 'listGadgets'],
      source: { kind: 'object', document: oneOperationDocument },
      registry,
    });

    expect(integration.toolNames).toEqual([]);
    expect(integration.report.conflicts).toHaveLength(1);
    expect(integration.report.conflicts[0]?.name).toBe('listWidgets');
    expect(registry.get('listWidgets')?.description).toBe('hand-written');
  });

  it('unregisters a tool whose operation disappeared on refresh (Section 62)', async () => {
    const registry = createToolRegistry();
    const loader = sequenceLoader([twoOperationDocument, oneOperationDocument]);
    const integration = await registerOpenAPI({
      integrationId: 'widgets',
      include: ['listWidgets', 'listGadgets'],
      source: { kind: 'object', document: twoOperationDocument },
      loader,
      registry,
    });
    expect(registry.has('listGadgets')).toBe(true);

    const refreshedReport = await integration.refresh();

    expect(registry.has('listGadgets')).toBe(false);
    expect(registry.has('listWidgets')).toBe(true);
    expect(refreshedReport.generated).toBe(1);
    expect(integration.report).toBe(refreshedReport);
  });

  it('registers a newly-appeared operation on refresh', async () => {
    const registry = createToolRegistry();
    const loader = sequenceLoader([oneOperationDocument, twoOperationDocument]);
    const integration = await registerOpenAPI({
      integrationId: 'widgets',
      include: ['listWidgets', 'listGadgets'],
      source: { kind: 'object', document: oneOperationDocument },
      loader,
      registry,
    });
    expect(registry.has('listGadgets')).toBe(false);

    await integration.refresh();

    expect(registry.has('listGadgets')).toBe(true);
  });

  it('updates an existing registration in place on refresh rather than re-registering', async () => {
    const registry = createToolRegistry();
    const loader = sequenceLoader([oneOperationDocument, oneOperationDocument]);
    const integration = await registerOpenAPI({
      integrationId: 'widgets',
      include: ['listWidgets', 'listGadgets'],
      source: { kind: 'object', document: oneOperationDocument },
      loader,
      registry,
    });
    const initialRegistration = registry.get('listWidgets');

    await integration.refresh();

    expect(registry.get('listWidgets')).not.toBe(initialRegistration);
    expect(registry.has('listWidgets')).toBe(true);
  });

  it('dispose() unregisters every tool this integration owns', async () => {
    const registry = createToolRegistry();
    const integration = await registerOpenAPI({
      integrationId: 'widgets',
      include: ['listWidgets', 'listGadgets'],
      source: { kind: 'object', document: twoOperationDocument },
      registry,
    });
    integration.dispose();
    expect(registry.has('listWidgets')).toBe(false);
    expect(registry.has('listGadgets')).toBe(false);
    expect(integration.toolNames).toEqual([]);
  });
});
