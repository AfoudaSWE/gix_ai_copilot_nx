import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CopilotProvider } from '@gixcopilot/react';
import { CopilotChat } from '@gixcopilot/ui';
import { ApplicationsPage, suggestions } from './app.js';
import { createDemoServer } from './backend.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  cleanup();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function mountApp(): Promise<void> {
  const app = createDemoServer();
  apps.push(app);
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  render(
    <StrictMode>
      <CopilotProvider runtimeUrl={url} model={{ provider: 'tools-aware', model: 'demo' }}>
        <div className="layout">
          <ApplicationsPage />
          <CopilotChat title="Tools Copilot" suggestions={suggestions} />
        </div>
      </CopilotProvider>
    </StrictMode>,
  );
}

function conversation(): HTMLElement {
  return screen.getByRole('log');
}

function ask(question: string): void {
  const input = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.change(input, { target: { value: question } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('backend tool (Section 81/101)', () => {
  it('answers a status question end to end via the real Model -> Tool -> Model loop', async () => {
    await mountApp();
    ask('What is the status of APP-1024?');

    const answer = await within(conversation()).findByText(/APP-1024 is currently PENDING/);
    expect(answer.textContent).toContain('PENDING');
  });
});

describe('frontend tool (Section 82/102)', () => {
  it('opens an application in the browser via a client-executed tool call', async () => {
    await mountApp();
    ask('Open APP-2048');

    await waitFor(() => expect(screen.getByText('Selected: APP-2048')).toBeTruthy());
    expect(
      await screen.findByText(/Opened APP-2048 \(via the navigation.openApplication frontend tool\)/),
    ).toBeTruthy();
    expect(await within(conversation()).findByText(/Opened APP-2048/)).toBeTruthy();
  });
});

describe('context + tool (Section 57)', () => {
  it('resolves "its status" using the currently selected application as context', async () => {
    await mountApp();
    fireEvent.click(screen.getByRole('button', { name: 'APP-3072' }));
    await waitFor(() => expect(screen.getByText('Selected: APP-3072')).toBeTruthy());

    ask('What is its status?');
    const answer = await within(conversation()).findByText(/APP-3072 is currently REJECTED/);
    expect(answer.textContent).toContain('REJECTED');
  });
});

describe('tool error (Section 84)', () => {
  it('surfaces a failed tool call back to the model, which explains the failure instead of crashing', async () => {
    await mountApp();
    ask('What is the status of APP-ERROR?');

    const answer = await within(conversation()).findByText(/Sorry, that request failed/);
    expect(answer.textContent).toContain('temporarily unavailable');
  });
});

describe('tool cancellation (Section 85)', () => {
  it('stopping the run during a slow tool call ends it cleanly with no completion afterward', async () => {
    await mountApp();
    ask('Run an audit on APP-1024');

    await waitFor(() => expect(screen.getByText(/Running/)).toBeTruthy());
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    });

    await waitFor(() => expect(screen.getAllByText('Generation stopped').length).toBeGreaterThan(0));
    // Give the (deliberately 2s-slow) tool time to would-be finish, then confirm no late
    // completion text ever arrives after the run was already stopped.
    await new Promise((resolve) => setTimeout(resolve, 2200));
    expect(screen.queryByText(/audit for APP-1024 is complete/)).toBeNull();
  }, 10_000);
});
