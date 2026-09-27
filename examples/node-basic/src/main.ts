import { z } from 'zod';
import { createCopilot } from '@gixcopilot/node';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import { createActionFirewall, createInMemoryAuditSink, createStaticAuthenticationAdapter } from '@gixcopilot/security';
import { defineTool } from '@gixcopilot/tools';

/**
 * A plain Node program (no React, no Angular). With OPENAI_API_KEY set it uses the real
 * OpenAI adapter server-side; otherwise a deterministic mock provider (labelled as such).
 * The demo token below is a local development fixture, not a real credential.
 */
export function createNodeCopilot(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = env['OPENAI_API_KEY'];
  const audit = createInMemoryAuditSink();
  const lookup = defineTool({
    name: 'applications.get',
    description: 'Look up the status of a visa application by id',
    input: z.object({ id: z.string() }),
    security: { risk: 'read-only', requiredPermissions: ['applications.read'] },
    execute: ({ id }) => Promise.resolve({ id, status: 'under_review', note: 'demo data' }),
  });
  const copilot = createCopilot({
    model: apiKey ? { provider: 'openai', model: env['OPENAI_MODEL'] ?? 'gpt-4o-mini' } : { provider: 'mock', model: 'demo' },
    providers: apiKey
      ? [createOpenAIProvider({ apiKey })]
      : [
          createMockProvider({
            id: 'mock',
            scenario: (attempt) =>
              attempt === 1
                ? { toolCalls: [{ id: 'call-1', name: 'applications.get', arguments: { id: 'APP-1' } }] }
                : { chunks: ['APP-1 is under review (mock provider).'] },
          }),
        ],
    tools: [lookup],
    security: {
      authentication: createStaticAuthenticationAdapter({
        'local-dev-token': { subject: 'officer-1', roles: ['officer'], permissions: ['applications.read'], attributes: { tenantId: 'demo' } },
      }),
      firewall: createActionFirewall({ audit }),
    },
  });
  return { copilot, audit };
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('main.js')) {
  const { copilot } = createNodeCopilot();
  const result = await copilot.run({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'What is the status of APP-1?' }] }],
    headers: { authorization: 'Bearer local-dev-token' },
  });
  console.log(`[${result.status}] ${result.text}`);
  await copilot.close();
}
