import { createCopilot } from '@gixcopilot/node';
import type { Copilot } from '@gixcopilot/node';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import type { ModelProvider, ModelReference } from '@gixcopilot/provider';
import {
  createActionFirewall,
  createInMemoryApprovalStore,
  createInMemoryAuditSink,
  createStaticAuthenticationAdapter,
} from '@gixcopilot/security';
import { createUsersApi } from './users.connector.js';

/**
 * A local development fixture, not a real credential: the browser sends it (see web/main.tsx)
 * so the copilot has an identity to authorize. A real app resolves identity from its session.
 */
export const LOCAL_DEV_TOKEN = 'users-crud-local-dev';

export interface UsersCopilotOptions {
  /** Where the users REST API listens, e.g. `http://127.0.0.1:4319`. */
  readonly apiUrl: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Overrides the provider chosen from `env` (tests use a scripted provider). */
  readonly provider?: { readonly model: ModelReference; readonly provider: ModelProvider };
}

function providerFromEnv(env: NodeJS.ProcessEnv): { model: ModelReference; provider: ModelProvider } {
  const apiKey = env['OPENAI_API_KEY'];
  if (apiKey)
    return {
      model: {
        provider: 'openai',
        model: !env['OPENAI_MODEL'] || env['OPENAI_MODEL'] === 'auto'
          ? 'gpt-4o-mini'
          : env['OPENAI_MODEL'],
      },
      provider: createOpenAIProvider({ apiKey }),
    };
  return {
    model: { provider: 'mock', model: 'demo' },
    provider: createMockProvider({
      id: 'mock',
      scenario: { chunks: ['The copilot needs OPENAI_API_KEY on the server (mock provider).'] },
    }),
  };
}

/**
 * The copilot for the users directory. The model picks from the users connector's tools, and
 * every call passes the Action Firewall; the browser never sees a provider key or model name.
 */
export function createUsersCopilot(options: UsersCopilotOptions): {
  copilot: Copilot;
  audit: ReturnType<typeof createInMemoryAuditSink>;
} {
  const { model, provider } = options.provider ?? providerFromEnv(options.env ?? process.env);
  const audit = createInMemoryAuditSink();
  const copilot = createCopilot({
    model,
    providers: [provider],
    tools: createUsersApi(options.apiUrl).tools,
    security: {
      authentication: createStaticAuthenticationAdapter({
        [LOCAL_DEV_TOKEN]: {
          subject: 'local-user',
          roles: ['user'],
          permissions: ['api.users'],
          attributes: { tenantId: 'local' },
        },
      }),
      firewall: createActionFirewall({ audit }),
      approvals: createInMemoryApprovalStore(),
    },
  });
  return { copilot, audit };
}
