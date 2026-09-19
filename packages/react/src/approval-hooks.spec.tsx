import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@gixcopilot/protocol';
import type { CopilotEvent, CopilotEventBase } from '@gixcopilot/protocol';
import type { CopilotClient, RunOptions } from '@gixcopilot/client';
import { CopilotProvider, useApprovals, useCopilot, useCopilotChat, usePendingApprovals } from './index.js';

afterEach(() => {
  cleanup();
});

/** Phase 7 (Section 76, 81-82): the headless approval hooks read `approval.*` events the
 * exact same way `useToolCalls` already reads `tool.*` events - this is the React-side half
 * of the pipeline the server package's `security-integration.spec.ts` already covers
 * end-to-end over real HTTP; this file verifies the wiring into `chat-store.ts`/the hooks. */
function fixture() {
  const runs: { options: RunOptions; push: (event: CopilotEvent) => void; cancel: ReturnType<typeof vi.fn> }[] = [];
  const decideApproval = vi.fn(() => Promise.resolve(undefined));
  const client: CopilotClient = {
    run(options) {
      const queue: CopilotEvent[] = [];
      let wake = () => {};
      const cancel = vi.fn();
      runs.push({
        options,
        cancel,
        push: (event) => {
          queue.push(event);
          wake();
        },
      });
      return {
        cancel,
        events: {
          async *[Symbol.asyncIterator]() {
            while (true) {
              const event = queue.shift();
              if (event) yield event;
              else await new Promise<void>((resolve) => (wake = resolve));
            }
          },
        },
      };
    },
    submitToolResult: vi.fn(() => Promise.resolve(undefined)),
    decideApproval,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <CopilotProvider client={client}>{children}</CopilotProvider>
    </StrictMode>
  );

  function base(sequence: number, runIndex: number): CopilotEventBase {
    return {
      id: `event-${String(sequence)}`,
      runId: `run-${String(runIndex)}`,
      threadId: runs[runIndex]?.options.threadId ?? '',
      timestamp: '2026-09-19T00:00:00.000Z',
      protocolVersion: PROTOCOL_VERSION,
      sequence,
    };
  }

  return { client, runs, wrapper, base, decideApproval };
}

describe('headless approval hooks (Phase 7, Section 76, 81-82)', () => {
  it('useApprovals/usePendingApprovals track approval.requested -> approval.approved', async () => {
    const f = fixture();
    const { result } = renderHook(
      () => ({ chat: useCopilotChat(), approvals: useApprovals(), pending: usePendingApprovals() }),
      { wrapper: f.wrapper },
    );

    act(() => {
      result.current.chat.sendMessage('Reassign APP-1024 to Officer B');
    });
    act(() => {
      runs0Push(f, { ...f.base(1, 0), type: 'run.started' });
    });
    await act(async () => {
      runs0Push(f, {
        ...f.base(2, 0),
        type: 'approval.requested',
        approvalId: 'approval-1',
        toolCallId: 'call-1',
        action: 'applications.reassign',
        approvalLevel: 'user-confirmation',
        summary: 'Reassign APP-1024 to Officer B',
      });
      await Promise.resolve();
    });

    expect(result.current.approvals).toHaveLength(1);
    expect(result.current.pending).toHaveLength(1);
    expect(result.current.approvals[0]?.status).toBe('pending');

    await act(async () => {
      runs0Push(f, {
        ...f.base(3, 0),
        type: 'approval.approved',
        approvalId: 'approval-1',
        toolCallId: 'call-1',
        decidedBy: 'u-manager',
      });
      await Promise.resolve();
    });

    expect(result.current.pending).toHaveLength(0);
    expect(result.current.approvals[0]?.status).toBe('approved');
    expect(result.current.approvals[0]?.decidedBy).toBe('u-manager');
  });

  it('approveAction/rejectAction delegate to the client (Section 83)', async () => {
    const f = fixture();
    const { result } = renderHook(() => useCopilot(), { wrapper: f.wrapper });

    await result.current.approveAction('approval-1', 'looks good');
    expect(f.decideApproval).toHaveBeenCalledWith('approval-1', 'approve', 'looks good');

    await result.current.rejectAction('approval-2');
    expect(f.decideApproval).toHaveBeenCalledWith('approval-2', 'reject', undefined);
  });
});

function runs0Push(f: ReturnType<typeof fixture>, event: CopilotEvent): void {
  f.runs[0]?.push(event);
}
