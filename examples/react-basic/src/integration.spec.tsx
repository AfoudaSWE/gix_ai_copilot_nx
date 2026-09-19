import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '@gixcopilot/server';
import { createRuntime } from '@gixcopilot/core';
import { createModelExecutor, createModelRuntime } from '@gixcopilot/provider';
import type { ModelProvider } from '@gixcopilot/provider';
import { createMockProvider } from '@gixcopilot/provider-mock';
import { CopilotProvider } from '@gixcopilot/react';
import { CopilotChat } from '@gixcopilot/ui';

const apps: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  cleanup();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function mount(provider: ModelProvider): Promise<void> {
  const modelRuntime = createModelRuntime({
    providers: [provider],
    defaults: { retry: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 } },
  });
  const runtime = createRuntime({
    executor: createModelExecutor({
      runtime: modelRuntime,
      model: { provider: provider.id, model: 'test' },
    }),
  });
  const app = createServer({ runtime, modelRuntime });
  apps.push(app);
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  render(
    <StrictMode>
      <CopilotProvider runtimeUrl={url}>
        <CopilotChat suggestions={['Start conversation']} />
      </CopilotProvider>
    </StrictMode>,
  );
}

describe('React UI → client → HTTP/SSE → server → core → model runtime → mock provider', () => {
  it('shows the first content before completion, then completes and regenerates the same turn', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mock = createMockProvider({ scenario: { chunks: ['First', ' second'] } });
    let requests = 0;
    await mount({
      id: mock.id,
      async *stream(request, options) {
        requests++;
        for await (const event of mock.stream(request, options)) {
          if (event.type === 'content.delta' && event.delta === ' second') await gate;
          yield event;
        }
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
    await screen.findByText('First');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(screen.queryByText('First second')).toBeNull();
    expect(requests).toBe(1);
    await act(async () => {
      release();
      await gate;
    });
    await screen.findByText('First second');
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(requests).toBe(2));
    await screen.findByRole('button', { name: 'Regenerate' });
    expect(screen.getAllByText('Start conversation')).toHaveLength(1);
  });

  it('Stop aborts the provider signal through the real network connection and keeps partial text', async () => {
    const mock = createMockProvider({ scenario: { chunks: ['Partial', ' should not appear'] } });
    let aborted = false;
    await mount({
      id: mock.id,
      async *stream(request, options) {
        for await (const event of mock.stream(request, options)) {
          yield event;
          if (event.type === 'content.delta') {
            await new Promise<void>((resolve) => {
              if (options?.signal?.aborted) {
                aborted = true;
                resolve();
              } else
                options?.signal?.addEventListener(
                  'abort',
                  () => {
                    aborted = true;
                    resolve();
                  },
                  { once: true },
                );
            });
          }
        }
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
    await screen.findByText('Partial');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(aborted).toBe(true));
    expect(screen.getByText('Partial')).toBeTruthy();
    expect(screen.queryByText(/should not appear/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeTruthy();
  });

  it('shows a safe mid-stream failure and explicitly retries without a duplicate user turn', async () => {
    await mount(
      createMockProvider({
        scenario: (attempt) =>
          attempt === 1
            ? {
                chunks: ['Incomplete'],
                failDuringStream: {
                  afterChunks: 1,
                  code: 'NETWORK_ERROR',
                  message: 'PRIVATE_PROVIDER_DETAIL',
                  retryable: true,
                },
              }
            : { chunks: ['Recovered answer'] },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Start conversation' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Connection lost');
    expect(alert.textContent).not.toContain('PRIVATE_PROVIDER_DETAIL');
    expect(screen.getByText('Incomplete')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Recovered answer');
    expect(screen.getAllByText('Start conversation')).toHaveLength(1);
    expect(screen.queryByText('Incomplete')).toBeNull();
    await screen.findByRole('button', { name: 'Regenerate' });
  });
});
