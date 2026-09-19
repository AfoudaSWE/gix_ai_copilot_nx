import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopilotProvider } from '@gixcopilot/react';
import type { CopilotAccess } from '@gixcopilot/react';
import { CopilotChat } from './index.js';
import type { CopilotComponents, ToolActivityProps } from './index.js';

afterEach(() => {
  cleanup();
});

/**
 * @gixcopilot/ui must never depend on @gixcopilot/protocol directly (module boundary rule
 * in eslint.config.js) - these fixture events are plain object literals whose shape is
 * checked structurally against `CopilotAccess['client']`'s existing type, exactly like
 * components.spec.tsx's fixture does, with no protocol import needed.
 */
function base(sequence: number, runId: string, threadId: string) {
  return {
    id: `event-${sequence}`,
    runId,
    threadId,
    sequence,
    timestamp: '2026-09-19T00:00:00.000Z',
    protocolVersion: '1' as const,
  };
}

type RunReturn = ReturnType<CopilotAccess['client']['run']>;
type FixtureEvent = RunReturn['events'] extends AsyncIterable<infer TEvent> ? TEvent : never;

function fixture() {
  let push: ((event: FixtureEvent) => void) | undefined;
  let end: (() => void) | undefined;
  let threadId = '';
  const client: CopilotAccess['client'] = {
    run(options) {
      threadId = options.threadId ?? '';
      const queue: FixtureEvent[] = [];
      let wake = () => {};
      let ended = false;
      push = (event) => {
        queue.push(event);
        wake();
      };
      end = () => {
        ended = true;
        wake();
      };
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
    submitToolResult: vi.fn(() => Promise.resolve(undefined)),
  };
  return {
    client,
    push: (event: FixtureEvent) => push?.(event),
    end: () => end?.(),
    threadId: () => threadId,
  };
}

describe('tool activity rendering', () => {
  it('shows generic running/completed status for a tool call, without exposing raw arguments by default', async () => {
    const f = fixture();
    render(
      <CopilotProvider client={f.client}>
        <CopilotChat />
      </CopilotProvider>,
    );

    const input = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'What is APP-1024 status?' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
      await Promise.resolve();
    });

    const runId = 'run-1';
    await act(async () => {
      f.push({ ...base(1, runId, f.threadId()), type: 'run.started' });
      f.push({
        ...base(2, runId, f.threadId()),
        type: 'tool.requested',
        toolCallId: 'call-1',
        name: 'applications.getStatus',
        arguments: { applicationId: 'APP-1024', secret: 'do-not-show' },
        source: 'native',
      });
      await Promise.resolve();
    });

    const activity = document.querySelector('.gix-tool-activity');
    expect(activity).not.toBeNull();
    expect(activity?.textContent).toMatch(/Running/);
    expect(activity?.textContent).toMatch(/applications\.getStatus/);
    expect(activity?.textContent).not.toMatch(/do-not-show/);
    expect(activity?.textContent).not.toMatch(/APP-1024/);

    await act(async () => {
      f.push({ ...base(3, runId, f.threadId()), type: 'tool.started', toolCallId: 'call-1', name: 'applications.getStatus' });
      f.push({
        ...base(4, runId, f.threadId()),
        type: 'tool.completed',
        toolCallId: 'call-1',
        name: 'applications.getStatus',
        result: { status: 'PENDING' },
      });
      await Promise.resolve();
    });

    expect(document.querySelector('.gix-tool-activity')?.textContent).toMatch(/completed/);
    expect(screen.queryByText(/PENDING/)).toBeNull();
    f.end();
  });

  it('allows a host to override the ToolActivity slot entirely', async () => {
    const f = fixture();
    function CustomActivity({ toolCalls }: ToolActivityProps) {
      return <div data-testid="custom-activity">{toolCalls.length} active</div>;
    }
    const components: CopilotComponents = { ToolActivity: CustomActivity };
    render(
      <CopilotProvider client={f.client}>
        <CopilotChat components={components} />
      </CopilotProvider>,
    );

    const input = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'Add 1 and 2' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
      await Promise.resolve();
    });
    const runId = 'run-1';
    await act(async () => {
      f.push({ ...base(1, runId, f.threadId()), type: 'run.started' });
      f.push({
        ...base(2, runId, f.threadId()),
        type: 'tool.requested',
        toolCallId: 'call-1',
        name: 'math.add',
        arguments: {},
        source: 'native',
      });
      await Promise.resolve();
    });

    expect(screen.getByTestId('custom-activity').textContent).toBe('1 active');
    f.end();
  });
});
