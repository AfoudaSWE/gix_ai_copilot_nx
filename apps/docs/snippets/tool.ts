import { z } from 'zod';
import { defineTool } from '@gixcopilot/tools';

export const applicationsGet = defineTool({
  name: 'applications.get',
  description: 'Look up a visa application by id',
  input: z.object({ id: z.string() }),
  security: { risk: 'read-only', requiredPermissions: ['applications.read'] },
  execute: async ({ id }) => ({ id, status: 'under_review' }),
});
