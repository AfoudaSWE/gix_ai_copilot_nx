import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CopilotClient, RunOptions } from '@gixcopilot/client';
import { CopilotProvider, useCopilotContext, useCopilotContextDebug } from './index.js';

afterEach(() => {
  cleanup();
});

function stubClient(): { client: CopilotClient; runs: RunOptions[] } {
  const runs: RunOptions[] = [];
  const client: CopilotClient = {
    run(options) {
      runs.push(options);
      return {
        cancel: vi.fn(),
        events: { async *[Symbol.asyncIterator]() {} },
      };
    },
    submitToolResult: vi.fn(() => Promise.resolve(undefined)),
    decideApproval: vi.fn(() => Promise.resolve(undefined)),
  };
  return { client, runs };
}

function wrapperFor(client: CopilotClient) {
  return ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <CopilotProvider client={client}>{children}</CopilotProvider>
    </StrictMode>
  );
}

describe('useCopilotContext', () => {
  it('registers on mount and is visible via the debug engine', async () => {
    const { client } = stubClient();
    const { result } = renderHook(
      () => {
        useCopilotContext({
          name: 'selectedApplication',
          scope: 'component',
          priority: 'high',
          value: { id: 'APP-1024', status: 'pending' },
        });
        return useCopilotContextDebug();
      },
      { wrapper: wrapperFor(client) },
    );

    const resolved = await act(() => result.current.resolve());
    expect(resolved.items).toHaveLength(1);
    expect(resolved.items[0]?.name).toBe('selectedApplication');
    expect(resolved.content).toContain('APP-1024');
  });

  it('StrictMode leaves exactly one live registration, not a leaked duplicate', async () => {
    const { client } = stubClient();
    const { result } = renderHook(
      () => {
        useCopilotContext({ name: 'x', scope: 'page', value: 1 });
        return useCopilotContextDebug();
      },
      { wrapper: wrapperFor(client) },
    );
    const resolved = await act(() => result.current.resolve());
    expect(resolved.items).toHaveLength(1);
  });

  it('updates the registered value without losing the registration on rerender', async () => {
    const { client } = stubClient();
    const { result, rerender } = renderHook(
      ({ value }: { value: number }) => {
        useCopilotContext({ id: 'counter', name: 'counter', scope: 'page', value });
        return useCopilotContextDebug();
      },
      { wrapper: wrapperFor(client), initialProps: { value: 1 } },
    );
    rerender({ value: 2 });
    const resolved = await act(() => result.current.resolve());
    expect(resolved.items).toHaveLength(1);
    expect(resolved.content).toContain('2');
    expect(resolved.content).not.toContain('"value": 1');
  });

  it('removes context on unmount', async () => {
    const { client } = stubClient();
    function Consumer() {
      useCopilotContext({ id: 'temp', name: 'temp', scope: 'component', value: 'x' });
      return null;
    }
    let debugResult: ReturnType<typeof useCopilotContextDebug> | undefined;
    function Debug() {
      debugResult = useCopilotContextDebug();
      return null;
    }
    const view = render(
      <CopilotProvider client={client}>
        <Consumer />
        <Debug />
      </CopilotProvider>,
    );
    const before = await act(() => debugResult?.resolve());
    expect(before?.items).toHaveLength(1);

    view.rerender(
      <CopilotProvider client={client}>
        <Debug />
      </CopilotProvider>,
    );
    const after = await act(() => debugResult?.resolve());
    expect(after?.items).toHaveLength(0);
  });

  it('disabled context is registered but never reaches resolved content (Section 31)', async () => {
    const { client } = stubClient();
    const { result } = renderHook(
      () => {
        useCopilotContext({ name: 'off', scope: 'page', value: 'secret', enabled: false });
        return useCopilotContextDebug();
      },
      { wrapper: wrapperFor(client) },
    );
    const resolved = await act(() => result.current.resolve());
    expect(resolved.items).toHaveLength(0);
    expect(resolved.excluded).toEqual([{ id: expect.any(String) as string, name: 'off', scope: 'page', reason: 'disabled' }]);
  });

  it('isolates context between two independent CopilotProviders (Section 65)', async () => {
    const a = stubClient();
    const b = stubClient();
    function ConsumerA() {
      useCopilotContext({ name: 'onlyA', scope: 'page', value: 1 });
      return null;
    }
    let debugA: ReturnType<typeof useCopilotContextDebug> | undefined;
    let debugB: ReturnType<typeof useCopilotContextDebug> | undefined;
    function DebugA() {
      debugA = useCopilotContextDebug();
      return null;
    }
    function DebugB() {
      debugB = useCopilotContextDebug();
      return null;
    }
    render(
      <div>
        <CopilotProvider client={a.client}>
          <ConsumerA />
          <DebugA />
        </CopilotProvider>
        <CopilotProvider client={b.client}>
          <DebugB />
        </CopilotProvider>
      </div>,
    );
    const resolvedA = await act(() => debugA?.resolve());
    const resolvedB = await act(() => debugB?.resolve());
    expect(resolvedA?.items).toHaveLength(1);
    expect(resolvedB?.items).toHaveLength(0);
  });
});
