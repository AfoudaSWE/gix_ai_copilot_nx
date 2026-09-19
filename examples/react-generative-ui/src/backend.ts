import { createRuntime } from '@gixcopilot/core';
import { createServer } from '@gixcopilot/server';
import { createToolRegistry, defineTool } from '@gixcopilot/tools';
import { createModelExecutor, createModelRuntime } from '@gixcopilot/provider';
import type { ModelMessage, ModelProvider, ModelRuntimeTelemetryEvent, ModelToolCall } from '@gixcopilot/provider';
import { createOpenAIProvider } from '@gixcopilot/provider-openai';
import { z } from 'zod';
import { APPLICATIONS, findApplication } from './applications.js';
import { OPENAI_DEFAULT_MODEL } from './model-config.js';

/**
 * Real applications data used by every tool in this example, backend or frontend
 * (`applications.getStatus` below, `navigation.openApplication` in `app.tsx`) - this is the
 * example application's own actual state, not a value invented to make a demo answer look
 * right. A production app would replace `applications.ts`'s in-memory array with a real
 * database/service call inside the same `execute()` bodies; nothing about the tool
 * definitions, the model integration, or the generative-UI/state-patch wiring would change.
 */

/** Only `applications.getStatus` is a real backend tool in this example - rendering and
 * state patching both ride the reserved-tool mechanism the React layer builds automatically
 * (see `app.tsx`'s `useGenerativeComponent`/`useCopilotState`). */
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
        const application = findApplication(applicationId);
        return Promise.resolve({ applicationId, status: application?.status ?? 'unknown' });
      },
    }),
  );
  return registry;
}

function newToolCall(name: string, args: Record<string, unknown>): ModelToolCall {
  return { id: crypto.randomUUID(), name, arguments: args };
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
 * Every `tool_call` part seen anywhere in history, keyed by its `toolCallId` - lets the
 * trailing-tool-result branch below identify *which* reserved tool a result belongs to,
 * exactly the way a real model reads its own prior turns back out of the conversation.
 */
function toolNameById(messages: readonly ModelMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === 'tool_call') names.set(part.toolCallId, part.name);
    }
  }
  return names;
}

/**
 * Section 46's conflict scenario needs the mock model to propose a `baseRevision` the way a
 * real LLM would: by reading the *last* successful patch outcome it can see in its own
 * conversation history, not by tracking hidden server-side state of its own. If the UI
 * changed the filter in between (via its own `set()`, bumping the revision further), this
 * naturally goes stale and the state-patch tool call returns `{status:'conflict', ...}`.
 */
function lastKnownFilterRevision(messages: readonly ModelMessage[]): number {
  const names = toolNameById(messages);
  let revision = 0;
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== 'tool_result') continue;
      if (names.get(part.toolCallId) !== 'state.patch.applicationFilters') continue;
      if (part.result.status !== 'success') continue;
      const data = part.result.data;
      if (
        typeof data === 'object' &&
        data !== null &&
        'status' in data &&
        data['status'] === 'applied' &&
        'revision' in data &&
        typeof data['revision'] === 'number'
      ) {
        revision = data['revision'];
      }
    }
  }
  return revision;
}

function trailingToolResultAnswer(messages: readonly ModelMessage[]): string | undefined {
  const last = messages.at(-1);
  if (last?.role !== 'tool') return undefined;
  const names = toolNameById(messages);
  const parts: string[] = [];
  for (const part of last.content) {
    if (part.type !== 'tool_result') continue;
    const name = names.get(part.toolCallId);
    if (name === 'applications.getStatus') {
      const data = part.result.status === 'success' ? (part.result.data as Record<string, unknown>) : undefined;
      parts.push(
        data
          ? `${String(data['applicationId'])} is currently ${String(data['status'])}.`
          : `Sorry, I could not check that status: ${part.result.status === 'error' ? part.result.error.message : 'unknown error'}`,
      );
    } else if (name === 'state.patch.applicationFilters') {
      const data = part.result.status === 'success' ? (part.result.data as Record<string, unknown>) : undefined;
      if (data?.['status'] === 'applied') {
        parts.push('Filter updated.');
      } else if (data?.['status'] === 'conflict') {
        parts.push('The filter changed elsewhere just now - please ask again with the latest value.');
      } else {
        parts.push("I wasn't able to update the filter.");
      }
    } else if (name?.startsWith('ui.render.')) {
      // No extra trailing text needed - the rendered card speaks for itself.
      continue;
    }
  }
  return parts.length > 0 ? parts.join(' ') : 'Done.';
}

