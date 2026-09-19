import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRunId, createThreadId } from '@gixcopilot/protocol';
import { createModelRuntime } from '@gixcopilot/provider';
import type { ModelProvider } from '@gixcopilot/provider';
import { createToolRegistry, createDefaultToolResolver, defineTool } from '@gixcopilot/tools';
import { createToolCallingExecutor } from './tool-calling-executor.js';
import { createFrontendToolBridge } from './frontend-tool-bridge.js';
import type { ExecutorContext, ExecutorInput } from '@gixcopilot/core';

function userMessage(text: string) {
  return { role: 'user' as const, content: [{ type: 'text' as const, text }] };
}

function context(signal: AbortSignal = new AbortController().signal): ExecutorContext {
  return { runId: createRunId(), signal, onToolEvent: () => {} };
}

async function drain<TReturn>(
  generator: AsyncGenerator<string, TReturn, undefined>,
): Promise<{ deltas: string[]; result: TReturn }> {
  const deltas: string[] = [];
  let step = await generator.next();
  while (!step.done) {
    deltas.push(step.value);
    step = await generator.next();
  }
  return { deltas, result: step.value };
}

describe('createToolCallingExecutor', () => {
  it('runs the model once and returns text unchanged when no tools are registered and none are requested', async () => {
    const provider: ModelProvider = {
      id: 'mock',
      async *stream() {
        await Promise.resolve();
        yield { type: 'content.delta', delta: 'Hello' };
        yield { type: 'model.completed', finishReason: 'stop' };
      },
    };
    const executor = createToolCallingExecutor({
      modelRuntime: createModelRuntime({ providers: [provider] }),
      model: { provider: 'mock', model: 'x' },
      backendToolResolver: createDefaultToolResolver(createToolRegistry()),
      frontendTools: [],
      frontendToolBridge: createFrontendToolBridge(),
    });

    const input: ExecutorInput = { threadId: createThreadId(), messages: [userMessage('hi')] };
    const { deltas, result } = await drain(executor.execute(input, context()));
    expect(deltas).toEqual(['Hello']);
    expect(result).toEqual({ usage: undefined, finishReason: 'stop' });
  });

  it('executes the required backend tool loop end to end (Section 101)', async () => {
    const registry = createToolRegistry();
    registry.register(
      defineTool({
        name: 'applications.getStatus',
        description: 'Get application status',
        input: z.object({ applicationId: z.string() }),
        output: z.object({ applicationId: z.string(), status: z.string() }),
        execute({ applicationId }) {
          return Promise.resolve({ applicationId, status: 'PENDING' });
        },
      }),
    );

    let call = 0;
    const provider: ModelProvider = {
      id: 'mock',
      async *stream(request) {
        await Promise.resolve();
        call += 1;
        if (call === 1) {
          expect(request.tools?.map((t) => t.name)).toEqual(['applications.getStatus']);
          yield {
            type: 'tool_call.requested',
            toolCall: { id: 'call-1', name: 'applications.getStatus', arguments: { applicationId: 'APP-1024' } },
          };
          yield { type: 'model.completed', finishReason: 'tool_calls' };
          return;
        }
        // Second call: the tool result must already be in the conversation.
        const toolMessage = request.messages.find((m) => m.role === 'tool');
        expect(toolMessage).toBeDefined();
        yield { type: 'content.delta', delta: 'APP-1024 is currently pending.' };
        yield { type: 'model.completed', finishReason: 'stop' };
      },
    };

    const toolEvents: string[] = [];
    const executor = createToolCallingExecutor({
      modelRuntime: createModelRuntime({ providers: [provider] }),
      model: { provider: 'mock', model: 'x' },
      backendToolResolver: createDefaultToolResolver(registry),
      frontendTools: [],
      frontendToolBridge: createFrontendToolBridge(),
    });

    const input: ExecutorInput = {
      threadId: createThreadId(),
      messages: [userMessage('What is APP-1024 status?')],
    };
    const ctx: ExecutorContext = {
      runId: createRunId(),
      signal: new AbortController().signal,
      onToolEvent: (event) => toolEvents.push(event.phase),
    };
    const { deltas, result } = await drain(executor.execute(input, ctx));

    expect(deltas.join('')).toBe('APP-1024 is currently pending.');
    expect(result).toEqual({ usage: undefined, finishReason: 'stop' });
    expect(toolEvents).toEqual(['requested', 'started', 'completed']);
  });

  it('enforces the tool iteration limit (Section 40, TOOL_ITERATION_LIMIT_EXCEEDED)', async () => {
    const registry = createToolRegistry();
    registry.register(
      defineTool({
        name: 'loop.tool',
        description: 'x',
        input: z.object({}),
        execute() {
          return Promise.resolve({});
        },
      }),
    );
    const provider: ModelProvider = {
      id: 'mock',
      async *stream() {
        await Promise.resolve();
        yield {
          type: 'tool_call.requested',
          toolCall: { id: `call-${Math.random()}`, name: 'loop.tool', arguments: {} },
        };
        yield { type: 'model.completed', finishReason: 'tool_calls' };
      },
    };
    const executor = createToolCallingExecutor({
      modelRuntime: createModelRuntime({ providers: [provider] }),
      model: { provider: 'mock', model: 'x' },
      backendToolResolver: createDefaultToolResolver(registry),
      frontendTools: [],
      frontendToolBridge: createFrontendToolBridge(),
      maxToolIterations: 2,
    });

    const input: ExecutorInput = { threadId: createThreadId(), messages: [userMessage('go')] };
    await expect(drain(executor.execute(input, context()))).rejects.toMatchObject({
      code: 'TOOL_ITERATION_LIMIT_EXCEEDED',
    });
  });

  it('surfaces a tool execution failure back to the model as a tool_result error, without throwing', async () => {
    const registry = createToolRegistry();
    registry.register(
      defineTool({
        name: 'throws',
        description: 'x',
        input: z.object({}),
        execute() {
          throw new Error('downstream unavailable');
        },
      }),
    );
    let secondCallMessages: unknown;
    const provider: ModelProvider = {
      id: 'mock',
      async *stream(request) {
        await Promise.resolve();
        if (!secondCallMessages) {
          yield {
            type: 'tool_call.requested',
            toolCall: { id: 'call-1', name: 'throws', arguments: {} },
          };
          yield { type: 'model.completed', finishReason: 'tool_calls' };
          secondCallMessages = request.messages;
          return;
        }
        yield { type: 'content.delta', delta: 'Sorry, that failed.' };
        yield { type: 'model.completed', finishReason: 'stop' };
      },
    };
    const executor = createToolCallingExecutor({
      modelRuntime: createModelRuntime({ providers: [provider] }),
      model: { provider: 'mock', model: 'x' },
      backendToolResolver: createDefaultToolResolver(registry),
      frontendTools: [],
      frontendToolBridge: createFrontendToolBridge(),
    });
    const input: ExecutorInput = { threadId: createThreadId(), messages: [userMessage('go')] };
    const { deltas } = await drain(executor.execute(input, context()));
    expect(deltas.join('')).toBe('Sorry, that failed.');
  });
});
