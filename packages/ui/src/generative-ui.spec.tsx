import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CopilotProvider, useGenerativeComponent, useToolRenderer } from '@gixcopilot/react';
import type { CopilotAccess } from '@gixcopilot/react';
import { CopilotChat } from './index.js';

afterEach(() => {
  cleanup();
});

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
  const submitted: { toolCallId: string }[] = [];
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
    submitToolResult: vi.fn((_runId: string, toolCallId: string) => {
      submitted.push({ toolCallId });
      return Promise.resolve(undefined);
    }),
  };
  return {
    client,
    push: (event: FixtureEvent) => push?.(event),
    end: () => end?.(),
    threadId: () => threadId,
    submitted,
  };
}

const ApplicationCard = ({ applicationId, status }: { applicationId: string; status: string }) => (
  <div data-testid="application-card">
    {applicationId}: {status}
  </div>
);

describe('generative UI in CopilotChat (Phase 6)', () => {
  it('renders a registered component automatically once its reserved tool call succeeds', async () => {
    const f = fixture();
    function Registrations() {
      useGenerativeComponent({
        name: 'ApplicationCard',
        description: 'Displays a compact summary of one application.',
        props: z.object({ applicationId: z.string(), status: z.string() }),
        component: ApplicationCard,
      });
      return null;
    }
    render(
      <CopilotProvider client={f.client}>
        <Registrations />
        <CopilotChat />
      </CopilotProvider>,
    );

    const input = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'Show APP-1024' } });
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
        name: 'ui.render.applicationCard',
        arguments: { applicationId: 'APP-1024', status: 'pending' },
        source: 'frontend',
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // Mirrors the real server relaying a submitted frontend-tool result back over SSE.
    await act(async () => {
      f.push({
        ...base(3, runId, f.threadId()),
        type: 'tool.completed',
        toolCallId: 'call-1',
        name: 'ui.render.applicationCard',
        result: { component: 'ApplicationCard', props: { applicationId: 'APP-1024', status: 'pending' } },
      });
      await Promise.resolve();
    });

    expect(f.submitted).toEqual([{ toolCallId: 'call-1' }]);
    expect(await screen.findByTestId('application-card')).toHaveProperty('textContent', 'APP-1024: pending');
    f.end();
  });

  it('a custom useToolRenderer overrides the default activity row for its tool', async () => {
    const f = fixture();
    function Registrations() {
      useToolRenderer({
        tool: 'applications.getStatus',
        render: ({ status }) => <span data-testid="custom-row">custom:{status}</span>,
      });
      return null;
    }
    render(
      <CopilotProvider client={f.client}>
        <Registrations />
        <CopilotChat />
      </CopilotProvider>,
    );
    const input = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'status?' } });
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
        arguments: { applicationId: 'APP-1024' },
        source: 'native',
      });
      await Promise.resolve();
    });
    expect(screen.getByTestId('custom-row').textContent).toBe('custom:requested');
    expect(document.querySelector('.gix-tool-activity')?.textContent).not.toMatch(/Running/);
    f.end();
  });

  it('isolates a throwing custom renderer with a safe fallback row (Section 56)', async () => {
    const f = fixture();
    function Registrations() {
      useToolRenderer({
        tool: 'applications.getStatus',
        render: () => {
          throw new Error('boom');
        },
      });
      return null;
    }
    render(
      <CopilotProvider client={f.client}>
        <Registrations />
        <CopilotChat />
      </CopilotProvider>,
    );
    const input = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(input, { target: { value: 'status?' } });
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
        arguments: { applicationId: 'APP-1024' },
        source: 'native',
      });
      await Promise.resolve();
    });
    expect(document.querySelector('.gix-tool-activity')?.textContent).toMatch(
      /could not be displayed/,
    );
    f.end();
  });
});