function chunk(text: string): string[] {
  return text.match(/\S+|\s+/g) ?? [text];
}

/**
 * A deterministic, non-network `ModelProvider` (Section 15, 71, like
 * `@gixcopilot/provider-mock`), **used only by this example's own automated test suite**
 * (`integration.spec.tsx`) - never by the real `pnpm server` entry point (`server.ts`), which
 * always talks to real OpenAI (see `createOpenAiDemoServer` below). It requests the reserved
 * generative-UI/state-patch tool calls `@gixcopilot/react` auto-registers
 * (`ui.render.applicationCard`, `state.patch.applicationFilters`) exactly like it would
 * request any ordinary tool - proving Section 66's "structured UI without a
 * [developer-defined] tool" end to end through the real Model -> Tool Runtime pipeline, with
 * no network access and no cost, keeping `pnpm test` fast/deterministic/credential-free.
 */
function createMockGenerativeUiProvider(): ModelProvider {
  return {
    id: 'generative-ui-aware',
    async *stream(request) {
      await Promise.resolve();
      yield { type: 'model.started' };

      const trailingAnswer = trailingToolResultAnswer(request.messages);
      if (trailingAnswer !== undefined) {
        for (const word of chunk(trailingAnswer)) yield { type: 'content.delta', delta: word };
        yield { type: 'model.completed', finishReason: 'stop' };
        return;
      }

      const text = lastUserText(request.messages) ?? '';

      if (/show (all|every|these)( applications)? as cards/i.test(text)) {
        for (const word of chunk("Here's the full list:")) yield { type: 'content.delta', delta: word };
        for (const application of APPLICATIONS) {
          yield {
            type: 'tool_call.requested',
            toolCall: newToolCall('ui.render.applicationCard', {
              applicationId: application.id,
              applicantName: application.applicantName,
              status: application.status,
            }),
          };
        }
        yield { type: 'model.completed', finishReason: 'tool_calls' };
        return;
      }

      const showMatch = /show(?:\s+me)?\s+(app-[\w-]+)/i.exec(text);
      if (showMatch?.[1]) {
        const id = showMatch[1].toUpperCase();
        const application = findApplication(id);
        for (const word of chunk(application ? `Here's ${id}:` : `I couldn't find ${id}.`)) {
          yield { type: 'content.delta', delta: word };
        }
        if (application) {
          yield {
            type: 'tool_call.requested',
            toolCall: newToolCall('ui.render.applicationCard', {
              applicationId: application.id,
              applicantName: application.applicantName,
              status: application.status,
            }),
          };
          yield { type: 'model.completed', finishReason: 'tool_calls' };
        } else {
          yield { type: 'model.completed', finishReason: 'stop' };
        }
        return;
      }

      const statusMatch = /status of\s+(app-[\w-]+)/i.exec(text);
      if (statusMatch?.[1]) {
        yield {
          type: 'tool_call.requested',
          toolCall: newToolCall('applications.getStatus', { applicationId: statusMatch[1].toUpperCase() }),
        };
        yield { type: 'model.completed', finishReason: 'tool_calls' };
        return;
      }

      const filterMatch = /(?:filter(?:ed)?\s+to|show only)\s+(pending|approved|rejected)/i.exec(text);
      if (filterMatch?.[1]) {
        yield {
          type: 'tool_call.requested',
          toolCall: newToolCall('state.patch.applicationFilters', {
            op: 'set',
            value: { status: filterMatch[1].toLowerCase() },
            baseRevision: lastKnownFilterRevision(request.messages),
          }),
        };
        yield { type: 'model.completed', finishReason: 'tool_calls' };
        return;
      }

      const fallback =
        'I can show an application, list them all as cards, look up a status, or update the filter - just ask.';
      for (const word of chunk(fallback)) yield { type: 'content.delta', delta: word };
      yield { type: 'model.completed', finishReason: 'stop' };
    },
  };
}

