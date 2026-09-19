import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopilotError, PROTOCOL_VERSION } from '@gixcopilot/protocol';
import type { ContentPart, CopilotEvent, CopilotEventBase } from '@gixcopilot/protocol';
import type { CopilotClient, RunOptions } from '@gixcopilot/client';
import {
  CopilotProvider,
  useCopilot,
  useCopilotChat,
  useCopilotStatus,
  useThread,
} from './index.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function textOf(part: ContentPart | undefined): string {
  return part?.type === 'text' ? part.text : '';
}

function fixture() {
  const runs: {
    options: RunOptions;
    push: (event: CopilotEvent) => void;
    end: () => void;
    cancel: ReturnType<typeof vi.fn>;
  }[] = [];
  const client: CopilotClient = {
    run(options) {
      const queue: CopilotEvent[] = [];
      let wake = () => {};
      let ended = false;
      const cancel = vi.fn(); // Intentionally ignores cancellation to exercise stale protection.
      runs.push({
        options,
        cancel,
        push: (event) => {
          queue.push(event);
          wake();
        },
        end: () => {
          ended = true;
          wake();
        },
      });
      return {
        cancel,
        events: {
          async *[Symbol.asyncIterator]() {
            while (!ended || queue.length) {
              const event = queue.shift();
              if (event) yield event;
              else
                await new Promise<void>((resolve) => {
                  wake = resolve;
                });
            }
          },
        },
      };
    },
    submitToolResult: vi.fn(() => Promise.resolve(undefined)),
    decideApproval: vi.fn(() => Promise.resolve(undefined)),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <CopilotProvider client={client}>{children}</CopilotProvider>
    </StrictMode>
  );
  function event(
    index: number,
    type: CopilotEvent['type'],
    sequence: number,
    delta = 'Hello',
  ): CopilotEvent {
    const base: CopilotEventBase = {
      id: `event-${sequence}`,
      runId: `run-${index}`,
      threadId: runs[index]?.options.threadId ?? '',
      timestamp: '2026-09-19T00:00:00.000Z',
      protocolVersion: PROTOCOL_VERSION,
      sequence,
    };
    switch (type) {
      case 'run.started':
      case 'run.cancelled':
        return { ...base, type };
      case 'message.started':
        return { ...base, type, messageId: `assistant-${index}`, role: 'assistant' };
      case 'message.delta':
        return { ...base, type, messageId: `assistant-${index}`, delta };
      case 'message.end':
        return {
          ...base,
          type,
          messageId: `assistant-${index}`,
          content: [{ type: 'text', text: delta }],
        };
      case 'run.completed':
        return {
          ...base,
          type,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          finishReason: 'stop',
        };
      case 'run.failed':
      case 'error':
        return { ...base, type, error: CopilotError.networkError('disconnected').toPublicJSON() };
      case 'tool.requested':
      case 'tool.started':
      case 'tool.completed':
      case 'tool.failed':
      case 'approval.requested':
      case 'approval.approved':
      case 'approval.rejected':
      case 'approval.expired':
        throw new Error(`This test fixture does not construct "${type}" events.`);
    }
  }
  async function push(index: number, type: CopilotEvent['type'], sequence: number, delta?: string) {
    await act(async () => {
      runs[index]?.push(event(index, type, sequence, delta));
      await Promise.resolve();
    });
  }
  return { client, runs, wrapper, event, push };
}

