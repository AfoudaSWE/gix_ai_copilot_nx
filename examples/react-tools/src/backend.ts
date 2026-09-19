import { z } from 'zod';
import { createRuntime } from '@gixcopilot/core';
import { createServer } from '@gixcopilot/server';
import { createToolRegistry, defineTool } from '@gixcopilot/tools';
import { createModelExecutor, createModelRuntime } from '@gixcopilot/provider';
import type { ModelMessage, ModelProvider } from '@gixcopilot/provider';
import type { ToolResult } from '@gixcopilot/protocol';
import { findApplication } from './applications.js';

function extractField(text: string, field: string): string | undefined {
  const match = new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`).exec(text);
  return match?.[1];
}

function systemContextText(messages: readonly ModelMessage[]): string {
  return messages
    .filter((message) => message.role === 'system')
    .flatMap((message) => message.content)
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n');
}

function lastUserText(messages: readonly ModelMessage[]): string | undefined {
  const last = [...messages].reverse().find((message) => message.role === 'user');
  if (!last) return undefined;
  return last.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ');
}

/**
 * The backend tool registry (Section 22, 99) - real `ToolDefinition`s with Zod schemas,
 * registered once and shared by every run. `applications.getStatus` deliberately fails for
 * "APP-ERROR" to demonstrate Section 84's error-handling flow; `applications.runAudit` is
 * deliberately slow (2s) to demonstrate Section 85's cancellation flow - press Stop while it
 * is running.
 */
export function createBackendToolRegistry() {
  const registry = createToolRegistry();

  registry.register(
    defineTool({
      name: 'applications.getStatus',
      description: 'Get the current status of an application by its id.',
      input: z.object({ applicationId: z.string() }),
      output: z.object({ applicationId: z.string(), status: z.string() }),
      metadata: { readOnly: true, category: 'applications' },
      execute({ applicationId }) {
        if (applicationId === 'APP-ERROR') {
          throw new Error('The applications service is temporarily unavailable.');
        }
        const application = findApplication(applicationId);
        return Promise.resolve({
          applicationId,
          status: application?.status ?? 'UNKNOWN',
        });
      },
    }),
  );

  registry.register(
    defineTool({
      name: 'applications.runAudit',
      description: 'Run a compliance audit on an application (takes a few seconds).',
      input: z.object({ applicationId: z.string() }),
      output: z.object({ applicationId: z.string(), auditId: z.string() }),
      metadata: { destructive: false, category: 'applications', timeoutMs: 10_000 },
      execute({ applicationId }) {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({ applicationId, auditId: `AUDIT-${applicationId}` });
          }, 2_000);
        });
      },
    }),
  );

  return registry;
}

/**
 * A deterministic, non-network `ModelProvider` (Section 15, 73, like `@gixcopilot/provider-
 * mock`) that decides whether to call a tool from the conversation's own text, exactly the
 * "mock model tool calling" pattern Section 73 describes - no real LLM anywhere in this demo.
 */
function createToolsAwareProvider(): ModelProvider {
  return {
    id: 'tools-aware',
    async *stream(request) {
      await Promise.resolve();
      yield { type: 'model.started' };

      const messages = request.messages;
      const last = messages.at(-1);

      if (last?.role === 'tool') {
        const resultPart = last.content.find((part) => part.type === 'tool_result');
        const toolCallId = resultPart?.type === 'tool_result' ? resultPart.toolCallId : undefined;
        const callPart = [...messages]
          .reverse()
          .flatMap((message) => message.content)
          .find((part) => part.type === 'tool_call' && part.toolCallId === toolCallId);

        const answer = answerFromToolResult(
          callPart?.type === 'tool_call' ? callPart.name : undefined,
          resultPart?.type === 'tool_result' ? resultPart.result : undefined,
        );
        for (const word of answer.match(/\S+|\s+/g) ?? []) {
          yield { type: 'content.delta', delta: word };
        }
        yield { type: 'model.completed', finishReason: 'stop' };
        return;
      }

      const text = lastUserText(messages) ?? '';
      const toolCall = decideToolCall(text, systemContextText(messages));
      if (toolCall) {
        yield { type: 'tool_call.requested', toolCall };
        yield { type: 'model.completed', finishReason: 'tool_calls' };
        return;
      }

      const fallback =
        'I can look up an application status, open one, or run an audit - just ask, ' +
        'e.g. "What is the status of APP-1024?".';
      for (const word of fallback.match(/\S+|\s+/g) ?? []) {
        yield { type: 'content.delta', delta: word };
      }
      yield { type: 'model.completed', finishReason: 'stop' };
    },
  };
}

function decideToolCall(
  text: string,
  contextText: string,
): { id: string; name: string; arguments: Record<string, unknown> } | undefined {
  const auditMatch = /run\s+(?:an?\s+)?audit\s+(?:on\s+|for\s+)?(app-[\w-]+)/i.exec(text);
  if (auditMatch?.[1]) {
    return {
      id: crypto.randomUUID(),
      name: 'applications.runAudit',
      arguments: { applicationId: auditMatch[1].toUpperCase() },
    };
  }

  const openMatch = /open\s+(app-[\w-]+)/i.exec(text);
  if (openMatch?.[1]) {
    return {
      id: crypto.randomUUID(),
      name: 'navigation.openApplication',
      arguments: { applicationId: openMatch[1].toUpperCase() },
    };
  }

  const statusMatch = /status of\s+(app-[\w-]+)/i.exec(text);
  if (statusMatch?.[1]) {
    return {
      id: crypto.randomUUID(),
      name: 'applications.getStatus',
      arguments: { applicationId: statusMatch[1].toUpperCase() },
    };
  }

  if (/\bits\s+status\b|what.*it.*status/i.test(text)) {
    const contextId = extractField(contextText, 'id');
    if (contextId) {
      return {
        id: crypto.randomUUID(),
        name: 'applications.getStatus',
        arguments: { applicationId: contextId },
      };
    }
  }

  return undefined;
}

function answerFromToolResult(name: string | undefined, result: ToolResult | undefined): string {
  if (!result) return "I couldn't complete that.";

  if (result.status === 'error') {
    return `Sorry, that request failed: ${result.error.message}`;
  }

  const data = result.data as Record<string, unknown>;
  const applicationId = String(data['applicationId']);
  if (name === 'applications.getStatus') {
    return `${applicationId} is currently ${String(data['status'])}.`;
  }
  if (name === 'navigation.openApplication') {
    return `Opened ${applicationId} for you.`;
  }
  if (name === 'applications.runAudit') {
    return `The audit for ${applicationId} is complete (${String(data['auditId'])}).`;
  }
  return 'Done.';
}

/** Credential-free, deterministic demo backend for the tools example. */
export function createDemoServer(): ReturnType<typeof createServer> {
  const toolRegistry = createBackendToolRegistry();
  const provider = createToolsAwareProvider();
  const modelRuntime = createModelRuntime({
    providers: [provider],
    defaults: { retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 } },
  });
  return createServer({
    modelRuntime,
    toolRegistry,
    toolRuntimeDefaults: { frontendToolTimeoutMs: 30_000, maxToolIterations: 4 },
    runtime: createRuntime({
      executor: createModelExecutor({ runtime: modelRuntime, model: { provider: provider.id, model: 'demo' } }),
    }),
  });
}