/**
 * Credential-free, deterministic backend for this example's own automated tests
 * (`integration.spec.tsx`) only. **Never used by `pnpm server`** - see `createOpenAiDemoServer`.
 */
export function createMockDemoServer(): ReturnType<typeof createServer> {
  const toolRegistry = createBackendToolRegistry();
  const provider = createMockGenerativeUiProvider();
  const modelRuntime = createModelRuntime({
    providers: [provider],
    defaults: { retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 } },
  });
  return createServer({
    modelRuntime,
    toolRegistry,
    toolRuntimeDefaults: { frontendToolTimeoutMs: 30_000, maxToolIterations: 6 },
    runtime: createRuntime({
      executor: createModelExecutor({ runtime: modelRuntime, model: { provider: provider.id, model: 'demo' } }),
    }),
  });
}

export interface OpenAiConfig {
  readonly apiKey: string;
  readonly model: string;
}

/**
 * Reads and validates the real-provider configuration (Section 6-7, 35). Throws a single,
 * clear, actionable error - never a silent fallback to the mock provider and never a raw
 * OpenAI SDK/network stack trace - so a misconfigured environment fails obviously, exactly
 * where a developer is looking (the server process that refuses to start).
 */
export function resolveOpenAiConfig(): OpenAiConfig {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'OpenAI provider is enabled but OPENAI_API_KEY is not configured.\n\n' +
        'Create a local .env file based on .env.example and provide your OpenAI API key:\n\n' +
        '  cp .env.example .env\n' +
        '  # then edit .env and set OPENAI_API_KEY=sk-...\n',
    );
  }
  return { apiKey, model: process.env['OPENAI_MODEL'] || OPENAI_DEFAULT_MODEL };
}

/**
 * The real demo backend (Section 3, 8-9): registers `@gixcopilot/provider-openai` as the
 * sole `ModelProvider` through the exact same `ModelRuntime`/`ToolRegistry`/`createServer`
 * boundary the mock backend above uses - proving the SDK's own provider-neutral
 * architecture, not a parallel integration. Real retry/timeout defaults (unlike the mock
 * backend's `maxAttempts: 1`, chosen only to keep tests instant) - a transient OpenAI error
 * is genuinely worth retrying here.
 */
export function createOpenAiDemoServer(config: OpenAiConfig): ReturnType<typeof createServer> {
  const toolRegistry = createBackendToolRegistry();
  const provider = createOpenAIProvider({ apiKey: config.apiKey });
  const modelRuntime = createModelRuntime({
    providers: [provider],
    defaults: {
      timeoutMs: 30_000,
      retry: { maxAttempts: 3, baseDelayMs: 300, maxDelayMs: 4_000 },
    },
    // Safe logging only (Section 30): provider/model/duration/error code, never prompts,
    // arguments, results, or the API key itself.
    onTelemetry: (event: ModelRuntimeTelemetryEvent) => {
      if (event.type === 'attempt_failed') {
        console.error(
          `[openai] attempt_failed: ${event.code} (attempt ${event.attempt}/${event.maxAttempts})`,
        );
      } else if (event.type === 'failed') {
        console.error(`[openai] failed: ${event.code} (after ${event.attempts} attempt(s))`);
      }
    },
  });
  return createServer({
    modelRuntime,
    toolRegistry,
    toolRuntimeDefaults: { frontendToolTimeoutMs: 30_000, maxToolIterations: 6 },
    runtime: createRuntime({
      executor: createModelExecutor({ runtime: modelRuntime, model: { provider: provider.id, model: config.model } }),
    }),
  });
}
