import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
      <CopilotProvider runtimeUrl={url} model={{ provider: 'generative-ui-aware', model: 'demo' }}>
        <div className="layout">
          <ApplicationsPage />
          <CopilotChat title="Generative UI Copilot" suggestions={suggestions} />
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

/** Section 79's mandatory end-to-end generative UI test: React -> user asks -> mock model
 * -> reserved ui.render.applicationCard tool call -> Tool Runtime -> real, registered
 * `ApplicationCard` component, rendered with validated props. */
describe('generative UI request without a developer-defined tool (Section 65-66, 79)', () => {
  it('renders the ApplicationCard component the model selected, with correct props', async () => {
    await mountApp();
    ask('Show APP-1024');

    const cardElement = await screen.findByTestId('card-APP-1024');
    expect(cardElement.textContent).toContain('APP-1024');
    expect(cardElement.textContent).toContain('Priya Shah');
    expect(cardElement.textContent).toContain('pending');
  });

  it('renders multiple independently-tracked components for one response (Section 25)', async () => {
    await mountApp();
    ask('Show all applications as cards');

    expect(await screen.findByTestId('card-APP-1024')).toBeTruthy();
    expect(await screen.findByTestId('card-APP-2048')).toBeTruthy();
    expect(await screen.findByTestId('card-APP-3072')).toBeTruthy();
  });

  it('falls back safely and reports nothing rendered for an unknown application id', async () => {
    await mountApp();
    ask('Show APP-9999');

    const answer = await within(conversation()).findByText(/couldn't find APP-9999/);
    expect(answer.textContent).toContain("couldn't find");
    expect(screen.queryByTestId('card-APP-9999')).toBeNull();
  });
});

/** Section 80's mandatory end-to-end interactive-action test: a rendered component's own
 * button invokes a registered tool directly, never routing back through the model. */
describe('interactive generated component action (Section 32-35, 80)', () => {
  it('opens an application via the card\'s own button without any additional model turn', async () => {
    await mountApp();
    ask('Show APP-2048');
    const card = await screen.findByTestId('card-APP-2048');

    fireEvent.click(within(card).getByRole('button', { name: 'Open' }));

    await waitFor(() =>
      expect(
        screen.getByText(/Opened APP-2048 \(via the ApplicationCard's Open button/),
      ).toBeTruthy(),
    );
    // No new run was created by clicking Open - only the original "Show APP-2048" run exists,
    // confirming the action never went back through the model.
    expect(screen.getAllByRole('log')).toHaveLength(1);
  });
});

/** Section 81's mandatory end-to-end shared-state test, including the conflict path. */
describe('AI-writable shared state (Section 38, 45-46, 68, 81)', () => {
  it('applies a valid AI-proposed filter patch and the visible table updates', async () => {
    await mountApp();
    expect(screen.getByRole('row', { name: /APP-3072/ })).toBeTruthy();

    ask('Filter to approved');
    await within(conversation()).findByText(/Filter updated/);

    await waitFor(() => expect(screen.queryByRole('row', { name: /APP-3072/ })).toBeNull());
    expect(screen.getByRole('row', { name: /APP-2048/ })).toBeTruthy();
  });

  it('detects a stale patch as a conflict when the UI changed the filter first (Section 46)', async () => {
    await mountApp();

    // The AI's first (successful) patch establishes revision 1 in its own conversation
    // history - the "known" baseRevision a real model would carry forward.
    ask('Filter to approved');
    await within(conversation()).findByText(/Filter updated/);

    // The UI then moves the value again on its own, independent of the AI (revision 2).
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'pending' } });
    await waitFor(() => expect(screen.getByRole('row', { name: /APP-1024/ })).toBeTruthy());

    // The AI proposes a further patch still believing revision 1 is current - stale.
    ask('Filter to rejected');
    const answer = await within(conversation()).findByText(/changed elsewhere/);
    expect(answer.textContent).toContain('changed elsewhere');

    // The conflicting patch must never have been applied - the UI's own choice (pending) wins.
    expect(screen.getByRole('row', { name: /APP-1024/ })).toBeTruthy();
    expect(screen.queryByRole('row', { name: /APP-3072/ })).toBeNull();
  });
});

describe('ordinary tool result with a custom renderer (Section 26-31)', () => {
  it('shows the custom status badge instead of the generic activity row', async () => {
    await mountApp();
    ask('What is the status of APP-2048?');

    const badge = await screen.findByTestId('status-badge');
    expect(badge.textContent).toBe('APP-2048: approved');
    expect(document.querySelector('.gix-tool-activity')?.textContent).not.toMatch(/Running/);
  });
});
