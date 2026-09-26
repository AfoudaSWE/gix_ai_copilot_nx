import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createModelRuntime, generateObject } from '@gixcopilot/provider';
import type { ModelStreamEvent } from '@gixcopilot/provider';
import { createTestModel } from './model.js';

async function collect(stream: AsyncIterable<ModelStreamEvent>): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const request = (text: string) => ({ model: 'test-model', messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text }] }] });

describe('createTestModel (Section 73-75, 187)', () => {
  it('streams deterministic text chunks with usage', async () => {
    const model = createTestModel([{ respond: { text: ['Hello, ', 'world.'], usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } } }]);
    const events = await collect(model.stream(request('hi')));
    expect(events.map((event) => event.type)).toEqual(['model.started', 'content.delta', 'content.delta', 'model.completed']);
    expect(events.at(-1)).toMatchObject({ finishReason: 'stop', usage: { totalTokens: 5 } });
  });

  it('matches rules against the actual request, not a call counter', async () => {
    const model = createTestModel([
      { when: (turn) => turn.lastUserText.includes('payment'), respond: { text: 'payment answer' } },
      { when: (turn) => turn.lastUserText.includes('status'), respond: { toolCalls: [{ name: 'applications.get', arguments: { id: 'APP-1024' } }] } },
    ]);
    const tool = await collect(model.stream(request('what is the status?')));
    expect(tool.find((event) => event.type === 'tool_call.requested')).toMatchObject({ toolCall: { name: 'applications.get', arguments: { id: 'APP-1024' } } });
    expect(tool.at(-1)).toMatchObject({ type: 'model.completed', finishReason: 'tool_calls' });
    const text = await collect(model.stream(request('verify my payment')));
    expect(text.find((event) => event.type === 'content.delta')).toMatchObject({ delta: 'payment answer' });
    expect(model.requests).toHaveLength(2);
  });

  it('sees tool results already in the conversation (so tool-then-answer loops work)', async () => {
    const model = createTestModel([
      { when: (turn) => turn.toolResults.includes('applications.get'), respond: { text: 'done' } },
      { respond: { toolCalls: [{ name: 'applications.get' }] } },
    ]);
    const followUp = {
      model: 'test-model',
      messages: [
        { role: 'user' as const, content: [{ type: 'text' as const, text: 'status?' }] },
        { role: 'assistant' as const, content: [{ type: 'tool_call' as const, toolCallId: 'c1', name: 'applications.get', arguments: {} }] },
        { role: 'tool' as const, content: [{ type: 'tool_result' as const, toolCallId: 'c1', result: { status: 'success' as const, toolCallId: 'c1', data: {} } }] },
      ],
    };
    const events = await collect(model.stream(followUp));
    expect(events.find((event) => event.type === 'content.delta')).toMatchObject({ delta: 'done' });
  });

  it('produces valid structured output and rejects malformed output through the real generateObject', async () => {
    const schema = z.object({ status: z.string(), summary: z.string() });
    const valid = createModelRuntime({ providers: [createTestModel([{ respond: { object: { status: 'approved', summary: 'ok' } } }])], defaultProvider: 'test', defaultModel: 'test-model' });
    await expect(generateObject({ runtime: valid, messages: request('x').messages, schema })).resolves.toEqual({ object: { status: 'approved', summary: 'ok' } });
    const malformed = createModelRuntime({ providers: [createTestModel([{ respond: { malformed: '{"status": 42' } }])], defaultProvider: 'test', defaultModel: 'test-model' });
    await expect(generateObject({ runtime: malformed, messages: request('x').messages, schema })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it.each([
    ['timeout', 'TIMEOUT', true],
    ['rate-limit', 'RATE_LIMITED', true],
    ['server-error', 'PROVIDER_ERROR', true],
    ['authentication', 'AUTHENTICATION_ERROR', false],
  ] as const)('simulates a %s failure as %s', async (fail, code, retryable) => {
    const events = await collect(createTestModel([{ respond: { fail } }]).stream(request('x')));
    expect(events.at(-1)).toMatchObject({ type: 'model.failed', error: { code, retryable } });
  });

  it('simulates a stream interrupted after some chunks', async () => {
    const events = await collect(createTestModel([{ respond: { interruptAfter: 1, text: ['partial ', 'never sent'] } }]).stream(request('x')));
    expect(events.filter((event) => event.type === 'content.delta')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'model.failed', error: { code: 'NETWORK_ERROR' } });
  });

  it('stops streaming when the caller cancels', async () => {
    const controller = new AbortController();
    const model = createTestModel([{ respond: { hang: true, chunkEveryMs: 5 } }]);
    setTimeout(() => controller.abort(), 20);
    const events = await collect(model.stream(request('x'), { signal: controller.signal }));
    expect(events.some((event) => event.type === 'model.completed')).toBe(false);
    expect(controller.signal.aborted).toBe(true);
  });

  it('a rule with `times` is used that many times, then later rules apply', async () => {
    const model = createTestModel([{ respond: { fail: 'rate-limit' }, times: 1 }, { respond: { text: 'recovered' } }]);
    expect((await collect(model.stream(request('x')))).at(-1)?.type).toBe('model.failed');
    expect((await collect(model.stream(request('x')))).find((event) => event.type === 'content.delta')).toMatchObject({ delta: 'recovered' });
  });
});
