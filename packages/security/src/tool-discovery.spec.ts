import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRunId } from '@gixcopilot/protocol';
import { createStaticToolResolver, defineTool } from '@gixcopilot/tools';
import { createPermissionAwareToolResolver } from './tool-discovery.js';
import type { Identity } from './identity.js';

const getTool = defineTool({
  name: 'applications.get',
  description: 'Get an application',
  input: z.object({ applicationId: z.string() }),
  security: { requiredPermissions: ['applications.view'] },
  execute: () => Promise.resolve({}),
});

const deleteTool = defineTool({
  name: 'applications.delete',
  description: 'Delete an application',
  input: z.object({ applicationId: z.string() }),
  security: { requiredPermissions: ['applications.delete'] },
  execute: () => Promise.resolve({}),
});

const unrestrictedTool = defineTool({
  name: 'applications.list',
  description: 'List applications',
  input: z.object({}),
  execute: () => Promise.resolve({}),
});

const baseResolver = createStaticToolResolver([getTool, deleteTool, unrestrictedTool]);
const roleMap = { APPLICATION_VIEWER: ['applications.view'] };

describe('createPermissionAwareToolResolver', () => {
  it('hides a tool the identity lacks the required permission for (Section 20, 96, 133)', async () => {
    const viewer: Identity = { subject: 'u1', roles: ['APPLICATION_VIEWER'], permissions: [] };
    const resolver = createPermissionAwareToolResolver(baseResolver, viewer, { roleMap });
    const tools = await resolver.resolve({ runId: createRunId() });
    expect(tools.map((t) => t.name).sort()).toEqual(['applications.get', 'applications.list']);
  });

  it('an unrestricted (no security metadata) tool is always visible', async () => {
    const resolver = createPermissionAwareToolResolver(baseResolver, undefined);
    const tools = await resolver.resolve({ runId: createRunId() });
    expect(tools.map((t) => t.name)).toEqual(['applications.list']);
  });

  it('with no identity at all, only unrestricted tools are visible', async () => {
    const resolver = createPermissionAwareToolResolver(baseResolver, undefined, { roleMap });
    const tools = await resolver.resolve({ runId: createRunId() });
    expect(tools.map((t) => t.name)).toEqual(['applications.list']);
  });
});
