import { describe, expect, it } from 'vitest';
import { createThreadId, createRunId } from '@aicopilot/protocol';
import { createEchoExecutor } from './echo-executor.js';

async function collect(executor: ReturnType<typeof createEchoExecutor>, text: string) {
  const controller = new AbortController();
  const chunks: string[] = [];
  for await (const chunk of executor.execute(
    {
      threadId: createThreadId(),
      messages: [{ role: 'user', content: [{ type: 'text', text }] }],
    },
    { runId: createRunId(), signal: controller.signal },
  )) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('createEchoExecutor', () => {
  it('splits input into word/whitespace chunks, matching the Phase 1 demonstration', async () => {
    const executor = createEchoExecutor();
    const chunks = await collect(executor, 'Hello protocol');
    expect(chunks).toEqual(['Hello', ' ', 'protocol']);
  });

  it('reassembles back to the original text when chunks are concatenated', async () => {
    const executor = createEchoExecutor();
    const text = '  multiple   spaces and words  ';
    const chunks = await collect(executor, text);
    expect(chunks.join('')).toBe(text);
  });

  it('yields nothing for empty input', async () => {
    const executor = createEchoExecutor();
    const chunks = await collect(executor, '');
    expect(chunks).toEqual([]);
  });

  it('echoes only the latest message, ignoring earlier conversation history', async () => {
    const executor = createEchoExecutor();
    const chunks: string[] = [];
    for await (const chunk of executor.execute(
      {
        threadId: createThreadId(),
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'ignored' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'also ignored' }] },
          { role: 'user', content: [{ type: 'text', text: 'latest' }] },
        ],
      },
      { runId: createRunId(), signal: new AbortController().signal },
    )) {
      chunks.push(chunk);
    }
    expect(chunks.join('')).toBe('latest');
  });

  it('stops yielding once its signal is already aborted', async () => {
    const executor = createEchoExecutor();
    const controller = new AbortController();
    controller.abort();
    const chunks: string[] = [];
    for await (const chunk of executor.execute(
      {
        threadId: createThreadId(),
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello protocol' }] }],
      },
      { runId: createRunId(), signal: controller.signal },
    )) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([]);
  });
});
