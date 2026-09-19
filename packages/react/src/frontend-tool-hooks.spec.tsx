import { StrictMode, useState } from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { PROTOCOL_VERSION } from '@gixcopilot/protocol';
import type { CopilotEvent, CopilotEventBase, ToolResult } from '@gixcopilot/protocol';
import type { CopilotClient, RunOptions } from '@gixcopilot/client';
import { CopilotProvider, useCopilotChat, useFrontendTool } from './index.js';

afterEach(() => {
  cleanup();
});

function baseEvent(sequence: number, runId: string, threadId: string): CopilotEventBase {
  return {
    id: `event-${sequence}`,
    runId,
    threadId,
    sequence,
    timestamp: new Date().toISOString(),
    protocolVersion: PROTOCOL_VERSION,
  };
}

/**
 * A controllable fake client: `run()` returns an async-iterable event queue the test drives
 * manually, and records every `submitToolResult` call - enough to exercise the full
 * chat-store `tool.requested` -> local frontend execution -> `submitToolResult` round trip
 * (Section 45, 58) without any real network.
 */
function fixture() {
  const runs: { options: RunOptions; push: (event: CopilotEvent) => void; end: () => void }[] = [];
  const submittedResults: { runId: string; toolCallId: string; result: ToolResult }[] = [];
  const client: CopilotClient = {
    run(options) {
      const queue: CopilotEvent[] = [];
      let wake = () => {};
      let ended = false;
      runs.push({
        options,
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
        cancel: vi.fn(),
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
    submitToolResult: vi.fn((runId: string, toolCallId: string, result: ToolResult) => {
      submittedResults.push({ runId, toolCallId, result });
      return Promise.resolve(undefined);
    }),
    decideApproval: vi.fn(() => Promise.resolve(undefined)),
  };
  return { client, runs, submittedResults };
}

describe('useFrontendTool', () => {
  it('is StrictMode-safe (mount -> cleanup -> mount leaves exactly one live registration) and disposes cleanly on unmount', () => {
    const f = fixture();
    function Component() {
      useFrontendTool({
        name: 'nav.open',
        description: 'x',
        input: z.object({}),
        execute: () => Promise.resolve(undefined),
      });
      return null;
    }
    // A duplicate-name registration without { replace: true } throws (tool-registry.spec.ts)
    // - if StrictMode's mount->cleanup->mount left two live registrations, or if unmounting
    // failed to dispose the first, mounting a second instance of the same tool name below
    // would throw. Neither happens.
    expect(() => {
      const { unmount } = render(
        <StrictMode>
          <CopilotProvider client={f.client}>
            <Component />
          </CopilotProvider>
        </StrictMode>,
      );
      unmount();
    }).not.toThrow();
  });

  it('executes the registered frontend tool when the server requests it, and submits the result back', async () => {
    const f = fixture();
    const { result } = renderHook(
      () => {
        useFrontendTool({
          name: 'navigation.openApplication',
          description: 'Open an application details page',
          input: z.object({ applicationId: z.string() }),
          execute({ applicationId }) {
            return Promise.resolve({ opened: true, applicationId });
          },
        });
        return useCopilotChat();
      },
      { wrapper: ({ children }) => <CopilotProvider client={f.client}>{children}</CopilotProvider> },
    );

    act(() => {
      result.current.sendMessage('Open APP-1024');
    });
    expect(f.runs).toHaveLength(1);
    // The frontend tool manifest reaches the server as part of the run request.
    const tools = f.runs[0]?.options.tools;
    expect(tools).toHaveLength(1);
    expect(tools?.[0]).toMatchObject({
      name: 'navigation.openApplication',
      description: 'Open an application details page',
      executionLocation: 'client',
    });
    expect(tools?.[0]?.parameters).toMatchObject({ type: 'object' });

    const runId = 'run-1';
    const threadId = f.runs[0]?.options.threadId ?? '';
    await act(async () => {
      f.runs[0]?.push({ ...baseEvent(1, runId, threadId), type: 'run.started' });
      await Promise.resolve();
    });
    await act(async () => {
      f.runs[0]?.push({
        ...baseEvent(2, runId, threadId),
        type: 'tool.requested',
        toolCallId: 'call-1',
        name: 'navigation.openApplication',
        arguments: { applicationId: 'APP-1024' },
        source: 'frontend',
      });
      // Let the microtask queue drain the async executeFrontendTool()/submitToolResult().
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(f.submittedResults).toEqual([
      {
        runId,
        toolCallId: 'call-1',
        result: { status: 'success', toolCallId: 'call-1', data: { opened: true, applicationId: 'APP-1024' } },
      },
    ]);
    expect(result.current.toolCalls).toEqual([
      {
        id: 'call-1',
        name: 'navigation.openApplication',
        source: 'frontend',
        status: 'requested',
        arguments: { applicationId: 'APP-1024' },
      },
    ]);
    f.runs.forEach((run) => run.end());
  });

  it('submits a validation-error result without ever calling execute() when arguments are invalid', async () => {
    const f = fixture();
    const execute = vi.fn(() => Promise.resolve(undefined));
    const { result } = renderHook(
      () => {
        useFrontendTool({
          name: 'strict.tool',
          description: 'x',
          input: z.object({ count: z.number() }),
          execute,
        });
        return useCopilotChat();
      },
      { wrapper: ({ children }) => <CopilotProvider client={f.client}>{children}</CopilotProvider> },
    );

    act(() => {
      result.current.sendMessage('go');
    });
    const runId = 'run-1';
    const threadId = f.runs[0]?.options.threadId ?? '';
    await act(async () => {
      f.runs[0]?.push({ ...baseEvent(1, runId, threadId), type: 'run.started' });
      f.runs[0]?.push({
        ...baseEvent(2, runId, threadId),
        type: 'tool.requested',
        toolCallId: 'call-1',
        name: 'strict.tool',
        arguments: { count: 'not-a-number' },
        source: 'frontend',
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(execute).not.toHaveBeenCalled();
    expect(f.submittedResults[0]?.result.status).toBe('error');
    expect(
      f.submittedResults[0]?.result.status === 'error' && f.submittedResults[0].result.error.code,
    ).toBe('VALIDATION_ERROR');
    f.runs.forEach((run) => run.end());
  });

  it('always executes against the current render closure, not a stale one (Section 48)', async () => {
    const f = fixture();
    let bump: (() => void) | undefined;
    function Multiplier() {
      const [multiplier, setMultiplier] = useState(1);
      bump = () => setMultiplier(10);
      useFrontendTool({
        name: 'math.scale',
        description: 'x',
        input: z.object({ value: z.number() }),
        execute({ value }) {
          return Promise.resolve({ result: value * multiplier });
        },
      });
      return null;
    }
    const { result } = renderHook(
      () => {
        return useCopilotChat();
      },
      {
        wrapper: ({ children }) => (
          <CopilotProvider client={f.client}>
            <Multiplier />
            {children}
          </CopilotProvider>
        ),
      },
    );

    act(() => {
      bump?.();
    });

    act(() => {
      result.current.sendMessage('scale it');
    });
    const runId = 'run-1';
    const threadId = f.runs[0]?.options.threadId ?? '';
    await act(async () => {
      f.runs[0]?.push({ ...baseEvent(1, runId, threadId), type: 'run.started' });
      f.runs[0]?.push({
        ...baseEvent(2, runId, threadId),
        type: 'tool.requested',
        toolCallId: 'call-1',
        name: 'math.scale',
        arguments: { value: 5 },
        source: 'frontend',
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // multiplier is 10 (post-bump) at call time, not the 1 it was when the tool was first
    // registered - proves execute() reads the current closure, not a stale one.
    expect(f.submittedResults[0]?.result).toEqual({
      status: 'success',
      toolCallId: 'call-1',
      data: { result: 50 },
    });
    f.runs.forEach((run) => run.end());
  });
});
