import { StrictMode, useState } from 'react';
import type { ReactNode } from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CopilotClient } from '@gixcopilot/client';
import { CopilotProvider, useCopilotContextDebug, useCopilotState } from './index.js';

afterEach(() => {
  cleanup();
});

function stubClient(): CopilotClient {
  return {
    run() {
      return { cancel: vi.fn(), events: { async *[Symbol.asyncIterator]() {} } };
    },
  };
}

function wrapperFor(client: CopilotClient) {
  return ({ children }: { children: ReactNode }) => (
    <StrictMode>
      <CopilotProvider client={client}>{children}</CopilotProvider>
    </StrictMode>
  );
}

interface Filters {
  readonly status: string;
}

describe('useCopilotState', () => {
  it('returns the initial value and updates it (uncontrolled mode)', () => {
    const client = stubClient();
    const { result } = renderHook(
      () => useCopilotState<Filters>({ name: 'filters', initialValue: { status: 'all' } }),
      { wrapper: wrapperFor(client) },
    );
    expect(result.current[0]).toEqual({ status: 'all' });
    act(() => {
      result.current[1]({ status: 'pending' });
    });
    expect(result.current[0]).toEqual({ status: 'pending' });
  });

  it('supports a functional update', () => {
    const client = stubClient();
    const { result } = renderHook(() => useCopilotState({ name: 'count', initialValue: 1 }), {
      wrapper: wrapperFor(client),
    });
    act(() => {
      result.current[1]((previous) => previous + 1);
    });
    expect(result.current[0]).toBe(2);
  });

  it('two components sharing an id see the same value (Section 42)', () => {
    const client = stubClient();
    function ComponentA() {
      const [value, setValue] = useCopilotState({ id: 'shared', name: 'shared', initialValue: 0 });
      return (
        <button type="button" onClick={() => setValue((previous) => previous + 1)}>
          A:{value}
        </button>
      );
    }
    function ComponentB() {
      const [value] = useCopilotState({ id: 'shared', name: 'shared', initialValue: 0 });
      return <span>B:{value}</span>;
    }
    render(
      <CopilotProvider client={client}>
        <ComponentA />
        <ComponentB />
      </CopilotProvider>,
    );
    expect(screen.getByText('B:0')).toBeTruthy();
    act(() => {
      screen.getByRole('button').click();
    });
    expect(screen.getByText('B:1')).toBeTruthy();
  });

  it('does not expose state to the model unless exposeToModel is set (Section 44)', async () => {
    const client = stubClient();
    const { result } = renderHook(
      () => {
        const state = useCopilotState<Filters>({ name: 'filters', initialValue: { status: 'all' } });
        const debug = useCopilotContextDebug();
        return { state, debug };
      },
      { wrapper: wrapperFor(client) },
    );
    const resolved = await act(() => result.current.debug.resolve());
    expect(resolved.items).toHaveLength(0);
  });

  it('exposes state to the model when exposeToModel is set, and reflects updates', async () => {
    const client = stubClient();
    const { result } = renderHook(
      () => {
        const state = useCopilotState<Filters>({
          name: 'filters',
          initialValue: { status: 'all' },
          exposeToModel: { description: 'Current filters', priority: 'high' },
        });
        const debug = useCopilotContextDebug();
        return { state, debug };
      },
      { wrapper: wrapperFor(client) },
    );
    const before = await act(() => result.current.debug.resolve());
    expect(before.items).toHaveLength(1);
    expect(before.content).toContain('"all"');

    act(() => {
      result.current.state[1]({ status: 'pending' });
    });
    const after = await act(() => result.current.debug.resolve());
    expect(after.content).toContain('"pending"');
  });

  it('controlled mode forwards writes to onChange instead of owning the value (Section 46)', () => {
    const client = stubClient();
    function Controlled() {
      const [value, setValue] = useState<Filters>({ status: 'all' });
      const [copilotValue, setCopilotValue] = useCopilotState<Filters>({
        name: 'filters',
        initialValue: { status: 'all' },
        value,
        onChange: setValue,
      });
      return (
        <button type="button" onClick={() => setCopilotValue({ status: 'approved' })}>
          {copilotValue.status}
        </button>
      );
    }
    render(
      <CopilotProvider client={client}>
        <Controlled />
      </CopilotProvider>,
    );
    expect(screen.getByRole('button').textContent).toBe('all');
    act(() => {
      screen.getByRole('button').click();
    });
    expect(screen.getByRole('button').textContent).toBe('approved');
  });

  it('rejects an update that fails validation, leaving the value unchanged (Section 49)', () => {
    const client = stubClient();
    const { result } = renderHook(
      () =>
        useCopilotState<Filters>({
          name: 'filters',
          initialValue: { status: 'ok' },
          validate: (value) => (value.status.length > 0 ? true : { valid: false, error: 'required' }),
        }),
      { wrapper: wrapperFor(client) },
    );
    act(() => {
      expect(() => result.current[1]({ status: '' })).toThrow('required');
    });
    expect(result.current[0]).toEqual({ status: 'ok' });
  });
});
