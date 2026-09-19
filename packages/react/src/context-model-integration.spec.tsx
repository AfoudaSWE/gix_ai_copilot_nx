import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CopilotClient, RunOptions } from '@gixcopilot/client';
import type { ContentPart } from '@gixcopilot/protocol';
import { CopilotProvider, useCopilotChat, useCopilotContext } from './index.js';

afterEach(() => {
  cleanup();
});

function textOf(part: ContentPart | undefined): string {
  return part?.type === 'text' ? part.text : '';
}

function stubClient(): { client: CopilotClient; runs: RunOptions[] } {
  const runs: RunOptions[] = [];
  const client: CopilotClient = {
    run(options) {
      runs.push(options);
      return { cancel: vi.fn(), events: { async *[Symbol.asyncIterator]() {} } };
    },
    submitToolResult: vi.fn(() => Promise.resolve(undefined)),
    decideApproval: vi.fn(() => Promise.resolve(undefined)),
  };
  return { client, runs };
}

/**
 * Section 73/91's mandatory outcome: resolved context must actually reach the model
 * request, not merely sit in the registry. This exercises the full react-level path -
 * `useCopilotContext` -> registry -> engine -> `chat-store.consume()` -> `client.run()` -
 * the same seam `provider.tsx` wires into the real HTTP client in production.
 */
describe('resolved application context reaches the model request', () => {
  it('prepends a system message with the resolved context ahead of conversation history', async () => {
    const { client, runs } = stubClient();
    const { result } = renderHook(
      () => {
        useCopilotContext({
          name: 'selectedApplication',
          description: 'Application currently selected by the user',
          scope: 'page',
          priority: 'high',
          value: { id: 'APP-1024', status: 'pending' },
        });
        return useCopilotChat();
      },
      { wrapper: ({ children }) => <CopilotProvider client={client}>{children}</CopilotProvider> },
    );

    await act(async () => {
      result.current.sendMessage('What application am I looking at?');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runs).toHaveLength(1);
    const messages = runs[0]?.messages ?? [];
    expect(messages[0]?.role).toBe('system');
    const systemText = textOf(messages[0]?.content[0]);
    expect(systemText).toContain('[Context: selectedApplication]');
    expect(systemText).toContain('APP-1024');
    expect(messages[1]?.role).toBe('user');
  });

  it('sends no system message when nothing is registered (Section 64 backward compatibility)', async () => {
    const { client, runs } = stubClient();
    const { result } = renderHook(() => useCopilotChat(), {
      wrapper: ({ children }) => <CopilotProvider client={client}>{children}</CopilotProvider>,
    });
    await act(async () => {
      result.current.sendMessage('Hi');
      await Promise.resolve();
    });
    expect(runs[0]?.messages.map((message) => message.role)).toEqual(['user']);
  });

  it('reflects a context value change on the next send (Section 53)', async () => {
    const { client, runs } = stubClient();
    const { result, rerender } = renderHook(
      ({ selected }: { selected: string }) => {
        useCopilotContext({ id: 'selected', name: 'selected', scope: 'page', value: selected });
        return useCopilotChat();
      },
      {
        wrapper: ({ children }) => <CopilotProvider client={client}>{children}</CopilotProvider>,
        initialProps: { selected: 'APP-1001' },
      },
    );
    await act(async () => {
      result.current.sendMessage('first');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(textOf(runs[0]?.messages[0]?.content[0])).toContain('APP-1001');

    rerender({ selected: 'APP-1003' });
    act(() => {
      result.current.clear();
    });
    await act(async () => {
      result.current.sendMessage('second');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(textOf(runs[1]?.messages[0]?.content[0])).toContain('APP-1003');
    expect(textOf(runs[1]?.messages[0]?.content[0])).not.toContain('APP-1001');
  });
});
