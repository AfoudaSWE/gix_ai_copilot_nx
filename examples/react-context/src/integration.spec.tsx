import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

/**
 * Section 74's mandatory end-to-end flow: real React UI -> `useCopilotContext`/
 * `useCopilotState` -> the context registry/engine -> a real HTTP/SSE client -> a real
 * (in-process) server -> the model runtime -> a deterministic provider whose answer is
 * built entirely from the request it received. Nothing here is a UI response hardcoded
 * independently of what the model was actually sent.
 *
 * Mirrors `examples/react-basic`'s own integration test: rather than rendering the
 * exported `App` (which hard-codes the `/api/copilot` dev-server proxy path), this composes
 * the same `CopilotProvider` + page the app uses, pointed at a real ephemeral test server.
 */
async function mountApp(): Promise<void> {
  const app = createDemoServer();
  apps.push(app);
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  render(
    <StrictMode>
      <CopilotProvider runtimeUrl={url} model={{ provider: 'context-aware', model: 'demo' }}>
        <div className="layout">
          <ApplicationsPage />
          <CopilotChat title="Applications Copilot" suggestions={suggestions} />
        </div>
      </CopilotProvider>
    </StrictMode>,
  );
}

/** The assistant's answer alone, scoped to the conversation log (Section 74). Avoids
 * matching the same text repeated in the row button or the screen-reader status region. */
function conversation(): HTMLElement {
  return screen.getByRole('log');
}

describe('application-aware chat (Section 52-55, 74)', () => {
  it('answers from the selected application, then updates the answer after the selection changes', async () => {
    await mountApp();

    fireEvent.click(screen.getByRole('button', { name: 'APP-1002' }));
    expect(await screen.findByText('Selected: APP-1002')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'What application am I looking at?' }));
    const firstAnswer = await within(conversation()).findByText(/APP-1002/);
    expect(firstAnswer.textContent).toContain('APP-1002');
    expect(firstAnswer.textContent).toContain('pending');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'APP-1003' }));
    });
    expect(await screen.findByText('Selected: APP-1003')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate' }));
    const secondAnswer = await within(conversation()).findByText(/APP-1003/);
    expect(secondAnswer.textContent).toContain('APP-1003');
    expect(secondAnswer.textContent).toContain('approved');
  });

  it('reflects a status filter change exposed as state-derived context', async () => {
    await mountApp();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'approved' } });
    fireEvent.click(screen.getByRole('button', { name: 'APP-1003' }));
    fireEvent.click(screen.getByRole('button', { name: 'What application am I looking at?' }));

    const answer = await within(conversation()).findByText(/APP-1003/);
    expect(answer.textContent).toContain('APP-1003');
    expect(answer.textContent).toContain('approved');
  });

  it('answers that nothing is selected when no application has been chosen', async () => {
    await mountApp();
    fireEvent.click(screen.getByRole('button', { name: 'What application am I looking at?' }));
    const answer = await within(conversation()).findByText(/No application is selected/);
    expect(answer.textContent).toContain('No application is selected');
  });
});
