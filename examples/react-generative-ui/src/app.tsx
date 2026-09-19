import { useState } from 'react';
import type { ReactElement } from 'react';
import { z } from 'zod';
import {
  CopilotProvider,
  useCopilotState,
  useFrontendTool,
  useGenerativeComponent,
  useInvokeTool,
  useToolRenderer,
} from '@gixcopilot/react';
import { CopilotChat } from '@gixcopilot/ui';
import { APPLICATIONS } from './applications.js';
import type { Application } from './applications.js';

export const suggestions = [
  'Show APP-1024',
  'Show all applications as cards',
  'What is the status of APP-2048?',
  'Filter to approved',
];

interface ApplicationCardProps {
  readonly applicationId: string;
  readonly applicantName: string;
  readonly status: string;
}

/**
 * A trusted, developer-authored component (Section 8-9) - the model can only ever select it
 * by name and supply schema-validated props; it never receives model-generated markup or
 * code. `[Open]` calls a registered tool *directly*, skipping the model entirely (Section
 * 32-35, 105-106) - see `useInvokeTool`.
 */
function ApplicationCard({ applicationId, applicantName, status }: ApplicationCardProps): ReactElement {
  const invoke = useInvokeTool();
  const [opened, setOpened] = useState(false);
  return (
    <div className="application-card" data-testid={`card-${applicationId}`}>
      <strong>{applicationId}</strong>
      <span>{applicantName}</span>
      <span className={`status-badge status-${status}`}>{status}</span>
      <button
        type="button"
        onClick={() => {
          void invoke('navigation.openApplication', { applicationId }).then(() => setOpened(true));
        }}
      >
        Open
      </button>
      {opened ? <span className="opened-note">Opened</span> : null}
    </div>
  );
}

function useRegisterApplicationCard(): void {
  useGenerativeComponent({
    name: 'ApplicationCard',
    description:
      'Displays a compact summary card for one application (id, applicant, status) with an Open action.',
    props: z.object({
      applicationId: z.string(),
      applicantName: z.string(),
      status: z.string(),
    }),
    component: ApplicationCard,
  });
}

/** Section 26-31's "Tool Result -> UI": a custom renderer for an ordinary Phase 5 tool
 * (`applications.getStatus`), independent of the generative-component mechanism above. */
function useRegisterStatusRenderer(): void {
  useToolRenderer({
    tool: 'applications.getStatus',
    render: ({ status, result }) => {
      if (status === 'requested' || status === 'running') {
        return <span className="status-tool-loading">Checking status…</span>;
      }
      if (status === 'failed') {
        return <span className="status-tool-error">Status check failed.</span>;
      }
      const data = result as { applicationId?: string; status?: string } | undefined;
      return (
        <span className={`status-badge status-${data?.status ?? 'unknown'}`} data-testid="status-badge">
          {data?.applicationId}: {data?.status}
        </span>
      );
    },
  });
}

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

interface Filters {
  readonly status: 'all' | Application['status'];
}

export function ApplicationsPage(): ReactElement {
  const [openedId, setOpenedId] = useState<string | null>(null);
  useRegisterApplicationCard();
  useRegisterStatusRenderer();
  useOpenApplicationTool(setOpenedId);

  // Shared, AI-writable state (Section 38, 68, 81): readable via exposeToModel (Phase 4's
  // mechanism, unchanged), writable via modelWritable (Phase 6) - a validated AI-proposed
  // patch reaches this exact same store through the reserved state.patch.applicationFilters
  // tool `useCopilotState` auto-registers.
  const [filters, setFilters] = useCopilotState<Filters>({
    id: 'application-filters',
    name: 'applicationFilters',
    initialValue: { status: 'all' },
    exposeToModel: {
      description: 'The status filter currently applied to the applications list',
      priority: 'normal',
    },
    modelWritable: true,
  });

  const visible =
    filters.status === 'all' ? APPLICATIONS : APPLICATIONS.filter((application) => application.status === filters.status);

  return (
    <section className="applications">
      <div className="applications-toolbar">
        <h1>Applications</h1>
        <label>
          Status
          <select
            value={filters.status}
            onChange={(event) => setFilters({ status: event.target.value as Filters['status'] })}
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
          </tr>
        </thead>
        <tbody>
          {visible.map((application) => (
            <tr key={application.id}>
              <td>{application.id}</td>
              <td>{application.applicantName}</td>
              <td>{application.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {openedId ? (
        <p className="opened-banner" role="status">
          Opened {openedId} (via the ApplicationCard's Open button - a direct tool invocation,
          no model round trip)
        </p>
      ) : null}
    </section>
  );
}

export function App(): ReactElement {
  return (
    <CopilotProvider runtimeUrl="/api/copilot" model={{ provider: 'generative-ui-aware', model: 'demo' }}>
      <div className="layout">
        <ApplicationsPage />
        <aside className="chat-pane">
          <CopilotChat title="Generative UI Copilot" suggestions={suggestions} />
        </aside>
      </div>
    </CopilotProvider>
  );
}
