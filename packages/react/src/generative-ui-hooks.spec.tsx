import { StrictMode } from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { PROTOCOL_VERSION } from '@gixcopilot/protocol';
import type { CopilotEvent, CopilotEventBase, ToolResult } from '@gixcopilot/protocol';
import type { CopilotClient, RunOptions } from '@gixcopilot/client';
import {
  CopilotProvider,
  useCopilotChat,
  useCopilotState,
  useFrontendTool,
  useGenerativeComponent,
  useGenerativeUIRequests,
  useInvokeTool,
  useResolveToolRenderer,
  useToolCalls,
  useToolRenderer,
} from './index.js';

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

const ApplicationCard = ({ applicationId, status }: { applicationId: string; status: string }) => (
  <div data-testid="application-card">
    {applicationId} is {status}
  </div>
);

describe('useGenerativeComponent', () => {
  it('is StrictMode-safe and advertises a reserved ui.render.<Name> tool in the manifest', () => {
    const f = fixture();
    function Component() {
      useGenerativeComponent({
        name: 'ApplicationCard',
        description: 'Displays a compact summary of one application.',
        props: z.object({ applicationId: z.string(), status: z.string() }),
        component: ApplicationCard,
      });
      return useCopilotChat();
    }
    const { result, unmount } = renderHook(Component, {
      wrapper: ({ children }) => (
        <StrictMode>
          <CopilotProvider client={f.client}>{children}</CopilotProvider>
        </StrictMode>
      ),
    });
    act(() => {
      result.current.sendMessage('show it');
    });
    const tools = f.runs[0]?.options.tools;
    expect(tools).toHaveLength(1);
    expect(tools?.[0]).toMatchObject({
      name: 'ui.render.applicationCard',
      executionLocation: 'client',
    });
    expect(() => unmount()).not.toThrow();
  });

  it('renders the registered component once the model requests it, with validated props', async () => {
    const f = fixture();
    function Harness() {
      useGenerativeComponent({
        name: 'ApplicationCard',
        description: 'Displays a compact summary of one application.',
        props: z.object({ applicationId: z.string(), status: z.string() }),
        component: ApplicationCard,
      });
      const chat = useCopilotChat();
      const toolCalls = useToolCalls();
      const resolveRenderer = useResolveToolRenderer();
      return (
        <div>
          <button type="button" onClick={() => chat.sendMessage('show APP-1024')}>
            ask
          </button>
          {toolCalls.map((toolCall) => (
            <div key={toolCall.id}>{resolveRenderer(toolCall)}</div>
          ))}
        </div>
      );
    }
    render(
      <CopilotProvider client={f.client}>
        <Harness />
      </CopilotProvider>,
    );

    act(() => screen.getByText('ask').click());
    const runId = 'run-1';
    const threadId = f.runs[0]?.options.threadId ?? '';
    await act(async () => {
      f.runs[0]?.push({ ...baseEvent(1, runId, threadId), type: 'run.started' });
      f.runs[0]?.push({
        ...baseEvent(2, runId, threadId),
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

    expect(f.submittedResults[0]?.result).toEqual({
      status: 'success',
      toolCallId: 'call-1',
      data: { component: 'ApplicationCard', props: { applicationId: 'APP-1024', status: 'pending' } },
    });
    // The real server relays the submitted result back as tool.completed over SSE; this fake
    // client only records the submission (see frontend-tool-hooks.spec.tsx's own tests), so
    // the test completes that round trip manually to reach a renderable 'succeeded' state.
    const submitted = f.submittedResults[0];
    await act(async () => {
      f.runs[0]?.push({
        ...baseEvent(3, runId, threadId),
        type: 'tool.completed',
        toolCallId: 'call-1',
        name: 'ui.render.applicationCard',
        result: submitted?.result.status === 'success' ? submitted.result.data : undefined,
      });
      await Promise.resolve();
    });
    expect((await screen.findByTestId('application-card')).textContent).toBe('APP-1024 is pending');
    f.runs.forEach((run) => run.end());
  });

  it('useGenerativeUIRequests projects only generative-UI activity, in order', async () => {
    const f = fixture();
    function Harness() {
      useGenerativeComponent({
        name: 'ApplicationCard',
        description: 'x',
        props: z.object({ applicationId: z.string(), status: z.string() }),
        component: ApplicationCard,
      });
      const chat = useCopilotChat();
      const requests = useGenerativeUIRequests();
      return (
        <div>
          <button type="button" onClick={() => chat.sendMessage('go')}>
            ask
          </button>
          <span data-testid="count">{requests.length}</span>
          <span data-testid="status">{requests[0]?.status ?? ''}</span>
        </div>
      );
    }
    render(
      <CopilotProvider client={f.client}>
        <Harness />
      </CopilotProvider>,
    );
    act(() => screen.getByText('ask').click());
    const runId = 'run-1';
    const threadId = f.runs[0]?.options.threadId ?? '';
    await act(async () => {
      f.runs[0]?.push({ ...baseEvent(1, runId, threadId), type: 'run.started' });
      f.runs[0]?.push({
        ...baseEvent(2, runId, threadId),
        type: 'tool.requested',
        toolCallId: 'call-1',
        name: 'ui.render.applicationCard',
        arguments: { applicationId: 'APP-1024' },
        source: 'frontend',
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('count').textContent).toBe('1');
    expect(screen.getByTestId('status').textContent).toBe('requested');
    f.runs.forEach((run) => run.end());
  });
});

describe('useToolRenderer', () => {
  it('overrides rendering for a specific tool, taking priority even while requested/running', async () => {
    const f = fixture();
    function Harness() {
      useToolRenderer({
        tool: 'applications.getStatus',
        render: ({ status }) => <span data-testid="custom">custom:{status}</span>,
      });
      const chat = useCopilotChat();
      const toolCalls = useToolCalls();
      const resolveRenderer = useResolveToolRenderer();
      return (
        <div>
          <button type="button" onClick={() => chat.sendMessage('go')}>
            ask
          </button>
          {toolCalls.map((toolCall) => (
            <div key={toolCall.id}>{resolveRenderer(toolCall)}</div>
          ))}
        </div>
      );
    }
    render(
      <CopilotProvider client={f.client}>
        <Harness />
      </CopilotProvider>,
    );
    act(() => screen.getByText('ask').click());
    const runId = 'run-1';
    const threadId = f.runs[0]?.options.threadId ?? '';
    await act(async () => {
      f.runs[0]?.push({ ...baseEvent(1, runId, threadId), type: 'run.started' });
      f.runs[0]?.push({
        ...baseEvent(2, runId, threadId),
        type: 'tool.requested',
        toolCallId: 'call-1',
        name: 'applications.getStatus',
        arguments: { applicationId: 'APP-1024' },
        source: 'native',
      });
      await Promise.resolve();
    });
    expect(screen.getByTestId('custom').textContent).toBe('custom:requested');
    f.runs.forEach((run) => run.end());
  });
});

describe('useCopilotState modelWritable', () => {
  it('advertises a reserved state.patch.<id> tool, and applying a valid patch updates the store', async () => {
    const f = fixture();
    let filters: { status: string } | undefined;
    function Harness() {
      const [value] = useCopilotState<{ status: string }>({
        id: 'filters',
        name: 'applicationFilters',
        initialValue: { status: 'all' },
        modelWritable: true,
      });
      filters = value;
      return useCopilotChat();
    }
    const { result } = renderHook(Harness, {
      wrapper: ({ children }) => <CopilotProvider client={f.client}>{children}</CopilotProvider>,
    });
    act(() => {
      result.current.sendMessage('set filter');
    });
    const tools = f.runs[0]?.options.tools;
    expect(tools?.some((tool) => tool.name === 'state.patch.filters')).toBe(true);

    const runId = 'run-1';
    const threadId = f.runs[0]?.options.threadId ?? '';
    await act(async () => {
      f.runs[0]?.push({ ...baseEvent(1, runId, threadId), type: 'run.started' });
      f.runs[0]?.push({
        ...baseEvent(2, runId, threadId),
        type: 'tool.requested',
        toolCallId: 'call-1',
        name: 'state.patch.filters',
        arguments: { op: 'set', value: { status: 'pending' }, baseRevision: 0 },
        source: 'frontend',
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(f.submittedResults[0]?.result).toEqual({
      status: 'success',
      toolCallId: 'call-1',
      data: { status: 'applied', revision: 1, value: { status: 'pending' } },
    });
    expect(filters).toEqual({ status: 'pending' });
    f.runs.forEach((run) => run.end());
  });

  it('does not register a patch tool when modelWritable is left off', () => {
    const f = fixture();
    function Harness() {
      useCopilotState<{ status: string }>({
        id: 'filters',
        name: 'applicationFilters',
        initialValue: { status: 'all' },
      });
      return useCopilotChat();
    }
    const { result } = renderHook(Harness, {
      wrapper: ({ children }) => <CopilotProvider client={f.client}>{children}</CopilotProvider>,
    });
    act(() => {
      result.current.sendMessage('go');
    });
    expect(f.runs[0]?.options.tools).toBeUndefined();
  });
});

describe('useInvokeTool', () => {
  it('invokes a registered frontend tool directly through the Tool Runtime, with no model round trip (Section 33-35)', async () => {
    const f = fixture();
    const onOpen = vi.fn();
    let invoke: ReturnType<typeof useInvokeTool> | undefined;
    function Harness() {
      useFrontendTool({
        name: 'navigation.openApplication',
        description: 'Open an application details view.',
        input: z.object({ applicationId: z.string() }),
        execute({ applicationId }) {
          onOpen(applicationId);
          return Promise.resolve({ opened: true, applicationId });
        },
      });
      invoke = useInvokeTool();
      return null;
    }
    render(
      <CopilotProvider localToolExecution client={f.client}>
        <Harness />
      </CopilotProvider>,
    );

    const result = await invoke?.('navigation.openApplication', { applicationId: 'APP-1024' });
    expect(onOpen).toHaveBeenCalledWith('APP-1024');
    expect(result).toMatchObject({ status: 'success', data: { opened: true, applicationId: 'APP-1024' } });
    expect(f.runs).toHaveLength(0); // no run/model call was ever made
  });

  it('rejects invalid arguments without ever calling execute()', async () => {
    const f = fixture();
    const execute = vi.fn(() => Promise.resolve(undefined));
    let invoke: ReturnType<typeof useInvokeTool> | undefined;
    function Harness() {
      useFrontendTool({
        name: 'strict.tool',
        description: 'x',
        input: z.object({ count: z.number() }),
        execute,
      });
      invoke = useInvokeTool();
      return null;
    }
    render(
      <CopilotProvider localToolExecution client={f.client}>
        <Harness />
      </CopilotProvider>,
    );

    const result = await invoke?.('strict.tool', { count: 'not-a-number' });
    expect(execute).not.toHaveBeenCalled();
    expect(result?.status).toBe('error');
    expect(result?.status === 'error' && result.error.code).toBe('VALIDATION_ERROR');
  });
});


describe('server-authorized generated actions', () => {
  it('routes generated button actions to the server and does not execute on denial', async () => {
    const f = fixture();
    const execute = vi.fn(() => Promise.resolve({ removed: true }));
    const { result } = renderHook(() => {
      useFrontendTool({ name: 'records.remove', description: 'Delete', input: z.object({ id: z.string() }), execute });
      return useInvokeTool();
    }, { wrapper: ({ children }) => <CopilotProvider client={f.client}>{children}</CopilotProvider> });
    let pending: Promise<ToolResult> | undefined;
    act(() => { pending = result.current('records.remove', { id: 'a' }); });
    expect(f.runs[0]?.options.action).toEqual({ name: 'records.remove', arguments: { id: 'a' } });
    await act(async () => {
      await Promise.resolve();
      f.runs[0]?.push({ ...baseEvent(1, 'r', 't'), type: 'run.started' });
      f.runs[0]?.push({ ...baseEvent(2, 'r', 't'), type: 'tool.failed', toolCallId: 'c', name: 'records.remove', error: { code: 'PERMISSION_DENIED', message: 'Not permitted', retryable: false } });
      f.runs[0]?.end();
    });
    expect((await pending)?.status).toBe('error');
    expect(execute).not.toHaveBeenCalled();
  });
});
