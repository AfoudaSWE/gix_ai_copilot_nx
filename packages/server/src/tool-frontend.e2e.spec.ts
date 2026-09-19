import { afterEach, describe, expect, it } from 'vitest';
import { createEchoExecutor, createRuntime } from '@gixcopilot/core';
import { createModelRuntime } from '@gixcopilot/provider';
import type { ModelProvider } from '@gixcopilot/provider';
import type { CopilotEvent } from '@gixcopilot/protocol';
import { createServer } from './app.js';

/**
 * Real end-to-end coverage of the frontend tool transport (Section 45, 51, 82): two
 * separate HTTP requests against one real listening server - `POST /runs` (which streams
 * while the executor suspends awaiting a client-executed tool) and a concurrent
 * `POST /runs/:runId/tool-results` - exactly the round trip a real browser client performs.
 * `app.inject()` cannot exercise this (it buffers the whole response before resolving), so
 * this file uses a real loopback listener + `fetch`, mirroring the network-level integration
 * tests in examples/react-basic.
 */
async function* readSseEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<CopilotEvent, void, undefined> {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let separatorIndex: number;
    while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      if (!frame.trim() || frame.startsWith(':')) continue;
      const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
      if (dataLine) {
        yield JSON.parse(dataLine.slice('data: '.length)) as CopilotEvent;
      }
    }
  }
}

const NAVIGATION_TOOL_MANIFEST = {
  name: 'navigation.openApplication',
  description: 'Open an application details page',
  parameters: {
    type: 'object',
    properties: { applicationId: { type: 'string' } },
    required: ['applicationId'],
  },
  executionLocation: 'client' as const,
};

describe('frontend tool transport (Phase 5, Section 82, real network)', () => {
  let app: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('completes the full Model -> Server -> Client -> Server -> Model round trip (Section 102)', async () => {
    let call = 0;
    const provider: ModelProvider = {
      id: 'mock',
      async *stream(request) {
        await Promise.resolve();
        call += 1;
        if (call === 1) {
          expect(request.tools?.map((t) => t.name)).toEqual(['navigation.openApplication']);
          yield {
            type: 'tool_call.requested',
            toolCall: {
              id: 'call-1',
              name: 'navigation.openApplication',
              arguments: { applicationId: 'APP-1024' },
            },
          };
          yield { type: 'model.completed', finishReason: 'tool_calls' };
          return;
        }
        const toolMessage = request.messages.find((m) => m.role === 'tool');
        expect(toolMessage).toBeDefined();
        yield { type: 'content.delta', delta: 'Opened APP-1024.' };
        yield { type: 'model.completed', finishReason: 'stop' };
      },
    };
    app = createServer({
      runtime: createRuntime({ executor: createEchoExecutor() }),
      modelRuntime: createModelRuntime({ providers: [provider] }),
    });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });

    const response = await fetch(`${address}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: { provider: 'mock', model: 'mock-model' },
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Open APP-1024' }] }],
        tools: [NAVIGATION_TOOL_MANIFEST],
      }),
    });
    if (!response.body) throw new Error('Expected a streaming response body');

    const events: CopilotEvent[] = [];
    let toolResultSubmitted = false;
    for await (const event of readSseEvents(response.body.getReader())) {
      events.push(event);
      if (event.type === 'tool.requested' && !toolResultSubmitted) {
        toolResultSubmitted = true;
        expect(event.source).toBe('frontend');
        expect(event.arguments).toEqual({ applicationId: 'APP-1024' });

        const submitResponse = await fetch(`${address}/runs/${event.runId}/tool-results`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toolCallId: event.toolCallId,
            result: {
              status: 'success',
              toolCallId: event.toolCallId,
              data: { opened: true },
            },
          }),
        });
        expect(submitResponse.status).toBe(202);
      }
    }

    expect(events.map((e) => e.type)).toEqual([
      'run.started',
      'message.started',
      'tool.requested',
      'tool.started',
      'tool.completed',
      'message.delta',
      'message.end',
      'run.completed',
    ]);
    const completedTool = events.find((e) => e.type === 'tool.completed');
    expect(completedTool?.type === 'tool.completed' && completedTool.result).toEqual({
      opened: true,
    });
  });

  it('resolves with FRONTEND_TOOL_UNAVAILABLE if the client never submits a result before the timeout (Section 51)', async () => {
    const provider: ModelProvider = {
      id: 'mock',
      async *stream() {
        await Promise.resolve();
        yield {
          type: 'tool_call.requested',
          toolCall: { id: 'call-1', name: 'navigation.openApplication', arguments: {} },
        };
        yield { type: 'model.completed', finishReason: 'tool_calls' };
      },
    };
    app = createServer({
      runtime: createRuntime({ executor: createEchoExecutor() }),
      modelRuntime: createModelRuntime({ providers: [provider] }),
      toolRuntimeDefaults: { frontendToolTimeoutMs: 20, maxToolIterations: 1 },
    });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });

    const response = await fetch(`${address}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: { provider: 'mock', model: 'mock-model' },
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Open it' }] }],
        tools: [NAVIGATION_TOOL_MANIFEST],
      }),
    });
    if (!response.body) throw new Error('Expected a streaming response body');

    const events: CopilotEvent[] = [];
    for await (const event of readSseEvents(response.body.getReader())) {
      events.push(event);
    }

    const failedTool = events.find((e) => e.type === 'tool.failed');
    expect(failedTool?.type === 'tool.failed' && failedTool.error.code).toBe(
      'FRONTEND_TOOL_UNAVAILABLE',
    );
    // The loop limit (1) is hit right after the unresolved call, so the run still ends
    // deterministically rather than hanging or looping forever.
    expect(events.at(-1)?.type).toBe('run.failed');
  });

  it('cleans up a pending frontend call when the client disconnects, without hanging the server', async () => {
    const provider: ModelProvider = {
      id: 'mock',
      async *stream() {
        await Promise.resolve();
        yield {
          type: 'tool_call.requested',
          toolCall: { id: 'call-1', name: 'navigation.openApplication', arguments: {} },
        };
        yield { type: 'model.completed', finishReason: 'tool_calls' };
      },
    };
    app = createServer({
      runtime: createRuntime({ executor: createEchoExecutor() }),
      modelRuntime: createModelRuntime({ providers: [provider] }),
    });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });

    const controller = new AbortController();
    const response = await fetch(`${address}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: { provider: 'mock', model: 'mock-model' },
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Open it' }] }],
        tools: [NAVIGATION_TOOL_MANIFEST],
      }),
      signal: controller.signal,
    });
    if (!response.body) throw new Error('Expected a streaming response body');

    let toolCallId: string | undefined;
    let runId: string | undefined;
    for await (const event of readSseEvents(response.body.getReader())) {
      if (event.type === 'tool.requested') {
        toolCallId = event.toolCallId;
        runId = event.runId;
        controller.abort();
        break;
      }
    }

    expect(toolCallId).toBeDefined();
    // A late submission after disconnect finds nothing pending (the bridge already cleaned
    // up on the abort) - this is the assertion that the server did not hang or leak.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const lateSubmit = await fetch(`${address}/runs/${runId}/tool-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolCallId,
        result: { status: 'success', toolCallId, data: {} },
      }),
    });
    expect(lateSubmit.status).toBe(404);
  });
});
