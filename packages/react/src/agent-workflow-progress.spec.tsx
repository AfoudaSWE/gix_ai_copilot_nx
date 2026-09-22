import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@gixcopilot/protocol';
import type { CopilotEvent, CopilotEventBase } from '@gixcopilot/protocol';
import type { CopilotClient, RunOptions } from '@gixcopilot/client';
import { CopilotProvider, useAgentDelegations, useAgentHandoffs, useAgentRun, useAgentRuns, useCopilotChat, useWorkflowRun, useWorkflowRuns } from './index.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * A minimal fixture (distinct from `provider.spec.tsx`'s own, which deliberately refuses to
 * construct agent/workflow events - Phase 10's headless hooks get their own coverage here
 * instead of widening that file's scope).
 */
function fixture() {
  const runs: { options: RunOptions; push: (event: CopilotEvent) => void; end: () => void }[] = [];
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
    submitToolResult: vi.fn(() => Promise.resolve(undefined)),
    decideApproval: vi.fn(() => Promise.resolve(undefined)),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <CopilotProvider client={client}>{children}</CopilotProvider>
    </StrictMode>
  );
  let seq = 0;
  function base(index: number): CopilotEventBase {
    seq += 1;
    return {
      id: `event-${seq}`,
      runId: `run-${index}`,
      threadId: runs[index]?.options.threadId ?? '',
      timestamp: '2026-09-19T00:00:00.000Z',
      protocolVersion: PROTOCOL_VERSION,
      sequence: seq,
    };
  }
  // A plain `Omit<CopilotEvent, keyof CopilotEventBase>` would collapse `keyof CopilotEvent`
  // to only the fields common to every union member first - the `T extends any ? ... : never`
  // form forces TypeScript to distribute the `Omit` over each variant individually instead,
  // so each event's own extra fields (agentId, workflowRunId, ...) stay visible below.
  type WithoutBase<T> = T extends CopilotEventBase ? Omit<T, keyof CopilotEventBase> : never;
  async function push(index: number, event: WithoutBase<CopilotEvent>) {
    await act(async () => {
      runs[index]?.push({ ...base(index), ...event });
      await Promise.resolve();
    });
  }
  return { client, runs, wrapper, push };
}

