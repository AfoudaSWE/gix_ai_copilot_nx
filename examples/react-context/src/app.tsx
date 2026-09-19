import { useState } from 'react';
import type { ReactElement } from 'react';
import { CopilotProvider, useCopilotContext, useCopilotState } from '@gixcopilot/react';
import { CopilotChat } from '@gixcopilot/ui';
import { APPLICATIONS, filterApplications } from './applications.js';
import type { Application, StatusFilter } from './applications.js';

export const suggestions = [
  'What application am I looking at?',
  'What page am I on?',
  'What are the current filters?',
];

/**
 * Registers page-level context: the current route/page type and the currently visible
 * (filtered) dataset summary (Section 12, 52) - not the entire DOM, and not every row's
 * full detail, just a small explicit summary.
 */
function usePageContext(filters: StatusFilter, visible: readonly Application[]): void {
  useCopilotContext({
    id: 'current-page',
    name: 'currentPage',
    description: 'The page currently open in the application',
    scope: 'page',
    priority: 'normal',
    value: { route: '/applications', title: 'Applications' },
  });
  useCopilotContext({
    id: 'visible-applications',
    name: 'visibleApplications',
    description: 'Summary of the applications currently visible after filtering',
    scope: 'page',
    priority: 'normal',
    value: {
      count: visible.length,
      status: filters,
      ids: visible.map((app) => app.id),
    },
  });
}

/** Section 10: user context, kept small and non-identifying for this demo. */
function useDemoUserContext(): void {
  useCopilotContext({
    id: 'current-user',
    name: 'currentUser',
    description: 'The user currently signed in',
    scope: 'user',
    priority: 'low',
    sensitivity: 'internal',
    value: { role: 'reviewer', locale: 'en-US' },
  });
}

function ApplicationRow({
  application,
  selected,
  onSelect,
}: {
  application: Application;
  selected: boolean;
  onSelect: (id: string) => void;
}): ReactElement {
  return (
    <tr aria-selected={selected} className={selected ? 'row-selected' : undefined}>
      <td>
        <button type="button" onClick={() => onSelect(application.id)} aria-pressed={selected}>
          {application.id}
        </button>
      </td>
      <td>{application.applicantName}</td>
      <td>{application.status}</td>
      <td>{application.country}</td>
    </tr>
  );
}

export function ApplicationsPage(): ReactElement {
  const [filters, setFilters] = useCopilotState<{ status: StatusFilter }>({
    id: 'application-filters',
    name: 'applicationFilters',
    initialValue: { status: 'all' },
    exposeToModel: { description: 'The status filter currently applied to the applications list', priority: 'normal' },
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible = filterApplications(APPLICATIONS, filters.status);
  const selected = visible.find((app) => app.id === selectedId) ?? null;

  usePageContext(filters.status, visible);
  useDemoUserContext();
  useCopilotContext({
    id: 'selected-application',
    name: 'selectedApplication',
    description: 'The application currently selected by the user',
    scope: 'component',
    priority: 'high',
    enabled: selected !== null,
    value: selected
      ? { id: selected.id, status: selected.status, applicantName: selected.applicantName }
      : null,
  });

  return (
    <section className="applications">
      <div className="applications-toolbar">
        <h1>Applications</h1>
        <label>
          Status
          <select
            value={filters.status}
            onChange={(event) => setFilters({ status: event.target.value as StatusFilter })}
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
      </div>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Applicant</th>
            <th>Status</th>
            <th>Country</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((application) => (
            <ApplicationRow
              key={application.id}
              application={application}
              selected={application.id === selectedId}
              onSelect={setSelectedId}
            />
          ))}
        </tbody>
      </table>
      <p className="applications-hint">
        {selected ? `Selected: ${selected.id}` : 'Click an application ID to select it.'}
      </p>
    </section>
  );
}

export function App(): ReactElement {
  return (
    <CopilotProvider runtimeUrl="/api/copilot" model={{ provider: 'context-aware', model: 'demo' }}>
      <div className="layout">
        <ApplicationsPage />
        <aside className="chat-pane">
          <CopilotChat title="Applications Copilot" suggestions={suggestions} />
        </aside>
      </div>
    </CopilotProvider>
  );
}
