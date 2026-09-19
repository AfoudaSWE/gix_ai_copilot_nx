import { useState } from 'react';
import type { ReactElement } from 'react';
import { z } from 'zod';
import { CopilotProvider, useCopilotContext, useFrontendTool } from '@gixcopilot/react';
import { CopilotChat } from '@gixcopilot/ui';
import { APPLICATIONS, findApplication } from './applications.js';

export const suggestions = [
  'What is the status of APP-1024?',
  'Open APP-2048',
  'Run an audit on APP-1024',
  'What is the status of APP-ERROR?',
];

/**
 * The frontend tool (Section 44, 99-100): only the browser can navigate/select on the
 * user's behalf, so the model must ask the client to do it rather than the server faking
 * the effect (Section 45's explicit warning). Registers/unregisters with the page, per
 * Section 49 - unmounting `ApplicationsPage` would make this tool unavailable.
 */
function useOpenApplicationTool(onOpen: (applicationId: string) => void): void {
  useFrontendTool({
    name: 'navigation.openApplication',
    description: 'Open an application details view by its id.',
    input: z.object({ applicationId: z.string() }),
    output: z.object({ opened: z.boolean(), applicationId: z.string() }),
    execute({ applicationId }) {
      onOpen(applicationId);
      return Promise.resolve({ opened: true, applicationId });
    },
  });
}

export function ApplicationsPage(): ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const selected = selectedId ? findApplication(selectedId) : undefined;

  useOpenApplicationTool((applicationId) => {
    setSelectedId(applicationId);
    setOpenedId(applicationId);
  });

  // Context + Tool integration (Section 57): the currently selected application is
  // resolved application context, so "what is its status?" can be answered without the
  // user repeating the id - the demo backend's provider reads this same context text to
  // decide which tool call to make (see backend.ts's decideToolCall).
  useCopilotContext({
    id: 'selected-application',
    name: 'selectedApplication',
    description: 'The application currently selected by the user',
    scope: 'component',
    priority: 'high',
    enabled: selected !== undefined,
    value: selected ? { id: selected.id, status: selected.status } : null,
  });

  return (
    <section className="applications">
      <div className="applications-toolbar">
        <h1>Applications</h1>
      </div>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Applicant</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {APPLICATIONS.map((application) => (
            <tr
              key={application.id}
              aria-selected={application.id === selectedId}
              className={application.id === selectedId ? 'row-selected' : undefined}
            >
              <td>
                <button
                  type="button"
                  aria-pressed={application.id === selectedId}
                  onClick={() => setSelectedId(application.id)}
                >
                  {application.id}
                </button>
              </td>
              <td>{application.applicantName}</td>
              <td>{application.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="applications-hint">
        {selected ? `Selected: ${selected.id}` : 'Click an application ID to select it.'}
      </p>
      {openedId ? (
        <p className="opened-banner" role="status">
          Opened {openedId} (via the navigation.openApplication frontend tool)
        </p>
      ) : null}
    </section>
  );
}

export function App(): ReactElement {
  return (
    <CopilotProvider runtimeUrl="/api/copilot" model={{ provider: 'tools-aware', model: 'demo' }}>
      <div className="layout">
        <ApplicationsPage />
        <aside className="chat-pane">
          <CopilotChat title="Tools Copilot" suggestions={suggestions} />
        </aside>
      </div>
    </CopilotProvider>
  );
}
