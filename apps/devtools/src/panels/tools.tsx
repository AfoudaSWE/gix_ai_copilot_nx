import type { ReactNode } from 'react';
import { firewallTimeline, generativeUiRequests, toolTimeline } from '@gixcopilot/devtools';
import type { ApprovalRecord, ToolTimelineEntry } from '@gixcopilot/devtools';
import { Badge, DataTable, PanelHeading, Payload, formatMs, formatTime, shortId } from '../components.js';
import type { PanelProps } from './overview.js';

function phases(entry: ToolTimelineEntry): string {
  return entry.phases.map((phase) => `${Math.round(phase.atMs)}ms ${phase.phase}`).join(' - ');
}

/** Section 37-38: tool lifecycle as it actually executed, with the recorded firewall decision. */
export function ToolsPanel({ session, raw, runId, headingId }: PanelProps): ReactNode {
  const timeline = toolTimeline(session, runId);
  return (
    <section aria-labelledby={headingId}>
      <PanelHeading id={headingId} title="Tools" description="Every tool call, including calls the Action Firewall blocked before execution." />
      <DataTable
        caption="Tool calls"
        rows={timeline}
        rowKey={(entry) => `${entry.runId ?? ''}:${entry.toolCallId}`}
        columns={[
          { header: 'Tool', cell: (entry) => <code>{entry.name}</code> },
          { header: 'Source', cell: (entry) => entry.source ?? '-' },
          { header: 'Status', cell: (entry) => <Badge value={entry.status} /> },
          { header: 'Security', cell: (entry) => (entry.securityDecision ? <Badge value={entry.securityDecision} /> : '-') },
          { header: 'Reason', cell: (entry) => entry.securityReasonCode ?? entry.error?.code ?? '-' },
          { header: 'Duration', cell: (entry) => formatMs(entry.durationMs), numeric: true },
          { header: 'Timeline', cell: (entry) => <span className="phases">{phases(entry)}</span> },
          { header: 'Arguments', cell: (entry) => <Payload value={entry.arguments} raw={raw} label="Arguments" /> },
          { header: 'Result', cell: (entry) => <Payload value={entry.result} raw={raw} label="Result" /> },
        ]}
      />
    </section>
  );
}

/** Section 39: structured component requests - never generated code. */
export function GenerativeUiPanel({ session, raw, headingId }: PanelProps): ReactNode {
  return (
    <section aria-labelledby={headingId}>
      <PanelHeading id={headingId} title="Generative UI" description="Components the model requested from the trusted registry, with props validation outcome." />
      <DataTable
        caption="UI requests"
        rows={generativeUiRequests(session)}
        rowKey={(entry, index) => `${entry.toolCallId}-${index}`}
        empty="No UI was requested."
        columns={[
          { header: 'Request', cell: (entry) => shortId(entry.toolCallId) },
          { header: 'Component', cell: (entry) => <code>{entry.component}</code> },
          { header: 'Status', cell: (entry) => <Badge value={entry.status} /> },
          { header: 'Props valid', cell: (entry) => (entry.propsValid === undefined ? '-' : entry.propsValid ? 'yes' : 'no') },
          { header: 'Duration', cell: (entry) => formatMs(entry.durationMs), numeric: true },
          { header: 'Failure', cell: (entry) => entry.error?.message ?? '-' },
          { header: 'Props', cell: (entry) => <Payload value={entry.props} raw={raw} label="Props" /> },
        ]}
      />
    </section>
  );
}

/**
 * Section 40-42, 221: the Action Firewall's recorded decision trail per action, and approvals.
 * Display only - DevTools never evaluates policy and cannot authorize anything.
 */
export function SecurityPanel({ session, runId, headingId }: PanelProps): ReactNode {
  const decisions = session.security.filter((decision) => !runId || decision.correlation.runId === runId);
  return (
    <section aria-labelledby={headingId}>
      <PanelHeading id={headingId} title="Security" description="Recorded firewall decisions. Viewing these grants no authority." />
      {decisions.length === 0 ? <p className="empty">No security decisions recorded.</p> : null}
      <ul className="firewall-list">
        {decisions.map((decision) => {
          const timeline = firewallTimeline(decision);
          return (
            <li key={decision.id} className="firewall">
              <h3>
                <code>{timeline.action}</code> <Badge value={timeline.final} />
              </h3>
              <p className="muted">
                User {timeline.subject ?? 'anonymous'} ({timeline.roles.join(', ') || 'no roles'}) - tenant {timeline.tenantId ?? '-'} - risk {timeline.risk ?? '-'}
                {timeline.approvalLevel ? ` - approval ${timeline.approvalLevel}` : ''}
                {timeline.reasonCode ? ` - ${timeline.reasonCode}` : ''}
              </p>
              <table className="stages">
                <caption className="visually-hidden">Firewall stages for {timeline.action}</caption>
                <tbody>
                  {timeline.stages.map((stage) => (
                    <tr key={stage.stage}>
                      <th scope="row">{stage.stage}</th>
                      <td>
                        <Badge value={stage.outcome.toUpperCase()} tone={stage.outcome === 'allow' ? 'ok' : stage.outcome === 'deny' ? 'error' : stage.outcome === 'required' ? 'warn' : 'neutral'} />
                      </td>
                      <td className="muted">{stage.reasonCode ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          );
        })}
      </ul>
      <h3>Approvals</h3>
      <DataTable<ApprovalRecord>
        caption="Approvals"
        rows={session.approvals}
        rowKey={(approval) => approval.approvalId}
        empty="No approvals recorded."
        columns={[
          { header: 'Approval', cell: (approval) => shortId(approval.approvalId) },
          { header: 'Action', cell: (approval) => approval.summary ?? approval.action },
          { header: 'Level', cell: (approval) => approval.level },
          { header: 'Status', cell: (approval) => <Badge value={approval.status} /> },
          { header: 'Requester', cell: (approval) => approval.requestedBy ?? '-' },
          { header: 'Approver', cell: (approval) => approval.decidedBy ?? '-' },
          { header: 'Created', cell: (approval) => formatTime(approval.createdAt) },
          { header: 'Resolved', cell: (approval) => formatTime(approval.resolvedAt) },
          { header: 'Wait', cell: (approval) => formatMs(approval.waitMs), numeric: true },
        ]}
      />
    </section>
  );
}
