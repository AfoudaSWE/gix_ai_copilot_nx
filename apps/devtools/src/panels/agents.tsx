import type { ReactNode } from 'react';
import { agentTree, delegations, handoffs, routingDecisions, workflows } from '@gixcopilot/devtools';
import type { AgentNode, WorkflowRecord } from '@gixcopilot/devtools';
import { Badge, DataTable, PanelHeading, formatMs, formatNumber, shortId } from '../components.js';
import type { PanelProps } from './overview.js';

function AgentItem({ node }: { readonly node: AgentNode }): ReactNode {
  const why = node.selection?.via === 'delegation' ? `delegated by ${node.selection.fromAgentId ?? '?'}` : node.selection?.via === 'handoff' ? `handoff from ${node.selection.fromAgentId ?? '?'} (${node.selection.reason ?? ''})` : node.selection?.via === 'routing' ? `routed (${node.selection.reason ?? 'no reason code'})` : 'root';
  return (
    <li>
      <details open>
        <summary>
          <strong>{node.agentId}</strong>
          {node.version ? <span className="muted"> v{node.version}</span> : null} <Badge value={node.status} /> <span className="muted">{why}</span>
        </summary>
        <dl className="kv compact">
          <div><dt>Model</dt><dd>{[node.model?.provider, node.model?.model].filter(Boolean).join('/') || '-'}</dd></div>
          <div><dt>Could see tools</dt><dd>{node.visibleTools.join(', ') || 'none'}</dd></div>
          <div><dt>Called</dt><dd>{node.toolsCalled.map((tool) => `${tool.name} (${tool.securityDecision ?? tool.status})`).join(', ') || 'nothing'}</dd></div>
          <div><dt>Denied</dt><dd>{node.deniedTools.join(', ') || 'nothing'}</dd></div>
          <div><dt>Knowledge</dt><dd>{node.knowledgeSources.join(', ') || 'none'}</dd></div>
          <div><dt>Memory</dt><dd>{node.memoryTypes.join(', ') || 'none'}</dd></div>
          <div><dt>Limits</dt><dd>{Object.entries(node.limits).map(([key, value]) => `${key} ${value}`).join(', ') || '-'}</dd></div>
          <div><dt>Model calls</dt><dd>{node.modelCallCount}</dd></div>
          <div><dt>Tokens</dt><dd>{formatNumber(node.usage?.totalTokens)}</dd></div>
          <div><dt>Latency</dt><dd>{formatMs(node.latencyMs)}</dd></div>
          {node.error ? <div><dt>Error</dt><dd className="error-text">{node.error.code}: {node.error.message}</dd></div> : null}
        </dl>
        {node.children.length > 0 ? (
          <ul className="tree">
            {node.children.map((child) => (
              <AgentItem key={child.agentRunId} node={child} />
            ))}
          </ul>
        ) : null}
      </details>
    </li>
  );
}

/** Section 48-51, 220: who ran, why, with what access, and what came back. No chain-of-thought. */
export function AgentsPanel({ session, headingId }: PanelProps): ReactNode {
  const tree = agentTree(session);
  return (
    <section aria-labelledby={headingId}>
      <PanelHeading id={headingId} title="Agents" description="Agent hierarchy with selection reasons, visible tools, calls, denials, tokens and latency." />
      {tree.length === 0 ? <p className="empty">No agent runs recorded.</p> : <ul className="tree" aria-label="Agent tree">{tree.map((node) => <AgentItem key={node.agentRunId} node={node} />)}</ul>}
      <h3>Routing</h3>
      <DataTable caption="Routing decisions" rows={routingDecisions(session)} rowKey={(row, index) => `${row.runId}-${index}`} empty="No routing decisions." columns={[{ header: 'Router', cell: (row) => row.router }, { header: 'Selected', cell: (row) => row.selectedAgentId }, { header: 'Candidates', cell: (row) => row.candidateAgentIds.join(', ') }, { header: 'Reason', cell: (row) => row.reasonCode ?? '-' }]} />
      <h3>Delegations</h3>
      <DataTable caption="Delegations" rows={delegations(session)} rowKey={(row) => row.delegationId} empty="No delegations." columns={[{ header: 'From', cell: (row) => row.fromAgentId }, { header: 'To', cell: (row) => row.toAgentId }, { header: 'Child run', cell: (row) => shortId(row.childRunId) }, { header: 'Status', cell: (row) => <Badge value={row.status} /> }, { header: 'Duration', cell: (row) => formatMs(row.durationMs), numeric: true }]} />
      <h3>Handoffs</h3>
      <DataTable caption="Handoffs" rows={handoffs(session)} rowKey={(row, index) => `${row.runId}-${index}`} empty="No handoffs." columns={[{ header: 'From', cell: (row) => row.fromAgentId }, { header: 'To', cell: (row) => row.toAgentId }, { header: 'Reason', cell: (row) => row.reason }]} />
    </section>
  );
}

function WorkflowGraph({ workflow }: { readonly workflow: WorkflowRecord }): ReactNode {
  return (
    <ol className="workflow-graph" aria-label={`Steps of ${workflow.workflowId}`}>
      {workflow.steps.map((step) => (
        <li key={step.stepId} className={`step step-${step.status}`}>
          <strong>{step.stepId}</strong> <span className="muted">{step.stepType ?? ''}</span> <Badge value={step.status} />
          <span className="muted">
            {step.dependencies.length ? ` after ${step.dependencies.join(', ')}` : ''}
            {step.attempts > 1 ? ` - ${step.attempts} attempts` : ''}
            {step.durationMs !== undefined ? ` - ${formatMs(step.durationMs)}` : ''}
            {step.checkpointVersion !== undefined ? ` - checkpoint v${step.checkpointVersion}` : ''}
          </span>
          {step.error ? <p className="error-text">{step.error.code}: {step.error.message}</p> : null}
        </li>
      ))}
    </ol>
  );
}

/** Section 52-54: workflow graph, pauses, retries, approvals and compensation. */
export function WorkflowsPanel({ session, headingId }: PanelProps): ReactNode {
  const list = workflows(session);
  return (
    <section aria-labelledby={headingId}>
      <PanelHeading id={headingId} title="Workflows" description="Deterministic workflow runs and their step graph." />
      {list.length === 0 ? <p className="empty">No workflows recorded.</p> : null}
      {list.map((workflow) => (
        <article key={workflow.workflowRunId} className="card">
          <h3>
            {workflow.workflowId} {workflow.version ? <span className="muted">v{workflow.version}</span> : null} <Badge value={workflow.status} />
          </h3>
          <p className="muted">
            Run {shortId(workflow.workflowRunId)} - {workflow.checkpoints} checkpoints - {workflow.retries} retries - {workflow.compensations} compensations
            {workflow.waitingStepId ? ` - waiting at ${workflow.waitingStepId}` : ''}
          </p>
          <WorkflowGraph workflow={workflow} />
          {workflow.approvals.length > 0 ? <p>Approvals: {workflow.approvals.map((approval) => `${approval.status}${approval.decidedBy ? ` by ${approval.decidedBy}` : ''}`).join(', ')}</p> : null}
        </article>
      ))}
    </section>
  );
}
