import { fileURLToPath } from 'node:url';
import { createRuntime } from '@gixcopilot/core';
import { registerMCP } from '@gixcopilot/mcp';
import type { MCPIntegration } from '@gixcopilot/mcp';
import { createModelExecutor, createModelRuntime } from '@gixcopilot/provider';
import type { ModelMessage, ModelProvider, ModelToolCall } from '@gixcopilot/provider';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import { createActionFirewall, createInMemoryApprovalStore, createInMemoryAuditSink, createStaticAuthenticationAdapter } from '@gixcopilot/security';
import type { Identity } from '@gixcopilot/security';
import { createServer } from '@gixcopilot/server';
import { createToolRegistry } from '@gixcopilot/tools';

const SERVER_SCRIPT = fileURLToPath(new URL('../src/mcp-server-process.mjs', import.meta.url));

/** Grants exactly the two permissions this example's per-tool overrides require (Section 78) -
 * mirrors `examples/openapi`'s `DEMO_IDENTITY` pattern. */
export const DEMO_IDENTITY: Identity = {
  subject: 'demo',
  roles: ['demo'],
  permissions: ['mcp.widgets.read', 'mcp.widgets.write'],
};

export interface McpDemoBackend {
  readonly integration: MCPIntegration;
  readonly registry: ReturnType<typeof createToolRegistry>;
  readonly copilotServer: ReturnType<typeof createServer>;
  close(): Promise<void>;
}

/**
 * Wires `registerMCP` against the real `mcp-server-process.mjs` child process over `stdio`
 * (Section 71). Unlike `@gixcopilot/openapi`'s method-based defaults, MCP has no safe default
 * to read the server's intent from (Section 79) - every tool here is **explicitly** opted in
 * per-tool: `searchWidgets`/`getWidget` (reads) need no approval; `restockWidget` (a write)
 * requires approval. Nothing is exposed merely because the server offers it.
 */
async function createMcpIntegration(): Promise<{ integration: MCPIntegration; registry: ReturnType<typeof createToolRegistry> }> {
  const registry = createToolRegistry();
  const integration = await registerMCP({
    serverId: 'widgets',
    transport: { kind: 'stdio', command: process.execPath, args: [SERVER_SCRIPT] },
    registry,
    tools: {
      searchWidgets: { approval: 'none', permission: 'mcp.widgets.read' },
      getWidget: { approval: 'none', permission: 'mcp.widgets.read' },
      restockWidget: { approval: 'user-confirmation', permission: 'mcp.widgets.write', risk: 'write' },
    },
  });
  return { integration, registry };
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

/** A deterministic, non-network `ModelProvider`, used only by `integration.spec.ts`. */
function createMockMcpProvider(): ModelProvider {
  return {
    id: 'mcp-demo-mock',
    async *stream(request) {
      await Promise.resolve();
      yield { type: 'model.started' };

      const last = request.messages.at(-1);
      if (last?.role === 'tool') {
        const result = last.content.find((part) => part.type === 'tool_result');
        const summary =
          result?.result.status === 'success' ? `Result: ${JSON.stringify(result.result.data)}` : 'Sorry, that failed.';
        for (const word of chunk(summary)) yield { type: 'content.delta', delta: word };
        yield { type: 'model.completed', finishReason: 'stop' };
        return;
      }

      const match = /WID-\d+/i.exec(lastUserText(request.messages));
      if (match) {
        yield { type: 'tool_call.requested', toolCall: newToolCall('mcp.widgets.getWidget', { id: match[0].toUpperCase() }) };
        yield { type: 'model.completed', finishReason: 'tool_calls' };
        return;
      }

      for (const word of chunk('Ask me about a widget id, e.g. WID-1.')) yield { type: 'content.delta', delta: word };
      yield { type: 'model.completed', finishReason: 'stop' };
    },
  };
}

export async function createMockDemoBackend(): Promise<McpDemoBackend> {
  const { integration, registry } = await createMcpIntegration();
  const provider = createMockMcpProvider();
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
    integration,
    registry,
    copilotServer,
    async close() {
      await integration.dispose();
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

export async function createOpenAiDemoBackend(config: OpenAiConfig): Promise<McpDemoBackend> {
  const { integration, registry } = await createMcpIntegration();
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
    integration,
    registry,
    copilotServer,
    async close() {
      await integration.dispose();
      await copilotServer.close();
    },
  };
}
