import { createRuntime } from '@gixcopilot/core';
import { registerOpenAPI } from '@gixcopilot/openapi';
import type { OpenAPIIntegration } from '@gixcopilot/openapi';
import { createModelExecutor, createModelRuntime } from '@gixcopilot/provider';
import type { ModelMessage, ModelProvider, ModelToolCall } from '@gixcopilot/provider';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import { createActionFirewall, createInMemoryApprovalStore, createInMemoryAuditSink, createStaticAuthenticationAdapter } from '@gixcopilot/security';
import type { Identity } from '@gixcopilot/security';
import { createServer } from '@gixcopilot/server';
import { createToolRegistry } from '@gixcopilot/tools';
import type { FastifyInstance } from 'fastify';
import { createOpenApiSpec } from './openapi-spec.js';
import { createTestApiServer } from './test-api-server.js';

/**
 * A single demo identity holding exactly the permission `security-metadata.ts`'s default
 * (`openapi.vas`) grants every generated tool (Section 46) - this example's own request
 * handling always presents `Authorization: Bearer demo` (see `main.ts`/`integration.spec.ts`),
 * proving that a generated tool is gated by a real permission check, not merely present in the
 * registry. A production app would replace this with its own session/identity adapter; the
 * generated tools themselves would not change.
 */
export const DEMO_IDENTITY: Identity = { subject: 'demo', roles: ['demo'], permissions: ['openapi.vas'] };

export interface OpenApiDemoBackend {
  readonly apiServer: FastifyInstance;
  readonly integration: OpenAPIIntegration;
  readonly registry: ReturnType<typeof createToolRegistry>;
  readonly copilotServer: ReturnType<typeof createServer>;
  close(): Promise<void>;
}

/** Selects four reviewed operations from the local API. Method defaults classify reads and
 * writes, while the explicit include list keeps newly-added endpoints inactive. */
async function createOpenApiIntegration(): Promise<{ apiServer: FastifyInstance; integration: OpenAPIIntegration; registry: ReturnType<typeof createToolRegistry> }> {
  const apiServer = createTestApiServer();
  const address = await apiServer.listen({ port: 0, host: '127.0.0.1' });
  const registry = createToolRegistry();
  const integration = await registerOpenAPI({
    integrationId: 'vas',
    namespace: 'vas',
    source: { kind: 'object', document: createOpenApiSpec(address) },
    include: ['getApplication', 'searchApplications', 'assignApplication', 'updateApplication'],
    baseUrl: address,
    registry,
  });
  return { apiServer, integration, registry };
}

function newToolCall(name: string, args: Record<string, unknown>): ModelToolCall {
  return { id: crypto.randomUUID(), name, arguments: args };
}

function lastUserText(messages: readonly ModelMessage[]): string {
  const last = [...messages].reverse().find((message) => message.role === 'user');
  return (last?.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join(' ');
}

function chunk(text: string): string[] {
  return text.match(/\S+|\s+/g) ?? [text];
}

/**
 * A deterministic, non-network `ModelProvider`, used only by this example's own automated test
 * suite (`integration.spec.ts`) - proposes the generated `vas.applications.getById` tool call
 * for an "APP-nnnn" mention, mirroring how a real model would after seeing the tool's
 * generated description, and reports the tool's own result back once it runs.
 */
function createMockOpenApiProvider(): ModelProvider {
  return {
    id: 'openapi-demo-mock',
    async *stream(request) {
      await Promise.resolve();
      yield { type: 'model.started' };

      const last = request.messages.at(-1);
      if (last?.role === 'tool') {
        const result = last.content.find((part) => part.type === 'tool_result');
        const summary =
          result?.result.status === 'success'
            ? `Application status: ${JSON.stringify(result.result.data)}`
            : 'Sorry, that lookup failed.';
        for (const word of chunk(summary)) yield { type: 'content.delta', delta: word };
        yield { type: 'model.completed', finishReason: 'stop' };
        return;
      }

      const match = /APP-\d+/i.exec(lastUserText(request.messages));
      if (match) {
        yield { type: 'tool_call.requested', toolCall: newToolCall('vas.getApplication', { id: match[0].toUpperCase() }) };
        yield { type: 'model.completed', finishReason: 'tool_calls' };
        return;
      }

      for (const word of chunk('Ask me about an application id, e.g. APP-1001.')) {
        yield { type: 'content.delta', delta: word };
      }
      yield { type: 'model.completed', finishReason: 'stop' };
    },
  };
}

/** Credential-free, deterministic backend for `integration.spec.ts` - never used by `pnpm demo`. */
export async function createMockDemoBackend(): Promise<OpenApiDemoBackend> {
  const { apiServer, integration, registry } = await createOpenApiIntegration();
  const provider = createMockOpenApiProvider();
  const modelRuntime = createModelRuntime({ providers: [provider], defaults: { retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 } } });
  const copilotServer = createServer({
    modelRuntime,
    toolRegistry: registry,
    actionFirewall: createActionFirewall({ audit: createInMemoryAuditSink() }),
    approvals: createInMemoryApprovalStore(),
    authenticationAdapter: createStaticAuthenticationAdapter({ demo: DEMO_IDENTITY }),
    runtime: createRuntime({ executor: createModelExecutor({ runtime: modelRuntime, model: { provider: provider.id, model: 'demo' } }) }),
  });
  return {
    apiServer,
    integration,
    registry,
    copilotServer,
    async close() {
      integration.dispose();
      await apiServer.close();
      await copilotServer.close();
    },
  };
}

export interface OpenAiConfig {
  readonly apiKey: string;
  readonly model: string;
}

export function resolveOpenAiConfig(): OpenAiConfig {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'OpenAI provider is enabled but OPENAI_API_KEY is not configured.\n\n' +
        'Create a local .env file based on .env.example and provide your OpenAI API key.',
    );
  }
  return { apiKey, model: process.env['OPENAI_MODEL'] || 'gpt-4o-mini' };
}

/** The real demo backend (Section 141): registers `@gixcopilot/provider-openai` as the sole
 * `ModelProvider`, through the exact same `ToolRegistry`/`createServer` boundary the mock
 * backend above uses - the generated OpenAPI tools are identical either way. */
export async function createOpenAiDemoBackend(config: OpenAiConfig): Promise<OpenApiDemoBackend> {
  const { apiServer, integration, registry } = await createOpenApiIntegration();
  const provider = createOpenAIProvider({ apiKey: config.apiKey });
  const modelRuntime = createModelRuntime({
    providers: [provider],
    defaults: { timeoutMs: 30_000, retry: { maxAttempts: 3, baseDelayMs: 300, maxDelayMs: 4_000 } },
  });
  const copilotServer = createServer({
    modelRuntime,
    toolRegistry: registry,
    actionFirewall: createActionFirewall({ audit: createInMemoryAuditSink() }),
    approvals: createInMemoryApprovalStore(),
    authenticationAdapter: createStaticAuthenticationAdapter({ demo: DEMO_IDENTITY }),
    runtime: createRuntime({ executor: createModelExecutor({ runtime: modelRuntime, model: { provider: provider.id, model: config.model } }) }),
  });
  return {
    apiServer,
    integration,
    registry,
    copilotServer,
    async close() {
      integration.dispose();
      await apiServer.close();
      await copilotServer.close();
    },
  };
}