describe('headless agent/workflow progress hooks (Phase 10, Section 141)', () => {
  it('tracks a top-level agent run through to completion', async () => {
    const f = fixture();
    const { result } = renderHook(() => ({ chat: useCopilotChat(), runs: useAgentRuns() }), { wrapper: f.wrapper });
    act(() => {
      result.current.chat.sendMessage('go');
    });
    await f.push(0, { type: 'run.started' });
    await f.push(0, { type: 'agent.run.started', agentId: 'support', agentRunId: 'agent-run-1' });
    expect(result.current.runs).toEqual([
      { agentRunId: 'agent-run-1', agentId: 'support', rootRunId: undefined, parentRunId: undefined, status: 'running' },
    ]);
    await f.push(0, { type: 'agent.run.completed', agentId: 'support', agentRunId: 'agent-run-1' });
    expect(result.current.runs[0]?.status).toBe('completed');
    f.runs.forEach((run) => run.end());
  });

  it('tracks a delegation and a handoff independently of the agent-run timeline', async () => {
    const f = fixture();
    const { result } = renderHook(
      () => ({ chat: useCopilotChat(), delegations: useAgentDelegations(), handoffs: useAgentHandoffs() }),
      { wrapper: f.wrapper },
    );
    act(() => {
      result.current.chat.sendMessage('go');
    });
    await f.push(0, { type: 'run.started' });
    await f.push(0, {
      type: 'agent.delegation.started',
      fromAgentId: 'orchestrator',
      toAgentId: 'payments',
      delegationId: 'd1',
      depth: 1,
    });
    expect(result.current.delegations).toHaveLength(1);
    expect(result.current.delegations[0]?.status).toBe('started');
    await f.push(0, {
      type: 'agent.delegation.completed',
      fromAgentId: 'orchestrator',
      toAgentId: 'payments',
      delegationId: 'd1',
      status: 'completed',
    });
    expect(result.current.delegations[0]?.status).toBe('completed');

    await f.push(0, { type: 'agent.handoff', fromAgentId: 'support', toAgentId: 'payments', reason: 'billing issue' });
    expect(result.current.handoffs).toEqual([{ fromAgentId: 'support', toAgentId: 'payments', reason: 'billing issue' }]);
    f.runs.forEach((run) => run.end());
  });

  it('finding one agent run by id returns undefined until it has actually been observed', async () => {
    const f = fixture();
    const { result } = renderHook(() => ({ chat: useCopilotChat(), run: useAgentRun('agent-run-1') }), {
      wrapper: f.wrapper,
    });
    expect(result.current.run).toBeUndefined();
    act(() => {
      result.current.chat.sendMessage('go');
    });
    await f.push(0, { type: 'run.started' });
    await f.push(0, { type: 'agent.run.started', agentId: 'support', agentRunId: 'agent-run-1' });
    expect(result.current.run?.status).toBe('running');
    f.runs.forEach((run) => run.end());
  });

  it('tracks a workflow run and its steps, including a pause/resume cycle', async () => {
    const f = fixture();
    const { result } = renderHook(() => ({ chat: useCopilotChat(), run: useWorkflowRun('wf-run-1') }), {
      wrapper: f.wrapper,
    });
    act(() => {
      result.current.chat.sendMessage('go');
    });
    await f.push(0, { type: 'run.started' });
    await f.push(0, { type: 'workflow.run.started', workflowId: 'application-approval', workflowRunId: 'wf-run-1' });
    await f.push(0, {
      type: 'workflow.step.started',
      workflowRunId: 'wf-run-1',
      stepId: 'validate',
      stepType: 'function',
      attempt: 1,
    });
    expect(result.current.run?.steps).toEqual([
      { stepId: 'validate', stepType: 'function', status: 'running', attempt: 1, phase: undefined },
    ]);
    await f.push(0, { type: 'workflow.step.completed', workflowRunId: 'wf-run-1', stepId: 'validate', attempt: 1 });
    expect(result.current.run?.steps[0]?.status).toBe('completed');

    await f.push(0, {
      type: 'workflow.run.paused',
      workflowId: 'application-approval',
      workflowRunId: 'wf-run-1',
      reason: 'approval',
      stepId: 'supervisor-approval',
    });
    expect(result.current.run?.status).toBe('paused');
    expect(result.current.run?.pauseReason).toBe('approval');

    await f.push(0, { type: 'workflow.run.resumed', workflowId: 'application-approval', workflowRunId: 'wf-run-1' });
    expect(result.current.run?.status).toBe('running');
    expect(result.current.run?.pauseReason).toBeUndefined();

    await f.push(0, { type: 'workflow.run.completed', workflowId: 'application-approval', workflowRunId: 'wf-run-1' });
    expect(result.current.run?.status).toBe('completed');
    f.runs.forEach((run) => run.end());
  });

  it('run.cancelled marks any still-running agent/workflow runs as cancelled', async () => {
    const f = fixture();
    const { result } = renderHook(() => ({ chat: useCopilotChat(), agentRuns: useAgentRuns(), workflowRuns: useWorkflowRuns() }), {
      wrapper: f.wrapper,
    });
    act(() => {
      result.current.chat.sendMessage('go');
    });
    await f.push(0, { type: 'run.started' });
    await f.push(0, { type: 'agent.run.started', agentId: 'support', agentRunId: 'agent-run-1' });
    await f.push(0, { type: 'workflow.run.started', workflowId: 'wf', workflowRunId: 'wf-run-1' });
    act(() => {
      result.current.chat.stop();
    });
    expect(result.current.agentRuns[0]?.status).toBe('cancelled');
    expect(result.current.workflowRuns[0]?.status).toBe('cancelled');
    f.runs.forEach((run) => run.end());
  });

  it('clears agent/workflow progress at the start of a new run', async () => {
    const f = fixture();
    const { result } = renderHook(() => ({ chat: useCopilotChat(), agentRuns: useAgentRuns() }), { wrapper: f.wrapper });
    act(() => {
      result.current.chat.sendMessage('first');
    });
    await f.push(0, { type: 'run.started' });
    await f.push(0, { type: 'agent.run.started', agentId: 'support', agentRunId: 'agent-run-1' });
    await f.push(0, { type: 'agent.run.completed', agentId: 'support', agentRunId: 'agent-run-1' });
    await f.push(0, { type: 'run.completed', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, finishReason: 'stop' });
    expect(result.current.agentRuns).toHaveLength(1);

    act(() => {
      result.current.chat.sendMessage('second');
    });
    expect(result.current.agentRuns).toHaveLength(0);
    f.runs.forEach((run) => run.end());
  });
});
