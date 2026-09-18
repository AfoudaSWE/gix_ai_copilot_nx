import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@aicopilot/protocol';
import type { CopilotEvent } from '@aicopilot/protocol';
import { createRuntime } from './runtime.js';
import { createEchoExecutor } from './echo-executor.js';
import type { Executor } from './executor.js';

function userMessage(text: string) {
  return { role: 'user' as const, content: [{ type: 'text' as const, text }] };
}

async function drain(events: AsyncIterable<CopilotEvent>): Promise<CopilotEvent[]> {
  const collected: CopilotEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

describe('createRuntime', () => {
  it('produces the full run.started -> message.* -> run.completed sequence for a deterministic executor', async () => {
    const runtime = createRuntime({ executor: createEchoExecutor() });
    const run = runtime.run({ messages: [userMessage('Hello protocol')] });
    const events = await drain(run.events);

    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'message.started',
      'message.delta',
      'message.delta',
      'message.delta',
      'message.end',
      'run.completed',
    ]);

    const deltas = events.filter((event) => event.type === 'message.delta');
    expect(
      deltas.map((event) => (event.type === 'message.delta' ? event.delta : undefined)),
    ).toEqual(['Hello', ' ', 'protocol']);

    const end = events.find((event) => event.type === 'message.end');
    expect(end?.type === 'message.end' && end.content).toEqual([
      { type: 'text', text: 'Hello protocol' },
    ]);

    const completed = events.find((event) => event.type === 'run.completed');
    expect(completed?.type === 'run.completed' && completed.usage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
    expect(completed?.type === 'run.completed' && completed.finishReason).toBeUndefined();
  });

  it('passes the full conversation history to the executor, not just the latest turn', async () => {
    const seenInputs: { role: string }[][] = [];
    const recordingExecutor: Executor = {
      async *execute(input) {
        await Promise.resolve();
        seenInputs.push(input.messages.map((m) => ({ role: m.role })));
        yield 'ok';
      },
    };
    const runtime = createRuntime({ executor: recordingExecutor });
    const run = runtime.run({
      messages: [
        { role: 'system', content: [{ type: 'text', text: 'be helpful' }] },
        userMessage('hi'),
        { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
        userMessage('and now?'),
      ],
    });
    await drain(run.events);

    expect(seenInputs).toEqual([
      [{ role: 'system' }, { role: 'user' }, { role: 'assistant' }, { role: 'user' }],
    ]);
  });

  it("surfaces an executor's reported usage and finishReason on run.completed", async () => {
    const executor: Executor = {
      async *execute() {
        await Promise.resolve();
        yield 'hi';
        return { usage: { inputTokens: 3, outputTokens: 1, totalTokens: 4 }, finishReason: 'stop' };
      },
    };
    const runtime = createRuntime({ executor });
    const run = runtime.run({ messages: [userMessage('hi')] });
    const events = await drain(run.events);

    const completed = events.find((event) => event.type === 'run.completed');
    expect(completed?.type === 'run.completed' && completed.usage).toEqual({
      inputTokens: 3,
      outputTokens: 1,
      totalTokens: 4,
    });
    expect(completed?.type === 'run.completed' && completed.finishReason).toBe('stop');
  });

  it('shares one runId/threadId across every event, with strictly increasing sequence numbers', async () => {
    const runtime = createRuntime({ executor: createEchoExecutor() });
    const run = runtime.run({ messages: [userMessage('Hi')] });
    const events = await drain(run.events);

    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
    for (const event of events) {
      expect(event.runId).toBe(run.runId);
      expect(event.threadId).toBe(run.threadId);
      expect(event.protocolVersion).toBe(PROTOCOL_VERSION);
    }
  });

  it('generates a fresh threadId when none is supplied, and reuses a supplied one', () => {
    const runtime = createRuntime({ executor: createEchoExecutor() });
    const withoutThread = runtime.run({ messages: [userMessage('Hi')] });
    expect(withoutThread.threadId).toBeTruthy();

    const suppliedThreadId = runtime.run({ messages: [userMessage('Hi')] }).threadId;
    const reused = createRuntime({ executor: createEchoExecutor() }).run({
      threadId: suppliedThreadId,
      messages: [userMessage('Hi')],
    });
    expect(reused.threadId).toBe(suppliedThreadId);
  });

  it('stops with no deltas once cancel() is called between message.started and the first delta', async () => {
    const runtime = createRuntime({ executor: createEchoExecutor() });
    const run = runtime.run({ messages: [userMessage('Hello protocol')] });
    const iterator = run.events[Symbol.asyncIterator]() as AsyncIterator<
      CopilotEvent,
      void,
      undefined
    >;

    const first = await iterator.next();
    const second = await iterator.next();
    expect([first.value?.type, second.value?.type]).toEqual(['run.started', 'message.started']);

    run.cancel();

    const rest: CopilotEvent[] = [];
    let result = await iterator.next();
    while (!result.done) {
      rest.push(result.value);
      result = await iterator.next();
    }

    expect(rest.map((event) => event.type)).toEqual(['run.cancelled']);
  });

  it('emits only run.cancelled if cancelled before any event is pulled', async () => {
    const runtime = createRuntime({ executor: createEchoExecutor() });
    const run = runtime.run({ messages: [userMessage('Hi')] });
    run.cancel();
    const events = await drain(run.events);
    expect(events.map((event) => event.type)).toEqual(['run.cancelled']);
  });

  it('respects an externally supplied AbortSignal', async () => {
    const runtime = createRuntime({ executor: createEchoExecutor() });
    const external = new AbortController();
    const run = runtime.run({ messages: [userMessage('Hi')], signal: external.signal });
    external.abort();
    const events = await drain(run.events);
    expect(events.map((event) => event.type)).toEqual(['run.cancelled']);
  });

  it('cancel() is idempotent, including after the run has already completed', async () => {
    const runtime = createRuntime({ executor: createEchoExecutor() });
    const run = runtime.run({ messages: [userMessage('Hi')] });
    const events = await drain(run.events);
    expect(events.at(-1)?.type).toBe('run.completed');
    expect(() => {
      run.cancel();
      run.cancel();
    }).not.toThrow();
  });

  it('throws if events is iterated a second time', async () => {
    const runtime = createRuntime({ executor: createEchoExecutor() });
    const run = runtime.run({ messages: [userMessage('Hi')] });
    await drain(run.events);
    expect(() => run.events[Symbol.asyncIterator]()).toThrow(/single-use/);
  });

  it('emits run.failed with a normalized error when the executor throws', async () => {
    const throwingExecutor: Executor = {
      async *execute() {
        await Promise.resolve();
        yield 'partial';
        throw new Error('executor exploded');
      },
    };
    const runtime = createRuntime({ executor: throwingExecutor });
    const run = runtime.run({ messages: [userMessage('Hi')] });
    const events = await drain(run.events);

    expect(events.map((event) => event.type)).toEqual([
      'run.started',
      'message.started',
      'message.delta',
      'run.failed',
    ]);
    const failed = events.find((event) => event.type === 'run.failed');
    expect(failed?.type === 'run.failed' && failed.error.code).toBe('INTERNAL_ERROR');
    expect(failed?.type === 'run.failed' && failed.error.message).toBe('executor exploded');
  });
});
