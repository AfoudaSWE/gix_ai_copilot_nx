import type { PublicModelSettings } from './configuration/model-settings.js';
import { countOperations } from './discovery/model.js';
import type { DiscoveredProject } from './discovery/model.js';
import type { ChangeProposal } from './proposals/model.js';

export type HealthStatus = 'ok' | 'warning' | 'error' | 'not-run' | 'unknown';

export interface HealthRow {
  readonly key: string;
  readonly label: string;
  readonly status: HealthStatus;
  readonly value?: string | number;
  readonly detail?: string;
}

export type LifecycleStage = 'pre-discovery' | 'discovered' | 'generated' | 'approved' | 'applied' | 'validation-failed';

/** Facts about the running integration the Studio cannot derive from the repository. */
export interface RuntimeFacts {
  readonly runtime: boolean;
  readonly server: boolean;
  readonly firewall: boolean;
  readonly devtools: boolean;
  readonly registeredTools?: number;
  /** Result of the most recent Test Connection, if one ran. */
  readonly lastConnection?: { readonly success: boolean; readonly latencyMs: number };
}

export interface StudioDiagnostics {
  readonly stage: LifecycleStage;
  readonly generatedAt: string;
  readonly runtime: readonly HealthRow[];
  readonly discovery: readonly HealthRow[];
  readonly generation: readonly HealthRow[];
  readonly apply: readonly HealthRow[];
}

const row = (key: string, label: string, status: HealthStatus, value?: string | number, detail?: string): HealthRow => ({ key, label, status, ...(value !== undefined ? { value } : {}), ...(detail ? { detail } : {}) });

function stageOf(discovery: DiscoveredProject | undefined, proposals: readonly ChangeProposal[]): LifecycleStage {
  if (!discovery) return 'pre-discovery';
  const settled = proposals.filter((proposal) => proposal.status === 'approved' || proposal.status === 'applied' || proposal.status === 'failed').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (settled?.status === 'failed') return 'validation-failed';
  if (settled?.status === 'applied') return 'applied';
  if (settled?.status === 'approved') return 'approved';
  return proposals.length > 0 ? 'generated' : 'discovered';
}

/**
 * Continuous diagnostics (§25-29, §78). Available before discovery and at every later stage;
 * every number comes from the discovery result or a proposal, never an estimate (§16).
 */
export function computeDiagnostics(input: { readonly facts: RuntimeFacts; readonly model: PublicModelSettings; readonly discovery?: DiscoveredProject; readonly proposals: readonly ChangeProposal[] }): StudioDiagnostics {
  const { facts, model, discovery, proposals } = input;
  const connection = facts.lastConnection;
  const runtime: HealthRow[] = [
    row('runtime', 'Runtime', facts.runtime ? 'ok' : 'error', facts.runtime ? 'Healthy' : 'Not attached'),
    row('server', 'Server', facts.server ? 'ok' : 'error', facts.server ? 'Connected' : 'Not attached'),
    row('provider', 'Provider', !model.configured ? 'error' : connection ? (connection.success ? 'ok' : 'error') : 'unknown', !model.configured ? 'Not configured' : connection ? (connection.success ? `Connected (${String(connection.latencyMs)} ms)` : 'Connection failed') : 'Configured, not tested', `${model.provider} / ${model.model}`),
    row('streaming', 'Streaming', connection?.success ? 'ok' : 'unknown', connection?.success ? 'Working' : 'Not verified'),
    row('firewall', 'Action Firewall', facts.firewall ? 'ok' : 'warning', facts.firewall ? 'Enabled' : 'Not configured', facts.firewall ? undefined : 'Tools from OpenAPI/MCP are refused without a firewall.'),
    row('devtools', 'DevTools', facts.devtools ? 'ok' : 'not-run', facts.devtools ? 'Connected' : 'Not enabled'),
    ...(facts.registeredTools !== undefined ? [row('registered-tools', 'Registered Tools', 'ok', facts.registeredTools)] : []),
  ];

  const discoveryRows: HealthRow[] = discovery
    ? [
        row('project-discovery', 'Project Discovery', discovery.diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 'error' : 'ok', 'Complete', discovery.discoveredAt),
        row('apis', 'APIs', 'ok', countOperations(discovery)),
        row('components', 'Components', 'ok', discovery.components.length),
        row('permissions', 'Permissions', 'ok', discovery.permissions.length),
        row('context-candidates', 'Context Candidates', 'ok', discovery.contextCandidates.length),
        row('discovery-warnings', 'Discovery Warnings', discovery.diagnostics.some((diagnostic) => diagnostic.severity !== 'info') ? 'warning' : 'ok', discovery.diagnostics.filter((diagnostic) => diagnostic.severity !== 'info').length),
      ]
    : [row('project-discovery', 'Project Discovery', 'not-run', 'Not run'), row('api-discovery', 'API Discovery', 'not-run', 'Not run')];

  const pending = proposals.filter((proposal) => proposal.status === 'draft' || proposal.status === 'ready-for-review');
  const count = (pick: (proposal: ChangeProposal) => number): number => pending.reduce((total, proposal) => total + pick(proposal), 0);
  const securityWarnings = count((proposal) => proposal.securityReview.length);
  const conflicts = count((proposal) => proposal.conflicts.length);
  const generation: HealthRow[] = [
    row('tool-candidates', 'Tool Candidates', 'ok', count((proposal) => proposal.tools.length)),
    row('context-proposals', 'Context Candidates', 'ok', count((proposal) => proposal.context.length)),
    row('ui-candidates', 'UI Candidates', 'ok', count((proposal) => proposal.ui.length)),
    row('pending-proposals', 'Pending Proposals', pending.length > 0 ? 'warning' : 'ok', pending.length),
    row('security-warnings', 'Security Warnings', securityWarnings > 0 ? 'warning' : 'ok', securityWarnings),
    row('conflicts', 'Conflicts', conflicts > 0 ? 'error' : 'ok', conflicts),
  ];

  const applied = proposals.filter((proposal) => proposal.status === 'applied' || proposal.status === 'failed');
  const appliedCount = (pick: (proposal: ChangeProposal) => number): number => applied.reduce((total, proposal) => total + pick(proposal), 0);
  const latest = [...applied].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const apply: HealthRow[] = [
    row('generated-tools', 'Generated Tools', 'ok', appliedCount((proposal) => proposal.tools.filter((tool) => tool.selected && tool.enabled).length)),
    row('context-sources', 'Context Sources', 'ok', appliedCount((proposal) => proposal.context.filter((item) => item.selected).length)),
    row('generative-ui', 'Generative UI', 'ok', appliedCount((proposal) => proposal.ui.filter((item) => item.selected).length)),
    ...(latest?.applyResult
      ? latest.applyResult.validation.map((check) => row(`validation-${check.name}`, check.name.charAt(0).toUpperCase() + check.name.slice(1), check.status === 'passed' ? 'ok' : check.status === 'failed' ? 'error' : 'not-run', check.status, check.detail))
      : [row('validation', 'Validation', 'not-run', 'No apply yet')]),
  ];

  return { stage: stageOf(discovery, proposals), generatedAt: new Date().toISOString(), runtime, discovery: discoveryRows, generation, apply };
}
