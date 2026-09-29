import type { ToolActionRisk, ToolApprovalLevel } from '@gixcopilot/protocol';
import type { ComponentProp, ContextCandidateKind, DiscoveryDiagnostic } from '../discovery/model.js';

/**
 * The structured proposal (§64). Framework-independent data: generators produce it, the
 * Studio previews it, the developer edits/selects/approves it, and only the apply engine
 * turns an approved proposal into repository changes.
 */
export type ProposalStatus = 'draft' | 'ready-for-review' | 'approved' | 'rejected' | 'applied' | 'failed';

interface ProposalItem {
  readonly id: string;
  /** Included in the apply (§49). Unselected items produce no files. */
  readonly selected: boolean;
}

export interface ToolProposal extends ProposalItem {
  readonly name: string;
  readonly description: string;
  readonly operation: { readonly method: string; readonly path: string; readonly source: string; readonly file: string; readonly key: string };
  /** The heuristic's suggestion (§34), kept so a lowered risk is visible in review. */
  readonly suggestedRisk: ToolActionRisk;
  readonly risk: ToolActionRisk;
  readonly permission?: string;
  readonly approval: ToolApprovalLevel;
  /** Generated with `enabled: false` when false; destructive tools start disabled (§33). */
  readonly enabled: boolean;
  readonly agent?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ContextProposal extends ProposalItem {
  readonly name: string;
  readonly kind: ContextCandidateKind;
  readonly description: string;
  readonly sensitivity: 'public' | 'internal' | 'sensitive' | 'restricted';
  readonly source: { readonly file: string; readonly line?: number };
}

export interface GenerativeUIProposal extends ProposalItem {
  readonly name: string;
  readonly description: string;
  readonly framework: 'react' | 'angular' | 'vue';
  readonly file: string;
  readonly props: readonly ComponentProp[];
}

export interface AgentProposal extends ProposalItem {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly tools: readonly string[];
}

export interface SkillProposal extends ProposalItem {
  readonly name: string;
  readonly description: string;
  readonly tools: readonly string[];
  readonly steps: readonly string[];
}

export interface KnowledgeProposal extends ProposalItem {
  readonly name: string;
  readonly description: string;
  readonly sources: readonly { readonly path: string; readonly kind: string }[];
}

export interface PolicyProposal extends ProposalItem {
  readonly tool: string;
  readonly requiredPermissions: readonly string[];
  readonly approval: ToolApprovalLevel;
  readonly risk: ToolActionRisk;
}

export interface ConfigChange extends ProposalItem {
  readonly file: string;
  /** Dot path inside the file, e.g. `appearance.primaryColor`. */
  readonly key: string;
  readonly before?: unknown;
  readonly after: unknown;
}

export type FileChangeKind = 'create' | 'modify' | 'delete';

export interface FileChange {
  readonly path: string;
  readonly kind: FileChangeKind;
  /** Full new content (absent for a delete). */
  readonly content?: string;
  /** SHA-256 of the file when the proposal was generated; `null` means it did not exist (§56). */
  readonly baseHash: string | null;
  /** The proposal items this file was rendered from. */
  readonly itemIds: readonly string[];
}

export interface ProposalWarning {
  readonly code: string;
  readonly message: string;
  readonly itemId?: string;
}

export interface ProposalConflict {
  readonly path: string;
  readonly message: string;
}

export type SecurityFindingSeverity = 'error' | 'warning';

/** A security-review result (§31). An `error` blocks approval. */
export interface SecurityFinding {
  readonly severity: SecurityFindingSeverity;
  readonly code: string;
  readonly message: string;
  readonly itemId?: string;
  readonly path?: string;
}

export interface ProposalSummary {
  readonly filesCreated: number;
  readonly filesModified: number;
  readonly filesRemoved: number;
  readonly configChanges: number;
  readonly toolsAdded: number;
  readonly toolsChanged: number;
  readonly toolsDisabled: number;
  readonly contextAdded: number;
  readonly uiAdded: number;
  readonly agentsAdded: number;
  readonly skillsAdded: number;
  readonly knowledgeAdded: number;
  readonly policiesAdded: number;
  readonly warnings: number;
  readonly conflicts: number;
  readonly securityErrors: number;
}

export interface ValidationCheck {
  readonly name: 'configuration' | 'typecheck' | 'lint' | 'test' | 'build' | 'security' | 'integration';
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly detail?: string;
}

export interface ApplyResult {
  readonly appliedAt: string;
  readonly written: readonly string[];
  readonly removed: readonly string[];
  readonly rolledBack: boolean;
  readonly validation: readonly ValidationCheck[];
  /** `APPLY COMPLETE` only when every run check passed (§59-60). */
  readonly outcome: 'complete' | 'applied-with-validation-errors' | 'aborted';
  readonly message: string;
}

export interface ChangeProposal {
  readonly id: string;
  readonly generator: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: ProposalStatus;
  readonly summary: ProposalSummary;
  readonly fileChanges: readonly FileChange[];
  readonly configChanges: readonly ConfigChange[];
  readonly tools: readonly ToolProposal[];
  readonly context: readonly ContextProposal[];
  readonly ui: readonly GenerativeUIProposal[];
  readonly agents: readonly AgentProposal[];
  readonly skills: readonly SkillProposal[];
  readonly knowledge: readonly KnowledgeProposal[];
  readonly policies: readonly PolicyProposal[];
  readonly diagnostics: readonly DiscoveryDiagnostic[];
  readonly warnings: readonly ProposalWarning[];
  readonly conflicts: readonly ProposalConflict[];
  readonly securityReview: readonly SecurityFinding[];
  readonly applyResult?: ApplyResult;
}

/** The item collections of a proposal, everything a generator decides. */
export type ProposalItems = Pick<ChangeProposal, 'tools' | 'context' | 'ui' | 'agents' | 'skills' | 'knowledge' | 'policies' | 'configChanges'>;

export const EMPTY_ITEMS: ProposalItems = { tools: [], context: [], ui: [], agents: [], skills: [], knowledge: [], policies: [], configChanges: [] };

export function summarize(proposal: Pick<ChangeProposal, 'fileChanges' | 'warnings' | 'conflicts' | 'securityReview'> & ProposalItems): ProposalSummary {
  const selected = <T extends { readonly selected: boolean }>(items: readonly T[]): T[] => items.filter((item) => item.selected);
  const tools = selected(proposal.tools);
  // A tool whose file already exists is a change to an earlier generation, not an addition.
  const modified = new Set(proposal.fileChanges.filter((change) => change.kind === 'modify').flatMap((change) => change.itemIds));
  return {
    filesCreated: proposal.fileChanges.filter((change) => change.kind === 'create').length,
    filesModified: proposal.fileChanges.filter((change) => change.kind === 'modify').length,
    filesRemoved: proposal.fileChanges.filter((change) => change.kind === 'delete').length,
    configChanges: selected(proposal.configChanges).length,
    toolsAdded: tools.filter((tool) => tool.enabled && !modified.has(tool.id)).length,
    toolsChanged: tools.filter((tool) => tool.enabled && modified.has(tool.id)).length,
    toolsDisabled: tools.filter((tool) => !tool.enabled).length,
    contextAdded: selected(proposal.context).length,
    uiAdded: selected(proposal.ui).length,
    agentsAdded: selected(proposal.agents).length,
    skillsAdded: selected(proposal.skills).length,
    knowledgeAdded: selected(proposal.knowledge).length,
    policiesAdded: selected(proposal.policies).length,
    warnings: proposal.warnings.length + proposal.securityReview.filter((finding) => finding.severity === 'warning').length,
    conflicts: proposal.conflicts.length,
    securityErrors: proposal.securityReview.filter((finding) => finding.severity === 'error').length,
  };
}