describe('headless React adapter', () => {
  it('streams one assistant message in StrictMode and sends full multi-turn history', async () => {
    const f = fixture();
    const { result } = renderHook(useCopilotChat, { wrapper: f.wrapper });
    expect(f.runs).toHaveLength(0);
    const send = result.current.sendMessage;
    act(() => {
      expect(send(' ')).toBe(false);
      expect(send('Hi')).toBe(true);
      expect(send('busy')).toBe(false);
    });
    expect(f.runs).toHaveLength(1);
    expect(result.current.status).toBe('submitting');
    await f.push(0, 'run.started', 1);
    await f.push(0, 'message.started', 2);
    await f.push(0, 'message.delta', 3, 'Hel');
    expect(textOf(result.current.messages[1]?.content[0])).toBe('Hel');
    expect(result.current.status).toBe('streaming');
    await f.push(0, 'message.delta', 3, 'duplicate');
    await f.push(0, 'message.delta', 4, 'lo');
    expect(result.current.messages).toHaveLength(2);
    expect(textOf(result.current.messages[1]?.content[0])).toBe('Hello');
    await f.push(0, 'message.end', 5);
    await f.push(0, 'run.completed', 6);
    expect(result.current.status).toBe('completed');
    expect(result.current.sendMessage).toBe(send);
    act(() => {
      send('Next');
    });
    expect(f.runs[1]?.options.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    act(() => result.current.stop());
    f.runs.forEach((run) => run.end());
  });

  it('stops the client, retains partial text, and ignores stale/foreign events after a new send', async () => {
    const f = fixture();
    const { result } = renderHook(useCopilotChat, { wrapper: f.wrapper });
    act(() => {
      result.current.sendMessage('A');
    });
    await f.push(0, 'run.started', 1);
    await f.push(0, 'message.started', 2);
    await f.push(0, 'message.delta', 3, 'partial');
    act(() => {
      result.current.stop();
      result.current.stop();
    });
    expect(f.runs[0]?.cancel).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('stopped');
    expect(result.current.messages[1]?.status).toBe('stopped');
    act(() => {
      result.current.sendMessage('B');
    });
    await f.push(0, 'message.delta', 4, 'OLD');
    await f.push(1, 'run.started', 1);
    await act(async () => {
      f.runs[1]?.push(f.event(0, 'message.delta', 10, 'FOREIGN'));
      await Promise.resolve();
    });
    await f.push(1, 'message.started', 2);
    await f.push(1, 'message.delta', 3, 'new');
    expect(textOf(result.current.messages.at(-1)?.content[0])).toBe('new');
    expect(JSON.stringify(result.current.messages)).not.toMatch(/OLD|FOREIGN/);
    f.runs.forEach((run) => run.end());
  });

  it('distinguishes retry from regenerate and clears local history with cancellation', async () => {
    const f = fixture();
    const { result } = renderHook(useCopilotChat, { wrapper: f.wrapper });
    act(() => {
      result.current.sendMessage('Keep my question');
    });
    const userId = result.current.messages[0]?.id;
    await f.push(0, 'run.started', 1);
    await f.push(0, 'message.started', 2);
    await f.push(0, 'run.failed', 3);
    expect(result.current.status).toBe('error');
    act(() => {
      expect(result.current.regenerate()).toBe(false);
      expect(result.current.retry()).toBe(true);
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.id).toBe(userId);
    await f.push(1, 'run.started', 1);
    await f.push(1, 'message.started', 2);
    await f.push(1, 'message.end', 3);
    await f.push(1, 'run.completed', 4);
    act(() => {
      expect(result.current.retry()).toBe(false);
      expect(result.current.regenerate()).toBe(true);
    });
    expect(f.runs[2]?.options.messages).toEqual(f.runs[0]?.options.messages);
    act(() => result.current.clear());
    expect(f.runs[2]?.cancel).toHaveBeenCalled();
    expect(result.current).toMatchObject({
      messages: [],
      thread: null,
      status: 'idle',
      error: null,
    });
    f.runs.forEach((run) => run.end());
  });

  it('handles truncated streams and synchronous failures without losing submitted text', async () => {
    const f = fixture();
    const { result, unmount } = renderHook(useCopilotChat, { wrapper: f.wrapper });
    act(() => {
      result.current.sendMessage('retained');
      f.runs[0]?.end();
    });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(textOf(result.current.messages[0]?.content[0])).toBe('retained');
    unmount();
    const client: CopilotClient = {
      run() {
        throw new Error('private detail');
      },
      submitToolResult: vi.fn(() => Promise.resolve(undefined)),
      decideApproval: vi.fn(() => Promise.resolve(undefined)),
    };
    const hook = renderHook(useCopilotChat, {
      wrapper: ({ children }) => <CopilotProvider client={client}>{children}</CopilotProvider>,
    });
    act(() => {
      hook.result.current.sendMessage('also retained');
    });
    expect(hook.result.current.error?.message).not.toContain('private detail');
    expect(hook.result.current.status).toBe('error');
  });

  it('cleans up on unmount and configuration changes, and isolates providers', () => {
    const a = fixture();
    const b = fixture();
    const one = renderHook(useCopilotChat, { wrapper: a.wrapper });
    const two = renderHook(useCopilotChat, { wrapper: b.wrapper });
    act(() => {
      one.result.current.sendMessage('only A');
    });
    expect(two.result.current.messages).toHaveLength(0);
    const staleSend = one.result.current.sendMessage;
    one.unmount();
    expect(a.runs[0]?.cancel).toHaveBeenCalled();
    expect(staleSend('after unmount')).toBe(false);
    let access: ReturnType<typeof useCopilotChat> | undefined;
    function Consumer() {
      access = useCopilotChat();
      return null;
    }
    const view = render(
      <CopilotProvider client={a.client}>
        <Consumer />
      </CopilotProvider>,
    );
    act(() => {
      access?.sendMessage('change client');
    });
    view.rerender(
      <CopilotProvider client={b.client}>
        <Consumer />
      </CopilotProvider>,
    );
    expect(a.runs[1]?.cancel).toHaveBeenCalled();
    expect(access?.messages).toHaveLength(0);
    a.runs.forEach((run) => run.end());
  });

  it('creates a URL client lazily, sends to its runs endpoint, and is SSR safe', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('failure', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(useCopilotChat, {
      wrapper: ({ children }) => (
        <CopilotProvider runtimeUrl="/api/copilot">{children}</CopilotProvider>
      ),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => {
      result.current.sendMessage('Hi');
    });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/copilot/runs');
    function Status() {
      return <span>{useCopilotStatus()}</span>;
    }
    expect(
      renderToString(
        <CopilotProvider runtimeUrl="/api/copilot">
          <Status />
        </CopilotProvider>,
      ),
    ).toContain('idle');
  });

  it('does not rerender host, action-only, status-only or thread-only consumers on deltas', async () => {
    const f = fixture();
    const renders = { host: 0, actions: 0, status: 0, thread: 0 };
    let send: (text: string) => boolean = () => false;
    function Host() {
      renders.host++;
      return <div>Host app</div>;
    }
    function Actions() {
      renders.actions++;
      send = useCopilot().sendMessage;
      return null;
    }
    function Status() {
      renders.status++;
      useCopilotStatus();
      return null;
    }
    function Thread() {
      renders.thread++;
      useThread();
      return null;
    }
    render(
      <f.wrapper>
        <Host />
        <Actions />
        <Status />
        <Thread />
      </f.wrapper>,
    );
    act(() => {
      send('hi');
    });
    await f.push(0, 'run.started', 1);
    await f.push(0, 'message.started', 2);
    await f.push(0, 'message.delta', 3, 'a');
    const before = { ...renders };
    for (let sequence = 4; sequence <= 23; sequence++)
      await f.push(0, 'message.delta', sequence, 'b');
    expect(renders).toEqual(before);
    f.runs[0]?.end();
  });
});
